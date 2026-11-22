"""INT6143 V2 — Item-based 协同过滤推荐与离线评估。

方法：基于历史购物篮共现的二值向量计算商品间余弦相似度
      sim(i, j) = 同时包含 i 和 j 的购物篮数 / sqrt(包含 i 的篮数 × 包含 j 的篮数)

训练/测试隔离：按 user_id 哈希把购物篮划分为构建集（80%，用于计算共现与相似度）
和评估集（20%，只用于离线评估）。两批用户不相交，评估集订单不参与相似度计算。
评估指标：Precision@K、Recall@K、NDCG@K（K=5,10），并与"热门商品"基线对比。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/ml"
SEED = 6143


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def user_bucket(user_id: int, salt: str, parts: int) -> int:
    digest = hashlib.md5(f"{salt}:{user_id}".encode()).hexdigest()
    return int(digest, 16) % parts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", type=int, default=500, help="候选商品池大小")
    parser.add_argument("--neighbors", type=int, default=10, help="每个商品保留的近邻数")
    args = parser.parse_args()
    started = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- 订单 → 用户（用于划分），只取 train 用户的最后一单 ----
    user_of_order = {}
    for row in rows(RAW / "orders_clean.csv"):
        if row["eval_set"] == "train":
            user_of_order[int(row["order_id"])] = int(row["user_id"])

    # ---- 读取购物篮并按用户划分 ----
    # 评估集购物篮保留 add_to_cart_order，用于把篮内池内商品拆成前半（种子）与后半（预测目标）。
    build_baskets, eval_baskets = [], []
    current, current_meta, current_order = {}, {}, None
    for row in rows(RAW / "order_products_train_clean.csv"):
        oid = int(row["order_id"])
        if oid != current_order:
            if current_order is not None and current:
                user_id = user_of_order.get(current_order)
                if user_id is not None:
                    (build_baskets if user_bucket(user_id, "cf-split", 5) < 4 else eval_baskets).append(
                        (current, current_meta))
            current, current_meta, current_order = {}, {}, oid
        current[int(row["product_id"])] = int(row["reordered"])
        current_meta[int(row["product_id"])] = int(row["add_to_cart_order"] or 0)
    if current_order is not None and current:
        user_id = user_of_order.get(current_order)
        if user_id is not None:
            (build_baskets if user_bucket(user_id, "cf-split", 5) < 4 else eval_baskets).append((current, current_meta))
    print(f"baskets: build {len(build_baskets)} / eval {len(eval_baskets)}", flush=True)

    # ---- 候选池：仅构建集频次前 N ----
    freq = Counter()
    for basket, _meta in build_baskets:
        for pid in basket:
            freq[pid] += 1
    pool = [pid for pid, _ in freq.most_common(args.pool)]
    pool_set = set(pool)

    # ---- 共现计数（仅构建集，用全部池内商品） ----
    co = Counter()
    for basket, _meta in build_baskets:
        items = sorted(pid for pid in basket if pid in pool_set)
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                co[(items[i], items[j])] += 1

    # ---- 余弦相似度 → top-N 近邻 ----
    neighbors = {}
    for pid in pool:
        fi = freq[pid]
        scores = []
        for qid in pool:
            if qid == pid:
                continue
            c = co.get((min(pid, qid), max(pid, qid)), 0)
            if c:
                scores.append((c / math.sqrt(fi * freq[qid]), qid))
        scores.sort(key=lambda s: (-s[0], s[1]))
        neighbors[pid] = [(qid, round(s, 4)) for s, qid in scores[:args.neighbors]]

    # ---- 名称与部门（用于前端按需加载目录分片） ----
    names, product_info = {}, {}
    for row in rows(RAW / "products_enriched_clean.csv"):
        pid = int(row["product_id"])
        if pid in pool_set:
            names[pid] = row["product_name"]
            product_info[pid] = {"name": row["product_name"], "departmentId": int(row["department_id"])}

    # ---- 离线评估（仅评估集；购物篮补全式任务） ----
    # 对每个评估购物篮：篮内池内商品按 add_to_cart_order 排序，前一半作为种子，
    # 后一半作为预测目标（relevant）。这样 relevant 天然非空，且种子信息早于目标加入。
    def evaluate(ranker, k_values=(5, 10)):
        p_at = {k: [] for k in k_values}
        r_at = {k: [] for k in k_values}
        n_at = {k: [] for k in k_values}
        evaluated = 0
        for basket, meta in eval_baskets:
            pool_items = sorted((pid for pid in basket if pid in pool_set),
                                key=lambda pid: (meta.get(pid, 0), pid))
            if len(pool_items) < 2:
                continue
            half = len(pool_items) // 2
            seeds, relevant = pool_items[:half], set(pool_items[half:])
            recs = ranker(seeds, max(k_values))
            evaluated += 1
            for k in k_values:
                topk = recs[:k]
                hits = [1 if pid in relevant else 0 for pid in topk]
                p_at[k].append(sum(hits) / k)
                r_at[k].append(sum(hits) / len(relevant))
                dcg = sum(h / math.log2(rank + 2) for rank, h in enumerate(hits))
                ideal_h = min(len(relevant), k)
                idcg = sum(1 / math.log2(rank + 2) for rank in range(ideal_h))
                n_at[k].append(dcg / idcg if idcg else 0.0)
        if not evaluated:
            raise SystemExit("评估集为空：请检查数据。")
        return {f"precision@{k}": round(sum(p_at[k]) / len(p_at[k]), 4) for k in k_values} | \
               {f"recall@{k}": round(sum(r_at[k]) / len(r_at[k]), 4) for k in k_values} | \
               {f"ndcg@{k}": round(sum(n_at[k]) / len(n_at[k]), 4) for k in k_values} | \
               {"evaluatedBaskets": evaluated}

    def cf_ranker(seeds, k):
        score = defaultdict(float)
        seed_set = set(seeds)
        for pid in seeds:
            for qid, sim in neighbors.get(pid, []):
                if qid not in seed_set:
                    score[qid] = max(score[qid], sim)
        ranked = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
        return [pid for pid, _ in ranked[:k]]

    def pop_ranker(seeds, k):
        seed_set = set(seeds)
        ranked = [pid for pid in pool if pid not in seed_set]
        return ranked[:k]

    cf_metrics = evaluate(cf_ranker)
    pop_metrics = evaluate(pop_ranker)
    print("CF:", cf_metrics, flush=True)
    print("POP:", pop_metrics, flush=True)

    payload = {
        "task": "Item-based Collaborative Filtering：基于购物篮共现的余弦相似度推荐",
        "method": "sim(i,j) = co-occurrence(i,j) / sqrt(freq_i × freq_j)，共现只在构建集购物篮上统计",
        "split": {
            "method": "按 user_id 的 MD5 哈希分桶：5 桶取 4 桶构建相似度（约 80%），1 桶只做离线评估（约 20%）。两批用户不相交，评估集订单不参与相似度计算，训练与测试严格隔离。",
            "buildBaskets": len(build_baskets), "evalBaskets": len(eval_baskets), "seed": SEED,
        },
        "pool": {"size": len(pool), "selection": "仅构建集购买频次前 %d 件" % args.pool,
                 "coverageNote": "评估仅覆盖池内商品：池外商品无相似度向量，无法被推荐（如实报告的已知限制）。"},
        "neighbors": {str(pid): [{"id": qid, "name": names.get(qid, str(qid)), "similarity": sim}
                                 for qid, sim in nns] for pid, nns in neighbors.items()},
        "productNames": {str(pid): names.get(pid, str(pid)) for pid in pool},
        "productInfo": {str(pid): info for pid, info in product_info.items()},
        "frequency": {str(pid): freq[pid] for pid in pool},
        "evaluation": {"cf": cf_metrics, "popularityBaseline": pop_metrics,
                       "protocol": "购物篮补全式评估：每个评估购物篮的池内商品按加入购物车顺序排成两半，前一半作为种子，预测后一半。两个排序器使用完全相同的评估购物篮、种子与 K 值，公平对比。",
                       "note": "评估仅覆盖候选池内商品：池外商品没有相似度向量，无法被推荐（如实报告的已知限制）。"},
        "seconds": round(time.perf_counter() - started, 1),
    }
    out = OUT / "cf-recommendations.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", out, out.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
