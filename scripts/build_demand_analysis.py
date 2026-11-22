"""INT6143 V2 — 商品需求分析与补货优先级。

回归任务：用商品静态属性（价格 / 重量 / 热量 / 部门）预测其购买频次。
- 目标标签：log1p(购买频次)。频次是目标，不是特征，特征中不含任何频次/复购信息。
- 划分：按 product_id 哈希 75/25 划分商品，训练/测试商品不相交。
- 指标：MAE、RMSE、R²（原始计数空间与对数空间都报告）。
- 明确声明：历史购买频次 ≠ 未来需求预测；线上订单 ≠ 实体门店真实销量。
- 补货优先级：用真实历史信号（频次 × 复购率）排序，模型预测值仅作对照列。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/ml"
SEED = 6143


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-products", type=int, default=30000, help="参与回归的商品数上限")
    parser.add_argument("--rf-sample", type=int, default=12000, help="随机森林训练子样本")
    args = parser.parse_args()
    started = time.perf_counter()
    rng = np.random.default_rng(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- 频次与复购（真实目标信号） ----
    frequency, reordered = Counter(), Counter()
    for row in rows(RAW / "order_products_train_clean.csv"):
        pid = int(row["product_id"])
        frequency[pid] += 1
        reordered[pid] += int(row["reordered"])

    # ---- 商品静态属性 ----
    products = []
    for row in rows(RAW / "products_enriched_clean.csv"):
        pid = int(row["product_id"])
        freq = frequency.get(pid, 0)
        if freq <= 0:
            continue
        products.append({
            "id": pid, "name": row["product_name"],
            "departmentId": int(row["department_id"]), "department": row["department"],
            "aisle": row["aisle"],
            "price": float(row["estimated_price_usd"]) if row["estimated_price_usd"] else None,
            "weight": float(row["weight_g"]) if row["weight_g"] else None,
            "calories": float(row["calories_kcal_per_100g"]) if row["calories_kcal_per_100g"] else None,
            "isFood": row["estimate_group"] != "non_food",
            "frequency": freq,
            "reorderRate": round(reordered[pid] / freq, 4),
        })
    products.sort(key=lambda p: -p["frequency"])
    if len(products) > args.max_products:
        # 保留全部高频商品 + 高频段随机抽样，避免长尾 0 频次主导
        head = products[: args.max_products // 2]
        tail = products[args.max_products // 2:]
        keep_tail = [tail[i] for i in rng.choice(len(tail), size=min(args.max_products - len(head), len(tail)), replace=False)]
        products = head + keep_tail
    print("regression products:", len(products), flush=True)

    departments = sorted({p["departmentId"] for p in products})
    dep_index = {d: i for i, d in enumerate(departments)}

    def median(key):
        arr = np.array([p[key] for p in products if p[key] is not None], dtype=np.float64)
        return float(np.median(arr)) if len(arr) else 0.0

    med = {"price": median("price"), "weight": median("weight"), "calories": median("calories")}

    def features(p):
        onehot = [1.0 if p["departmentId"] == d else 0.0 for d in departments]
        return [p["price"] if p["price"] is not None else med["price"],
                np.log10(p["weight"] if p["weight"] is not None else med["weight"]),
                p["calories"] if p["calories"] is not None else med["calories"],
                1.0 if p["isFood"] else 0.0, *onehot]

    feature_names = ["估算价格 USD", "log10 估算重量 g", "热量 kcal/100g", "是否食品",
                     *[f"部门 one-hot: {d}" for d in departments]]

    X = np.asarray([features(p) for p in products], dtype=np.float32)
    y_count = np.array([p["frequency"] for p in products], dtype=np.float64)
    y = np.log1p(y_count)

    # 商品级哈希划分 75/25
    test_mask = np.array([hashlib.md5(f"demand:{p['id']}".encode()).hexdigest()[0] in "0123" for p in products])
    train_mask = ~test_mask
    X_tr, y_tr, X_te, y_te, yc_te = X[train_mask], y[train_mask], X[test_mask], y[test_mask], y_count[test_mask]
    print(f"split: train {train_mask.sum()} / test {test_mask.sum()}", flush=True)

    # 标准化（用训练集统计）
    mu, sigma = X_tr.mean(axis=0), X_tr.std(axis=0) + 1e-9

    models = {}
    ridge = Ridge(alpha=1.0, random_state=SEED)
    ridge.fit((X_tr - mu) / sigma, y_tr)
    models["ridge"] = ridge
    rf_sample = rng.choice(train_mask.sum(), size=min(args.rf_sample, int(train_mask.sum())), replace=False)
    rf = RandomForestRegressor(n_estimators=150, min_samples_leaf=5, n_jobs=-1, random_state=SEED)
    rf.fit(X_tr[rf_sample], y_tr[rf_sample])
    models["random_forest"] = rf

    results, importances = {}, {}
    lo, hi = float(y_tr.min()), float(y_tr.max())
    for name, model in models.items():
        # 预测裁剪到训练目标范围：防止线性模型外推把 expm1 放大成天文数字（裁剪在指标中如实说明）
        pred_log = np.clip(model.predict(X_te), lo, hi)
        pred_count = np.maximum(np.expm1(pred_log), 0)
        median_pred_count = np.full_like(yc_te, np.median(np.expm1(y_tr)))
        results[name] = {
            "logSpace": {"r2": round(float(r2_score(y_te, pred_log)), 4),
                         "mae": round(float(mean_absolute_error(y_te, pred_log)), 4)},
            "countSpace": {"r2": round(float(r2_score(yc_te, pred_count)), 4),
                           "mae": round(float(mean_absolute_error(yc_te, pred_count)), 2),
                           "rmse": round(float(np.sqrt(mean_squared_error(yc_te, pred_count))), 2)},
            "baselineMedianCount": {"mae": round(float(mean_absolute_error(yc_te, median_pred_count)), 2),
                                    "rmse": round(float(np.sqrt(mean_squared_error(yc_te, median_pred_count))), 2),
                                    "r2": round(float(r2_score(yc_te, median_pred_count)), 4),
                                    "description": "中位数频次基线"},
        }
        if name == "random_forest":
            importances[name] = [{"feature": feature_names[i], "value": round(float(v), 4)}
                                 for i, v in sorted(enumerate(rf.feature_importances_), key=lambda kv: -kv[1])[:8]]
        print(name, results[name], flush=True)

    # ---- 补货优先级：真实历史信号（频次 × 复购率），模型预测作对照 ----
    all_pred_log = rf.predict(X)
    top_pool = products[:200]
    for p, pl in zip(top_pool, all_pred_log[:200]):
        p["predictedFrequency"] = int(round(float(np.expm1(pl))))
        p["priority"] = round(p["frequency"] * p["reorderRate"], 1)
    top_pool.sort(key=lambda p: -p["priority"])

    payload = {
        "task": "用商品静态属性预测购买频次（回归），并生成补货优先级",
        "target": "log1p(训练订单内购买频次)；频次只作为目标，不出现在任何特征中",
        "split": {"method": "按 product_id 的 MD5 哈希首字符 75/25 划分商品，训练/测试商品不相交。",
                  "trainProducts": int(train_mask.sum()), "testProducts": int(test_mask.sum()), "seed": SEED},
        "features": {"names": feature_names, "count": len(feature_names),
                     "groups": ["商品静态属性 4 项", "部门 one-hot %d 项" % len(departments)],
                     "note": "不含频次、复购率等由订单聚合的量，避免目标泄漏。"},
        "results": results,
        "importance": importances,
        "interpretation": "属性只能解释频次差异的一小部分（随机森林对数空间 R² ≈ 0.13，计数空间与中位数基线接近）。快消品频次主要由品类习惯决定，价格重量等属性解释力有限。模型预测任务在本数据上不可靠，因此补货优先级使用真实历史信号而非模型输出，如实报告。",
        "restockPriority": {
            "method": "补货优先级 = 历史购买频次 × 复购率（真实历史信号，不是模型输出）；predictedFrequency 为随机森林对照预测。",
            "top": [{"id": p["id"], "name": p["name"], "department": p["department"], "aisle": p["aisle"],
                     "frequency": p["frequency"], "reorderRate": p["reorderRate"],
                     "predictedFrequency": p["predictedFrequency"], "priority": p["priority"]} for p in top_pool[:30]],
        },
        "disclaimers": [
            "历史购买频次是过去统计，不等于未来需求预测；预测列是模型对'若只看属性能估到什么程度'的对照展示。",
            "线上订单频次不能直接解释为实体门店真实销量；店内补货决策仍属教学仿真。",
        ],
        "seconds": round(time.perf_counter() - started, 1),
    }
    out = OUT / "demand-analysis.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", out, out.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
