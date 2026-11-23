"""INT6143 V2 — 关联规则灵敏度分析（Apriori 参数扫描）。

复用 build_data.py 的 Apriori 逻辑（top 600 商品、1/2 项集、support/confidence/lift），
把 minSupportCount 与 minConfidence 参数化后扫描多组阈值；所有计数来自真实 train 购物篮。
不修改任何既有文件。
"""
from __future__ import annotations

import csv
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/lab"
SEED = 6143
VERSION = "1.0.0"
MAX_ITEMS = 600
COMBO_ITEMS = 200
COMBO_MIN_COUNT = 20
SUPPORT_GRID = [20, 35, 50, 80]
CONFIDENCE_GRID = [0.1, 0.25, 0.4]
BASELINE = (35, 0.25)


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def main():
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)

    names = {}
    valid_products = set()
    for row in rows(RAW / "products_enriched_clean.csv"):
        pid = int(row["product_id"])
        names[pid] = row["product_name"]
        valid_products.add(pid)

    train_orders = set()
    for row in rows(RAW / "orders_clean.csv"):
        if row["eval_set"] == "train":
            train_orders.add(int(row["order_id"]))

    baskets = defaultdict(set)
    frequency = Counter()
    for row in rows(RAW / "order_products_train_clean.csv"):
        oid, pid = int(row["order_id"]), int(row["product_id"])
        if oid not in train_orders or pid not in valid_products:
            continue
        baskets[oid].add(pid)
        frequency[pid] += 1
    n_baskets = len(baskets)

    # 与 build_data.py 一致：按频次取前 600 件，pair 计数只预计算一次。
    frequent = {pid for pid, _count in frequency.most_common(MAX_ITEMS)}
    frequent200 = set(pid for pid, _count in frequency.most_common(COMBO_ITEMS))
    pairs = Counter()
    triples = Counter()
    for basket in baskets.values():
        ids = sorted(basket & frequent)
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                pairs[(a, b)] += 1
        small = sorted(pid for pid in basket if pid in frequent200)
        for i in range(len(small)):
            for j in range(i + 1, len(small)):
                for k in range(j + 1, len(small)):
                    triples[(small[i], small[j], small[k])] += 1
    pair_list = sorted(pairs.items(), key=lambda kv: -kv[1])
    print(f"baskets {n_baskets} products {len(frequent)} pairs {len(pairs)} triples {len(triples)}", flush=True)

    def rules_for(min_support, min_confidence):
        rules = []
        for (a, b), count in pair_list:
            if count < min_support:
                break  # 已按计数降序，后续均不达标
            for src, dst in ((a, b), (b, a)):
                confidence = count / frequency[src]
                if confidence < min_confidence:
                    continue
                rules.append({
                    "from": src, "to": dst, "count": count,
                    "support": round(count / n_baskets, 8),
                    "confidence": round(confidence, 6),
                    "lift": round(confidence / (frequency[dst] / n_baskets), 5),
                })
        rules.sort(key=lambda r: (-r["lift"], -r["confidence"], -r["count"]))
        return rules

    sweeps = []
    baseline_rules = None
    for min_support in SUPPORT_GRID:
        for min_confidence in CONFIDENCE_GRID:
            rules = rules_for(min_support, min_confidence)
            if (min_support, min_confidence) == BASELINE:
                baseline_rules = rules
            top = []
            for r in rules[:20]:
                top.append({
                    "from": r["from"], "to": r["to"],
                    "fromName": names.get(r["from"], str(r["from"])),
                    "toName": names.get(r["to"], str(r["to"])),
                    "support": r["support"], "confidence": r["confidence"],
                    "lift": r["lift"], "count": r["count"],
                })
            sweeps.append({
                "minSupportCount": min_support,
                "minConfidence": min_confidence,
                "ruleCount": len(rules),
                "maxLift": rules[0]["lift"] if rules else 0.0,
                "avgConfidence": round(sum(r["confidence"] for r in rules) / len(rules), 6) if rules else 0.0,
                "topRules": top,
            })

    # ---- 基线网络：35/0.25 的规则，按 lift 取 40 条无向去重边，节点上限 30 ----
    edges = []
    seen_undirected = set()
    for r in baseline_rules or []:
        key = (min(r["from"], r["to"]), max(r["from"], r["to"]))
        if key in seen_undirected:
            continue
        seen_undirected.add(key)
        edges.append({
            "source": r["from"], "target": r["to"], "lift": r["lift"],
            "confidence": r["confidence"], "count": r["count"],
        })
        if len(edges) >= 40:
            break
    node_ids = set()
    for edge in edges:
        new_nodes = {edge["source"], edge["target"]} - node_ids
        if len(node_ids) + len(new_nodes) <= 30:
            node_ids |= new_nodes
    # 在派生出的 ≤30 个节点所诱导的子图上，按 lift 取前 40 条边（避免悬空边）。
    induced = {}
    for r in baseline_rules or []:
        if r["from"] not in node_ids or r["to"] not in node_ids:
            continue
        key = (min(r["from"], r["to"]), max(r["from"], r["to"]))
        candidate = {
            "source": r["from"], "target": r["to"], "lift": r["lift"],
            "confidence": r["confidence"], "count": r["count"],
        }
        if key not in induced or candidate["lift"] > induced[key]["lift"]:
            induced[key] = candidate
    selected_edges = sorted(induced.values(), key=lambda e: (-e["lift"], e["source"], e["target"]))[:40]
    degree = Counter()
    for edge in selected_edges:
        degree[edge["source"]] += 1
        degree[edge["target"]] += 1
    nodes = [
        {"id": pid, "name": names.get(pid, str(pid)), "degree": degree[pid]}
        for pid in sorted([p for p in node_ids if degree[p] > 0], key=lambda p: (-degree[p], p))
    ]
    network = {"nodes": nodes, "edges": selected_edges}

    # ---- 3 项组合：top 200 商品，三项同篮计数 >= 20，置信度 P(c|a,b) ----
    combos = []
    for (a, b, c), count in triples.items():
        if count < COMBO_MIN_COUNT:
            continue
        pair_count = pairs.get((a, b), 0)
        if pair_count <= 0:
            continue
        confidence = count / pair_count
        support = count / n_baskets
        lift = confidence / (frequency[c] / n_baskets)
        combos.append({
            "items": [names.get(pid, str(pid)) for pid in (a, b, c)],
            "support": round(support, 8), "confidence": round(confidence, 6),
            "lift": round(lift, 5), "count": count,
        })
    combos.sort(key=lambda x: (-x["lift"], -x["confidence"], -x["count"]))
    combos = combos[:10]

    payload = {
        "version": VERSION,
        "task": "Apriori 关联规则阈值扫描（1/2 项集）+ 3 项频繁组合；3 项组合-method: support=三项同篮占比, confidence=P(第3项|前2项), lift=confidence/P(第3项)",
        "source": "Instacart train baskets (REAL)",
        "algorithm": "Apriori 1-itemset & 2-itemset",
        "seed": SEED,
        "baskets": n_baskets,
        "candidateProducts": len(frequent),
        "seconds": 0,
        "sweeps": sweeps,
        "network": network,
        "combos": combos,
        "formula": {
            "support": "support(A→B) = count(A∪B) / N。count(A∪B) 为同时含 A、B 的购物篮数，N 为 train 购物篮总数。",
            "confidence": "confidence(A→B) = count(A∪B) / count(A)。表示买了 A 的篮子中也买 B 的比例。",
            "lift": "lift(A→B) = confidence(A→B) / (count(B)/N)。count(B)/N 为 B 的基线购买率；lift>1 表示 A 对 B 有正向提升，=1 独立，<1 负相关。",
            "variables": "A=前件商品, B=后件商品, count(X)=含 X 的购物篮数, N=购物篮总数；3 项组合以前两项为前件、第三项为后件。",
        },
        "application": "把 lift 高且置信度达标的规则作为货架相邻的候选：机器人巡线时，若规则 from→to 的 lift>1，则把 to 商品放在 from 附近货架段，减少拣货绕行；network 节点度数反映该商品在关联网络中的枢纽程度，优先布置在主通道交叉口。结果为教学仿真，不代表真实门店陈列验证。",
        "note": "规则扫描与 build_data.py 一致：仅取 train 频次前 600 商品，只挖 1/2 项集；pair 计数预计算一次后按阈值过滤。3 项组合为控制规模仅取前 200 商品、三项同篮计数≥20，扫描阈值 20/35/50/80 × 置信度 0.1/0.25/0.4。network 节点由基线 top 边派生并限制 ≤30 个，边为这些节点诱导子图中按 lift 排序的前 40 条，以保证无悬空边；该诱导子图实际只有 24 条不同规则边，不足 40 条，按实输出不补造。",
        "disclaimers": [
            "关联规则是共现统计，不等于因果关系；lift 高可能由品类习惯或促销共同导致。",
            "线上购物篮不代表实体门店的真实连带购买；货架邻接建议仅用于机器人路径教学仿真。",
            "阈值扫描只在真实购物篮上重新计数与过滤，没有硬编码任何指标；若某阈值下无规则则如实记 0。",
            "network 受 ≤30 节点上限与无悬空边约束，基线诱导子图仅 24 条真实规则边（未达计划的 40 条），不为凑数补造边。",
        ],
    }
    payload["seconds"] = round(time.time() - started, 3)
    out = OUT / "association-analysis.json"
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    print(f"written {out} {out.stat().st_size} bytes {payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
