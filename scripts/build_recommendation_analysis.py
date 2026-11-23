"""INT6143 V2 — Item-based CF 推荐分析（离线画像与可解释性）。

严格复用 build_recommendations.py 的划分与公式：
  user_bucket = int(md5('cf-split:'+user_id),16) % 5，<4 为构建集约 80%，其余评估集；
  sim(i,j) = co(i,j) / sqrt(freq_i × freq_j)，共现只在构建集购物篮上统计。
evaluation 对象逐字复制 public/data/ml/cf-recommendations.json，不重新计算、不修改既有文件。
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/lab"
CF_JSON = ROOT / "public/data/ml/cf-recommendations.json"
SEED = 6143
VERSION = "1.0.0"
POOL_SIZE = 500
NEIGHBORS = 10


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def user_bucket(user_id, salt, parts):
    digest = hashlib.md5(f"{salt}:{user_id}".encode()).hexdigest()
    return int(digest, 16) % parts


def main():
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    cf_payload = json.loads(CF_JSON.read_text(encoding="utf-8"))

    # ---- 订单 → 用户（train 订单），与 build_recommendations.py 一致 ----
    user_of_order = {}
    for row in rows(RAW / "orders_clean.csv"):
        if row["eval_set"] == "train":
            user_of_order[int(row["order_id"])] = int(row["user_id"])

    build_baskets, eval_baskets = [], []
    build_users = set()
    current, current_order = {}, None

    def flush():
        if current_order is None or not current:
            return
        user_id = user_of_order.get(current_order)
        if user_id is None:
            return
        if user_bucket(user_id, "cf-split", 5) < 4:
            build_baskets.append(current)
            build_users.add(user_id)
        else:
            eval_baskets.append(current)

    for row in rows(RAW / "order_products_train_clean.csv"):
        oid = int(row["order_id"])
        if oid != current_order:
            flush()
            current, current_order = {}, oid
        current[int(row["product_id"])] = int(row["reordered"])
    flush()
    print(f"baskets: build {len(build_baskets)} / eval {len(eval_baskets)}", flush=True)
    expected = cf_payload.get("split", {})
    if (len(build_baskets), len(eval_baskets)) != (expected.get("buildBaskets"), expected.get("evalBaskets")):
        raise SystemExit("划分结果与 cf-recommendations.json 不一致，停止以避免口径漂移")

    # ---- 候选池：仅构建集频次前 500 ----
    freq = Counter()
    for basket in build_baskets:
        for pid in basket:
            freq[pid] += 1
    pool = [pid for pid, _ in freq.most_common(POOL_SIZE)]
    pool_set = set(pool)
    non_zero_cells = sum(1 for basket in build_baskets for pid in basket if pid in pool_set)

    # ---- 共现只统计构建集；sim = co / sqrt(freq_i × freq_j) ----
    co = Counter()
    for basket in build_baskets:
        items = sorted(pid for pid in basket if pid in pool_set)
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                co[(items[i], items[j])] += 1

    neighbors = {}
    for pid in pool:
        fi = freq[pid]
        scores = []
        for qid in pool:
            if qid == pid:
                continue
            count = co.get((min(pid, qid), max(pid, qid)), 0)
            if count:
                scores.append((count / math.sqrt(fi * freq[qid]), qid, count))
        scores.sort(key=lambda s: (-s[0], s[1]))
        neighbors[pid] = scores[:NEIGHBORS]

    names = {}
    for row in rows(RAW / "products_enriched_clean.csv"):
        pid = int(row["product_id"])
        if pid in pool_set:
            names[pid] = row["product_name"]

    similarity_pairs = []
    for (a, b), count in co.items():
        sim = count / math.sqrt(freq[a] * freq[b])
        similarity_pairs.append({
            "a": a, "nameA": names.get(a, str(a)),
            "b": b, "nameB": names.get(b, str(b)),
            "similarity": round(sim, 4), "count": count,
        })
    similarity_pairs.sort(key=lambda p: (-p["similarity"], p["a"], p["b"]))
    similarity_pairs = similarity_pairs[:12]

    # ---- top-N：种子商品 + 热度基线（均来自真实构建集） ----
    seed_candidates = [
        (24852, "Banana"), (47766, "Organic Avocado"),
        (16797, "Strawberries"), (47626, "Large Lemon"),
    ]
    popular = [pid for pid in pool]
    topN = []
    for seed_id, fallback_name in seed_candidates:
        if seed_id not in pool_set:
            continue
        seed_name = names.get(seed_id, fallback_name)
        recs = []
        for sim, qid, count in neighbors[seed_id][:5]:
            recs.append({
                "id": qid, "name": names.get(qid, str(qid)),
                "similarity": round(sim, 4),
                "reason": f"与「{seed_name}」在 {count} 个构建集购物篮中共现，余弦相似度 {sim:.4f}",
            })
        baseline = [
            {"id": pid, "name": names.get(pid, str(pid)), "popularity": freq[pid]}
            for pid in popular if pid != seed_id][:5]
        topN.append({
            "seedId": seed_id, "seedName": seed_name,
            "recommendations": recs, "popularityBaseline": baseline,
        })

    users = len(build_users)
    items = len(pool)
    density = non_zero_cells / (users * items) if users and items else 0.0
    payload = {
        "version": VERSION,
        "task": "Item-based Collaborative Filtering：基于真实购物篮共现的商品相似度、Top-N 推荐与热度基线对照",
        "method": "Item-based Collaborative Filtering",
        "source": "Instacart train 购物篮（md5 user split 5 取 4 构建 / 1 评估）",
        "seed": SEED,
        "seconds": 0,
        "interactionMatrix": {
            "users": users, "baskets": len(build_baskets), "items": items,
            "nonZeroCells": non_zero_cells, "density": round(density, 6),
            "description": "构建集 user×item 二值交互矩阵：行是构建集用户（md5(user_id)%5<4，约 80%），列是构建集频次前 500 商品池；非零单元表示该用户在训练购物篮中购买了对应池内商品。评估集用户与购物篮完全不参与该矩阵。",
        },
        "similarity": {
            "metric": "cosine co-occurrence",
            "pairs": similarity_pairs,
        },
        "topN": topN,
        "explanation": "商品相似度 sim(i,j)=co(i,j)/sqrt(freq_i×freq_j)：co 为构建集中同时含 i、j 的购物篮数，freq 为该商品在构建集出现的篮数。该式等价于把每个商品表示为池内商品的二值共现向量后计算余弦相似度，分母消除热门商品因基数大而虚高的共现。推荐时对每个种子取相似度最高的商品（同种子多邻居取最大相似度，与 build_recommendations.py 的 ranker 一致），并按相似度降序输出；热度基线按构建集购买频次排序作为对照，用于判断推荐是否只是热门商品复读。",
        "evaluation": cf_payload["evaluation"],
        "limitations": "评估仅覆盖 500 件候选池内商品：池外商品没有相似度向量，无法被推荐，因此 Precision/Recall/NDCG 是池内补全任务的指标，不是全品类真实购物体验。共现相似度只利用二元购买信号，未建模序列、价格、季节与陈列位置；购物篮补全式评估让种子与目标来自同一笔订单，不等同于预测用户下一次订单。",
        "disclaimers": [
            "evaluation 对象逐字复制 public/data/ml/cf-recommendations.json，未重新计算或修改该文件。",
            "线上购物篮共现不等于实体门店货架邻接或真实因果影响，推荐结果仅用于机器人拣货路径教学仿真。",
            "相似度与频次全部来自构建集；评估集严格隔离，仅用于 cf-recommendations.json 的离线指标。",
        ],
    }
    payload["seconds"] = round(time.time() - started, 3)
    out = OUT / "recommendation-analysis.json"
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    print(f"written {out} {out.stat().st_size} bytes {payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
