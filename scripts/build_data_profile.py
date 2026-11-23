"""INT6143 V2 — 离线数据画像：真实 CSV 字段级统计 + 明确标注的人群仿真表。

只读 data/raw，复用 public/data/summary.json 的分布与 quality，不修改任何既有文件。
crowdSimulation 为 seed=6143 的确定性合成表，real=false，绝不冒充真实采集数据。
"""
from __future__ import annotations

import csv
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/lab"
SUMMARY = ROOT / "public/data/summary.json"
SEED = 6143
VERSION = "1.0.0"


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def cast(value, typ):
    if value is None or value == "":
        return None
    if typ == "int":
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if typ == "float":
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return str(value)


def iqr_bounds(values):
    arr = np.asarray([v for v in values if v is not None], dtype=np.float64)
    if len(arr) == 0:
        return None
    q1, q3 = np.percentile(arr, [25, 75])
    iqr = q3 - q1
    return float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)


def profile(iterator, fields, dedup_key=None, dedup_label="", outlier_checks=None, on_row=None):
    """对任意行迭代器做字段画像。outlier_checks: [(field, method, predicate)]。"""
    non_null = Counter()
    unique = {name: set() for name, _ in fields}
    example = {}
    outlier_count = Counter()
    outlier_example = {}
    seen = set() if dedup_key else None
    duplicates = 0
    total = 0
    for row in iterator:
        total += 1
        if on_row is not None:
            on_row(row)
        if seen is not None:
            key = dedup_key(row)
            if key in seen:
                duplicates += 1
            else:
                seen.add(key)
        for name, typ in fields:
            value = cast(row.get(name), typ)
            if value is None:
                continue
            non_null[name] += 1
            if name not in example:
                example[name] = value
            unique[name].add(value)
        for name, _method, predicate in outlier_checks or []:
            value = cast(row.get(name), "float")
            if value is None:
                continue
            if predicate(value):
                outlier_count[name] += 1
                if name not in outlier_example:
                    outlier_example[name] = value
    fields_out = []
    for name, typ in fields:
        n = non_null[name]
        missing = total - n
        fields_out.append({
            "name": name, "type": typ, "nonNull": n, "missing": missing,
            "missingPct": round(missing / total * 100, 4) if total else 0.0,
            "unique": len(unique[name]), "example": example.get(name),
        })
    outliers = [
        {"field": name, "method": method, "count": outlier_count[name],
         "example": outlier_example.get(name)}
        for name, method, _predicate in outlier_checks or []
    ]
    return {
        "rows": total, "columns": len(fields), "fields": fields_out,
        "duplicates": {"key": dedup_label, "count": duplicates}, "outliers": outliers,
    }


def range_check(lo, hi):
    return lambda v: v < lo or v > hi


def make_crowd(seed=SEED, n=600):
    """确定性门店人群仿真：规则驱动，字段与真实业务量纲对齐。"""
    rng = np.random.default_rng(seed)
    zones = ["entrance", "main_corridor", "shelf_aisle", "checkout", "exit"]
    records = []
    for i in range(n):
        zone = zones[i % len(zones)]
        density = round(float(rng.uniform(0.2, 2.5)), 3)
        occupancy = round(min(1.0, density / 2.5 * float(rng.uniform(0.7, 1.0))), 3)
        dwell = round(float(rng.uniform(2, 45)) * (1 + occupancy), 1)
        speed = round(max(0.2, 1.4 - 0.45 * density) * float(rng.uniform(0.85, 1.15)), 3)
        obstacles = int(rng.integers(0, 5))
        risk = "high" if density > 1.8 or occupancy > 0.75 else ("medium" if density > 1.0 else "low")
        records.append({
            "record_id": i + 1, "pedestrian_density": density, "corridor_occupancy": occupancy,
            "dwell_seconds": dwell, "walking_speed": speed, "obstacle_count": obstacles,
            "zone": zone, "risk_level": risk,
        })
    return records


def main():
    started = time.time()
    paths = {
        "products": RAW / "products_enriched_clean.csv",
        "orders": RAW / "orders_clean.csv",
        "orderProducts": RAW / "order_products_train_clean.csv",
    }
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        raise SystemExit("缺少数据文件: " + ", ".join(missing))
    OUT.mkdir(parents=True, exist_ok=True)
    summary = json.loads(SUMMARY.read_text(encoding="utf-8"))

    product_fields = [
        ("product_id", "int"), ("product_name", "string"), ("aisle_id", "int"),
        ("aisle", "string"), ("department_id", "int"), ("department", "string"),
        ("estimated_price_usd", "float"), ("price_currency", "string"),
        ("weight_g", "float"), ("calories_kcal_per_100g", "float"),
        ("calories_kcal_per_package", "float"), ("estimate_group", "string"),
        ("price_method", "string"), ("weight_method", "string"),
        ("calorie_method", "string"), ("data_quality", "string"),
    ]
    order_fields = [
        ("order_id", "int"), ("user_id", "int"), ("eval_set", "string"),
        ("order_number", "int"), ("order_dow", "int"), ("order_hour_of_day", "int"),
        ("days_since_prior_order", "float"),
    ]
    line_fields = [
        ("order_id", "int"), ("product_id", "int"), ("add_to_cart_order", "int"),
        ("reordered", "int"),
    ]
    crowd_fields = [
        ("record_id", "int"), ("pedestrian_density", "float"), ("corridor_occupancy", "float"),
        ("dwell_seconds", "float"), ("walking_speed", "float"), ("obstacle_count", "int"),
        ("zone", "string"), ("risk_level", "string"),
    ]

    # ---- 商品：先取数值列做 IQR 阈值，再单遍画像（文件小，两遍成本可忽略） ----
    numeric_columns = ["estimated_price_usd", "weight_g", "calories_kcal_per_100g",
                       "calories_kcal_per_package"]
    collected = {name: [] for name in numeric_columns}
    product_ids = set()
    for row in rows(paths["products"]):
        product_ids.add(int(row["product_id"]))
        for name in numeric_columns:
            value = cast(row.get(name), "float")
            if value is not None:
                collected[name].append(value)
    product_outliers = []
    for name in numeric_columns:
        bounds = iqr_bounds(collected[name])
        if bounds is None:
            continue
        lo, hi = bounds
        label = f"IQR [{round(lo, 3)}, {round(hi, 3)}]"
        product_outliers.append((name, label, lambda v, lo=lo, hi=hi: v < lo or v > hi))
    product_dataset = profile(
        rows(paths["products"]), product_fields,
        dedup_key=lambda r: int(r["product_id"]), dedup_label="product_id",
        outlier_checks=product_outliers,
    )
    product_dataset["key"] = "products"
    product_dataset["label"] = "商品主数据（真实）"
    product_dataset["real"] = True

    # ---- 订单：单遍画像并收集 train 订单集合供后续外键校验 ----
    train_orders = set()
    order_outliers = [
        ("order_id", "范围规则 [1, ∞)", lambda v: v < 1),
        ("user_id", "范围规则 [1, ∞)", lambda v: v < 1),
        ("order_number", "范围规则 [1, ∞)", lambda v: v < 1),
        ("order_dow", "范围规则 [0, 6]", range_check(0, 6)),
        ("order_hour_of_day", "范围规则 [0, 23]", range_check(0, 23)),
        ("days_since_prior_order", "范围规则 [0, 30]", range_check(0, 30)),
    ]

    def on_order(row):
        if row.get("eval_set") == "train":
            train_orders.add(int(row["order_id"]))

    order_dataset = profile(
        rows(paths["orders"]), order_fields,
        dedup_key=lambda r: int(r["order_id"]), dedup_label="order_id",
        outlier_checks=order_outliers, on_row=on_order,
    )
    order_dataset["key"] = "orders"
    order_dataset["label"] = "订单表（真实）"
    order_dataset["real"] = True

    # ---- 订单明细：单遍画像，顺带统计非 train 订单 / 未知商品外键 ----
    invalid_links = [0]

    def on_line(row):
        if int(row["order_id"]) not in train_orders or int(row["product_id"]) not in product_ids:
            invalid_links[0] += 1

    line_outliers = [
        ("order_id", "范围规则 [1, ∞)", lambda v: v < 1),
        ("product_id", "范围规则 [1, ∞)", lambda v: v < 1),
        ("add_to_cart_order", "范围规则 [1, 100]", range_check(1, 100)),
        ("reordered", "二值规则 {0, 1}", lambda v: v not in (0.0, 1.0)),
    ]
    line_dataset = profile(
        rows(paths["orderProducts"]), line_fields,
        dedup_key=lambda r: (r["order_id"], r["product_id"]),
        dedup_label="(order_id, product_id)",
        outlier_checks=line_outliers, on_row=on_line,
    )
    line_dataset["key"] = "orderProducts"
    line_dataset["label"] = "训练集订单商品明细（真实）"
    line_dataset["real"] = True

    # ---- 人群仿真表：seed 固定，明确 real=false ----
    crowd = make_crowd()
    crowd_bounds = {}
    for name in ("pedestrian_density", "dwell_seconds", "walking_speed"):
        bounds = iqr_bounds([r[name] for r in crowd])
        crowd_bounds[name] = (float(bounds[0]), float(bounds[1])) if bounds else (0.0, 0.0)
    crowd_outliers = [
        (name, f"IQR [{round(b[0], 3)}, {round(b[1], 3)}]",
         (lambda v, b=b: v < b[0] or v > b[1]))
        for name, b in crowd_bounds.items()
    ]
    crowd_dataset = profile(
        iter(crowd), crowd_fields,
        dedup_key=lambda r: r["record_id"], dedup_label="record_id",
        outlier_checks=crowd_outliers,
    )
    crowd_dataset["key"] = "crowdSimulation"
    crowd_dataset["label"] = "门店人群与通道仿真表（SIMULATED）"
    crowd_dataset["real"] = False
    crowd_dataset["note"] = (
        "确定性合成数据：numpy default_rng(seed=6143)，600 行； pedestrian_density~U(0.2,2.5) 人/㎡，"
        "corridor_occupancy=min(1,density/2.5×U(0.7,1))，dwell_seconds=U(2,45)×(1+occupancy)，"
        "walking_speed=max(0.2,1.4-0.45×density)×U(0.85,1.15)，obstacle_count~整数[0,4]；"
        "risk_level 由 density/occupancy 阈值规则判定。仅用于机器人路径仿真，不是真实客流观测。"
    )

    # ---- 清洗步骤：全部来自上述真实单遍统计 ----
    def clean_step(step, description, before, after, note):
        return {"step": step, "description": description, "rowsBefore": before,
                "rowsAfter": after, "note": note}

    cleaning = [
        clean_step("products 去重", "按 product_id 去重",
                   product_dataset["rows"], product_dataset["rows"] - product_dataset["duplicates"]["count"],
                   "提供的清洗文件中实际重复 product_id 数：" + str(product_dataset["duplicates"]["count"])),
        clean_step("orders 去重", "按 order_id 去重",
                   order_dataset["rows"], order_dataset["rows"] - order_dataset["duplicates"]["count"],
                   "提供的清洗文件中实际重复 order_id 数：" + str(order_dataset["duplicates"]["count"])),
        clean_step("orderProducts 去重", "按 (order_id, product_id) 去重",
                   line_dataset["rows"], line_dataset["rows"] - line_dataset["duplicates"]["count"],
                   "提供的清洗文件中实际重复行数：" + str(line_dataset["duplicates"]["count"])),
        clean_step("orderProducts 外键校验", "剔除非 train 订单或未知 product_id",
                   line_dataset["rows"] - line_dataset["duplicates"]["count"],
                   line_dataset["rows"] - line_dataset["duplicates"]["count"] - invalid_links[0],
                   "实际外键不合法行数：" + str(invalid_links[0]) + "；与 summary.json.quality 一致"),
    ]

    # ---- 归一化：对真实商品属性同时计算 z-score 与 min-max ----
    normalization = []
    for feature in ("estimated_price_usd", "weight_g", "calories_kcal_per_100g"):
        arr = np.asarray(collected[feature], dtype=np.float64)
        raw_min, raw_max = float(arr.min()), float(arr.max())
        raw_mean, raw_std = float(arr.mean()), float(arr.std())
        safe_std = raw_std if raw_std > 0 else 1.0
        span = raw_max - raw_min if raw_max > raw_min else 1.0
        z = (arr - raw_mean) / safe_std
        mm = (arr - raw_min) / span
        for method, transformed in (("z-score", z), ("min-max", mm)):
            normalization.append({
                "feature": feature, "method": method,
                "min": round(float(transformed.min()), 6), "max": round(float(transformed.max()), 6),
                "mean": round(float(transformed.mean()), 6), "std": round(float(transformed.std()), 6),
                "rawMin": round(raw_min, 4), "rawMax": round(raw_max, 4),
                "rawMean": round(raw_mean, 4), "rawStd": round(raw_std, 4),
                "count": int(len(arr)),
            })

    feature_engineering = [
        {"feature": "log1p(estimated_price_usd)", "transform": "log1p(价格)", "source": "products_enriched_clean.csv → build_data.py K-means"},
        {"feature": "log1p(weight_g)", "transform": "log1p(估算重量)", "source": "products_enriched_clean.csv → build_data.py K-means"},
        {"feature": "log1p(calories_kcal_per_100g)", "transform": "log1p(估算热量)", "source": "products_enriched_clean.csv → build_data.py K-means"},
        {"feature": "log1p(frequency)", "transform": "log1p(训练篮购买频次)", "source": "order_products_train_clean.csv → build_data.py K-means"},
        {"feature": "reorderRate", "transform": "reordered / frequency", "source": "order_products_train_clean.csv → build_data.py / train_reorder_model.py"},
        {"feature": "aisle one-hot", "transform": "类目独热编码", "source": "aisles_clean.csv → build_data.py K-means / train_reorder_model.py"},
        {"feature": "department one-hot", "transform": "部门独热编码", "source": "departments_clean.csv → build_data.py K-means / train_reorder_model.py"},
        {"feature": "isFood", "transform": "estimate_group != non_food", "source": "products_enriched_clean.csv → build_demand_analysis.py"},
        {"feature": "共现余弦相似度", "transform": "co / sqrt(freq_i × freq_j)", "source": "order_products_train_clean.csv → build_recommendations.py"},
        {"feature": "support / confidence / lift", "transform": "Apriori 关联规则三度量", "source": "order_products_train_clean.csv → build_data.py"},
        {"feature": "user MD5 分桶", "transform": "md5('cf-split:'+user_id) % 5 < 4", "source": "orders_clean.csv → build_recommendations.py 训练/评估隔离"},
        {"feature": "meanTrainBasketSize", "transform": "总商品行数 / 购物篮数", "source": "order_products_train_clean.csv → summary.json"},
    ]

    payload = {
        "version": VERSION,
        "task": "离线数据画像：真实 CSV 字段级统计与数据质量，叠加明确标注的人群仿真数据画像",
        "source": "data/raw 下 5 份 Instacart 清洗 CSV；public/data/summary.json；crowdSimulation 为 seed=6143 确定性仿真",
        "seed": SEED,
        "seconds": 0,
        "datasets": [product_dataset, order_dataset, line_dataset, crowd_dataset],
        "distributions": {
            "orderHour": [{"label": str(i), "count": summary["orderHour"][str(i)]} for i in range(24)],
            "price": summary["priceDistribution"],
            "weight": summary["weightDistribution"],
        },
        "quality": summary["quality"],
        "cleaning": cleaning,
        "featureEngineering": feature_engineering,
        "normalization": normalization,
        "versions": [{
            "version": VERSION, "date": "2026-11-23",
            "files": [
                "public/data/lab/data-profile.json",
                "public/data/lab/association-analysis.json",
                "public/data/lab/recommendation-analysis.json",
            ],
            "note": "初始版本",
        }],
        "disclaimers": [
            "crowdSimulation 为确定性合成仿真表（real=false），不代表任何真实门店客流观测。",
            "价格、重量、热量均为估算值（见 summary.json.methods），不是实测营养成分或真实售价。",
            "直方图与 quality 逐字复用 summary.json；本脚本只新增字段级画像、去重计数与归一化统计。",
            "唯一值计数基于提供的清洗文件本身；原始→清洗前的删除量不可由这些文件反推。",
        ],
    }
    payload["seconds"] = round(time.time() - started, 3)
    out = OUT / "data-profile.json"
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    print(f"written {out} {out.stat().st_size} bytes {payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
