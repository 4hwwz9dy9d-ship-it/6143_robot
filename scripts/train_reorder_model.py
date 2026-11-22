"""INT6143 V2 — 复购预测（监督学习）与完整评估体系。

研究问题：能否基于历史购买行为与商品特征，预测用户在订单中是否会复购某件商品？

数据审计结论（决定样本构造方式）：
- 行项目明细 order_products_train_clean.csv 只覆盖 eval_set == "train" 的订单，
  即每位用户的最后一单（131,209 个用户，每人一个购物篮）。
- prior 订单没有商品明细，因此无法构造"基于多笔历史购物篮预测下一单"的样本。
- 采用等价且可验证的任务：预测 (用户, 候选商品) 对中，用户是否会在其订单中
  复购该商品（label = 该行 reordered == 1）。候选商品池与流行度特征只在
  训练划分用户的订单上计算；划分按用户（user_id 哈希）进行，训练与测试
  用户完全不相交，杜绝未来信息与目标标签泄漏。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import StratifiedKFold
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/ml"
SEED = 6143


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def user_bucket(user_id: int, salt: str, parts: int) -> int:
    """user_id 哈希分桶：同一用户的所有数据永远落在同一侧。"""
    digest = hashlib.md5(f"{salt}:{user_id}".encode()).hexdigest()
    return int(digest, 16) % parts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--users", type=int, default=20000, help="抽样用户数")
    parser.add_argument("--negatives", type=int, default=15, help="每个订单采样的负样本数")
    parser.add_argument("--pool", type=int, default=500, help="候选商品池大小")
    args = parser.parse_args()
    started = time.perf_counter()
    rng = np.random.default_rng(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- 1. 读取订单（仅 train 用户的最后一单） ----
    order_meta = {}
    user_order = {}
    for row in rows(RAW / "orders_clean.csv"):
        if row["eval_set"] != "train":
            continue
        oid = int(row["order_id"])
        order_meta[oid] = {
            "user_id": int(row["user_id"]),
            "order_number": int(row["order_number"]),
            "order_dow": int(row["order_dow"]),
            "order_hour_of_day": int(row["order_hour_of_day"]),
            "days_since_prior_order": float(row["days_since_prior_order"]) if row["days_since_prior_order"] else None,
        }
        user_order[order_meta[oid]["user_id"]] = oid

    # ---- 2. 用户抽样与划分（用户级，两批用户不相交） ----
    all_users = sorted(user_order)
    pick = rng.choice(len(all_users), size=min(args.users, len(all_users)), replace=False)
    sampled = {all_users[i] for i in pick}
    split = {u: "train" if user_bucket(u, "reorder-split", 4) < 3 else "test" for u in sampled}
    train_users = {u for u in sampled if split[u] == "train"}
    test_users = {u for u in sampled if split[u] == "test"}

    # ---- 3. 行项目：训练划分订单 → 候选池与流行度；其余 → 样本标签 ----
    freq_pool = Counter()          # 仅训练划分订单：候选池依据 + 流行度特征
    reorder_pool = Counter()       # 仅训练划分订单：复购次数（流行度特征）
    baskets = defaultdict(dict)    # order_id -> {pid: reordered}
    for row in rows(RAW / "order_products_train_clean.csv"):
        oid = int(row["order_id"])
        meta = order_meta.get(oid)
        if meta is None or meta["user_id"] not in sampled:
            continue
        pid = int(row["product_id"])
        reordered = int(row["reordered"])
        baskets[oid][pid] = reordered
        if meta["user_id"] in train_users:
            freq_pool[pid] += 1
            reorder_pool[pid] += reordered

    pool = [pid for pid, _ in freq_pool.most_common(args.pool)]
    pool_set = set(pool)
    pool_index = {pid: i for i, pid in enumerate(pool)}

    # ---- 4. 商品静态属性（与订单无关，无泄漏） ----
    products = {}
    for row in rows(RAW / "products_enriched_clean.csv"):
        pid = int(row["product_id"])
        if pid in pool_set:
            products[pid] = {
                "name": row["product_name"],
                "department_id": int(row["department_id"]),
                "price": float(row["estimated_price_usd"]) if row["estimated_price_usd"] else None,
                "weight": float(row["weight_g"]) if row["weight_g"] else None,
                "calories": float(row["calories_kcal_per_100g"]) if row["calories_kcal_per_100g"] else None,
                "is_food": row["estimate_group"] != "non_food",
            }

    def median(values):
        arr = np.array([v for v in values if v is not None], dtype=np.float64)
        return float(np.median(arr)) if len(arr) else 0.0

    med = {
        "price": median(p["price"] for p in products.values()),
        "weight": median(p["weight"] for p in products.values()),
        "calories": median(p["calories"] for p in products.values()),
        "days": median(m["days_since_prior_order"] for m in order_meta.values()
                       if m["user_id"] in train_users and m["days_since_prior_order"] is not None),
    }
    departments = sorted({p["department_id"] for p in products.values()})

    pop_freq = {pid: freq_pool[pid] for pid in pool}
    pop_ratio = {pid: (reorder_pool[pid] / freq_pool[pid]) if freq_pool[pid] else 0.0 for pid in pool}

    def feature_row(meta, pid):
        p = products[pid]
        onehot = [1.0 if p["department_id"] == d else 0.0 for d in departments]
        return [
            float(meta["order_number"]),
            float(meta["order_dow"]),
            float(meta["order_hour_of_day"]),
            meta["days_since_prior_order"] if meta["days_since_prior_order"] is not None else med["days"],
            p["price"] if p["price"] is not None else med["price"],
            p["weight"] if p["weight"] is not None else med["weight"],
            p["calories"] if p["calories"] is not None else med["calories"],
            1.0 if p["is_food"] else 0.0,
            np.log10(1 + pop_freq[pid]),
            pop_ratio[pid],
            *onehot,
        ]

    feature_names = ["订单序号 order_number", "星期 order_dow", "下单小时 order_hour",
                     "距上次下单天数 days_since_prior", "估算价格 USD", "估算重量 g",
                     "热量 kcal/100g", "是否食品", "log10 训练划分购买频次",
                     "训练划分复购比例", *[f"部门 one-hot: {d}" for d in departments]]

    # ---- 5. 构造样本 ----
    X_train, y_train, X_test, y_test = [], [], [], []
    positives, covered_positives = 0, 0
    for user_id in sampled:
        oid = user_order[user_id]
        meta = order_meta[oid]
        basket = baskets[oid]
        pos = [pid for pid, reordered in basket.items() if reordered == 1 and pid in pool_set]
        covered_positives += sum(1 for pid, reordered in basket.items() if reordered == 1)
        positives += len(pos)
        rows_x = [feature_row(meta, pid) for pid in pos]
        rows_y = [1] * len(pos)
        pool_list = list(pool_set - set(basket))
        neg_pick = rng.choice(len(pool_list), size=min(args.negatives, len(pool_list)), replace=False)
        for i in neg_pick:
            rows_x.append(feature_row(meta, pool_list[i]))
            rows_y.append(0)
        if split[user_id] == "train":
            X_train.extend(rows_x); y_train.extend(rows_y)
        else:
            X_test.extend(rows_x); y_test.extend(rows_y)
    X_train = np.asarray(X_train, dtype=np.float32)
    y_train = np.asarray(y_train, dtype=np.int8)
    X_test = np.asarray(X_test, dtype=np.float32)
    y_test = np.asarray(y_test, dtype=np.int8)

    # ---- 6. 模型与评估 ----
    models = {
        "logistic_regression": LogisticRegression(max_iter=2000, class_weight="balanced", random_state=SEED),
        "random_forest": RandomForestClassifier(n_estimators=150, min_samples_leaf=20, n_jobs=-1,
                                                class_weight="balanced", random_state=SEED),
        "decision_tree": DecisionTreeClassifier(max_depth=10, class_weight="balanced", random_state=SEED),
    }
    # 交叉验证：固定 12 万行训练子样本，保证三个模型公平且耗时可控
    cv_size = min(120_000, len(y_train))
    cv_idx = rng.choice(len(y_train), size=cv_size, replace=False)
    X_cv, y_cv = X_train[cv_idx], y_train[cv_idx]
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cv_table = {}
    for name, model in models.items():
        scores = []
        for tr, te in skf.split(X_cv, y_cv):
            clone = type(model)(**model.get_params())
            clone.fit(X_cv[tr], y_cv[tr])
            scores.append(float(roc_auc_score(y_cv[te], clone.predict_proba(X_cv[te])[:, 1])))
        cv_table[name] = {"folds": [round(s, 4) for s in scores],
                          "rocAucMean": round(float(np.mean(scores)), 4),
                          "rocAucStd": round(float(np.std(scores)), 4),
                          "rows": int(cv_size)}
        print(f"CV {name}: AUC {np.mean(scores):.4f}±{np.std(scores):.4f}", flush=True)

    results, roc_points, importances = {}, {}, {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        proba = model.predict_proba(X_test)[:, 1]
        pred = (proba >= 0.5).astype(int)
        fpr, tpr, thresholds = roc_curve(y_test, proba)
        keep = np.unique(np.linspace(0, len(fpr) - 1, 60).astype(int))
        roc_points[name] = {"fpr": [round(float(fpr[i]), 4) for i in keep],
                            "tpr": [round(float(tpr[i]), 4) for i in keep],
                            "auc": round(float(roc_auc_score(y_test, proba)), 4)}
        tn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()
        results[name] = {
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
            "rocAuc": round(float(roc_auc_score(y_test, proba)), 4),
            "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        }
        if name == "random_forest":
            importances[name] = [{"feature": feature_names[i], "value": round(float(v), 4)}
                                 for i, v in sorted(enumerate(model.feature_importances_), key=lambda kv: -kv[1])[:10]]
        if name == "logistic_regression":
            coefs = np.abs(model.coef_[0]) / (np.abs(model.coef_[0]).max() or 1)
            importances[name] = [{"feature": feature_names[i], "value": round(float(v), 4)}
                                 for i, v in sorted(enumerate(coefs), key=lambda kv: -kv[1])[:10]]
        print(f"TEST {name}: {results[name]}", flush=True)

    # ---- 7. 基线 ----
    majority_rate = float(np.mean(y_test == 0))
    baseline = {
        "majority": {"description": "全部预测为不复购（多数类）",
                     "accuracy": round(majority_rate, 4),
                     "positiveRate": round(float(np.mean(y_test)), 4)},
    }
    # 流行度基线：只用训练划分频次（log10 列）打分
    pop_pred = X_test[:, 8]
    baseline["popularity"] = {"description": "仅按训练划分购买频次排序（流行度基线）",
                              "rocAuc": round(float(roc_auc_score(y_test, pop_pred)), 4)}

    payload = {
        "task": "预测用户是否会在订单中复购某件候选商品（该行 reordered = 1）",
        "researchQuestion": "Can we predict whether a customer will reorder a product based on historical purchasing behaviour and product characteristics?",
        "dataLimitation": "行项目明细只覆盖每位用户的最后一单（train 订单）；prior 订单无商品明细。因此本任务是\"订单内复购预测\"：用户与商品特征 + 订单上下文 → 是否复购。无法构造跨多笔历史购物篮的\"下一单\"样本，页面如实说明此限制。",
        "split": {
            "method": "按 user_id 的 MD5 哈希分桶：4 桶取 3 桶训练、1 桶测试（约 75/25）。同一用户数据只会落在一侧，训练/测试用户不相交。",
            "sampledUsers": len(sampled), "trainUsers": len(train_users), "testUsers": len(test_users),
            "seed": SEED,
        },
        "candidatePool": {"size": len(pool), "selection": "仅训练划分用户的订单购买频次前 500 件"},
        "sampling": {"negativesPerOrder": args.negatives,
                     "counts": {"positive": positives, "negative": int((y_train == 0).sum() + (y_test == 0).sum())},
                     "imputation": {k: round(v, 3) for k, v in med.items()},
                     "note": "负样本 = 订单中未购买的候选池商品，每单固定采样 15 件；类别不平衡用 class_weight=balanced 处理，并报告多数类基线。"},
        "leakageChecks": [
            "label 来自订单行 reordered 字段，任何特征都不含 reordered / 该行信息。",
            "候选商品池与 log 频次、复购比例特征只使用训练划分用户的订单；测试用户订单不参与任何特征计算。",
            "训练/测试按用户哈希划分，同一用户不会同时出现在两侧。",
            "不含 days_since_prior 之外的未来字段；未使用 frequency、reorder ratio 的全量版本（它们在测试侧属于结果信息），只使用训练划分内版本。",
        ],
        "features": {"names": feature_names, "count": len(feature_names),
                     "groups": ["订单上下文 4 项", "商品静态属性 4 项", "训练划分流行度 2 项", "部门 one-hot %d 项" % len(departments)]},
        "sampleCounts": {"train": int(len(y_train)), "test": int(len(y_test)),
                         "total": int(len(y_train) + len(y_test)),
                         "poolCoverage": {"poolPositives": int(y_train.sum() + y_test.sum()),
                                          "allPositivesInSampledOrders": covered_positives}},
        "crossValidation": cv_table,
        "results": results,
        "roc": roc_points,
        "importance": importances,
        "baseline": baseline,
        "seconds": round(time.perf_counter() - started, 1),
    }
    out = OUT / "reorder-model.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", out, out.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
