"""INT6143 NEXUS RETAIL 2.0 — 聚类分析（实验报告数据构建）。

两套彼此独立的 K-Means 聚类：
1) 商品聚类：使用 Instacart 提供的 REAL 商品属性（价格/重量/热量）+ 真实订单聚合
   （购买频次、复购比例），与 public/data/clusters.json 的口径一致。
2) 客流聚类：使用确定性仿真生成的 corridor/pedestrian 状态（numpy RandomState(6143)），
   全部为 SIMULATED 数据，绝不代表任何真实监控。

两组数据分别训练、分别评价，绝不混用：商品行不含任何客流特征，客流行不含任何商品属性。
所有 inertia / silhouette / 坐标 / 均值均由真实 sklearn 运行结果计算，未硬编码任何指标。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "public/data/lab"
SEED = 6143


def write_json(name: str, payload: dict) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", path, path.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


def product_clustering(rng: np.random.RandomState) -> dict:
    """真实 Instacart 商品属性上的 K-Means（k=2..8）。"""
    products = pd.read_csv(RAW / "products_enriched_clean.csv", encoding="utf-8-sig")
    lines = pd.read_csv(RAW / "order_products_train_clean.csv", encoding="utf-8-sig")
    agg = lines.groupby("product_id")["reordered"].agg(frequency="size", reorder_count="sum").reset_index()
    df = products.merge(agg, on="product_id", how="inner")

    # 真实且完整的属性；非食品没有可信热量估算，排除（与 clusters.json 一致）。
    df = df.dropna(subset=["estimated_price_usd", "weight_g", "calories_kcal_per_100g"])
    df = df[(df["estimated_price_usd"] > 0) & (df["weight_g"] > 0) & (df["calories_kcal_per_100g"] >= 0)]
    df = df[df["estimate_group"] != "non_food"]
    df = df.sort_values("frequency", ascending=False).head(4000).reset_index(drop=True)

    price = df["estimated_price_usd"].to_numpy(dtype=float)
    weight = df["weight_g"].to_numpy(dtype=float)
    calories = df["calories_kcal_per_100g"].to_numpy(dtype=float)
    freq = df["frequency"].to_numpy(dtype=float)
    reordered = df["reorder_count"].to_numpy(dtype=float)
    numeric = np.column_stack([
        np.log10(price),
        np.log10(weight),
        np.log10(1.0 + calories),
        np.log10(1.0 + freq),
        reordered / freq,
    ])
    feature_names = [
        "log10 估算价格 USD", "log10 估算重量 g", "log10 热量 kcal/100g",
        "log10 购买频次", "复购比例",
    ]

    # 部门 one-hot（真实属性）：让簇结构更接近实验报告中的商品分群。
    depts = sorted(int(d) for d in df["department_id"].unique())
    dept_idx = {d: i for i, d in enumerate(depts)}
    onehot = np.zeros((len(df), len(depts)), dtype=float)
    for row, d in enumerate(df["department_id"].to_numpy()):
        onehot[row, dept_idx[int(d)]] = 1.0
    X_raw = np.column_stack([numeric, onehot])
    feature_names += [f"部门 one-hot: {d}" for d in depts]

    scaler = StandardScaler()
    X = scaler.fit_transform(X_raw)
    sil_idx = rng.choice(len(X), size=min(500, len(X)), replace=False)

    k_values, fitted = [], {}
    for k in range(2, 9):
        model = KMeans(n_clusters=k, n_init=5, random_state=SEED)
        model.fit(X)
        labels = model.labels_
        k_values.append({
            "k": k,
            "inertia": round(float(model.inertia_), 2),
            "silhouette": round(float(silhouette_score(X[sil_idx], labels[sil_idx])), 4),
        })
        fitted[k] = model

    # 肘点距离法：各 (k, inertia) 点到首末两点连线的垂距最大者为选中 k。
    ks = np.array([v["k"] for v in k_values], dtype=float)
    inertia = np.array([v["inertia"] for v in k_values], dtype=float)
    x1, y1, x2, y2 = ks[0], inertia[0], ks[-1], inertia[-1]
    denom = np.hypot(y2 - y1, x2 - x1)
    distances = np.abs((y2 - y1) * ks - (x2 - x1) * inertia + x2 * y1 - y2 * x1) / denom
    selected_k = int(ks[int(np.argmax(distances))])
    final_model = fitted[selected_k]
    labels = final_model.labels_

    # PCA 仅用于 2D 可视化，不参与聚类训练。
    proj = PCA(n_components=2, random_state=SEED).fit_transform(X)
    point_idx = rng.choice(len(X), size=min(800, len(X)), replace=False)
    points = [[round(float(proj[i, 0]), 4), round(float(proj[i, 1]), 4), int(labels[i])] for i in point_idx]

    clusters = []
    for c in range(selected_k):
        mask = labels == c
        sub = df.loc[mask]
        reps = sub.sort_values("frequency", ascending=False)["product_name"].head(5).tolist()
        clusters.append({
            "id": c,
            "count": int(mask.sum()),
            "avgPriceUsd": round(float(sub["estimated_price_usd"].mean()), 3),
            "avgWeightG": round(float(sub["weight_g"].mean()), 3),
            "avgCalories100g": round(float(sub["calories_kcal_per_100g"].mean()), 3),
            "avgReorderRate": round(float((sub["reorder_count"] / sub["frequency"]).mean()), 4),
            "representatives": reps,
        })

    method = (
        "特征为真实价格/重量/热量/购买频次/复购比例（取对数后标准化）与部门 one-hot；"
        "KMeans(n_init=5, random_state=6143) 对 k=2..8 全量拟合记录 inertia；"
        "轮廓系数在固定 500 条随机子样本上计算；选中 k 用 inertia 曲线肘点距离最大值法；"
        "points 为 PCA 降维后的 800 条散点（x, y, label），仅用于可视化。"
    )
    return {
        "algorithm": "K-Means",
        "source": "Instacart REAL attributes",
        "features": feature_names,
        "sampleSize": int(len(df)),
        "kValues": k_values,
        "selectedK": selected_k,
        "kSelection": "max elbow distance（各 k 的 inertia 到首末连线垂距最大者）；轮廓系数仅作效果评价。",
        "points": points,
        "clusters": clusters,
        "method": method,
    }


def traffic_clustering(rng: np.random.RandomState) -> dict:
    """仿真走廊/行人状态上的 K-Means（k=2..6），全程 SIMULATED。"""
    feature_names = [
        "Pedestrian Density", "Average Dwell Time", "Walking Speed",
        "Corridor Occupancy", "Obstacle Count",
    ]
    # 生成规则：4 类潜在通道状态，每类给定 5 维均值与标准差，确定性采样后裁剪到物理合理区间。
    zones = [
        ("开阔顺畅通道", 180, [0.12, 8.0, 1.35, 0.15, 0.3], [0.04, 2.5, 0.10, 0.05, 0.5]),
        ("常规通行通道", 200, [0.35, 20.0, 1.00, 0.40, 1.5], [0.07, 4.0, 0.12, 0.08, 0.9]),
        ("高峰拥挤通道", 150, [0.68, 35.0, 0.65, 0.74, 2.5], [0.08, 6.0, 0.10, 0.09, 1.0]),
        ("障碍阻塞通道", 70, [0.50, 42.0, 0.48, 0.62, 6.0], [0.08, 7.0, 0.09, 0.10, 1.1]),
    ]
    lows = np.array([0.0, 2.0, 0.25, 0.0, 0.0])
    highs = np.array([1.0, 75.0, 1.70, 1.0, 9.0])
    blocks, truth = [], []
    for zi, (name, count, mean, std) in enumerate(zones):
        arr = rng.normal(np.array(mean), np.array(std), size=(count, 5))
        arr = np.clip(arr, lows, highs)
        arr[:, 4] = np.rint(arr[:, 4])
        blocks.append(arr)
        truth.extend([zi] * count)
    X_raw = np.vstack(blocks)
    truth = np.asarray(truth)

    scaler = StandardScaler()
    X = scaler.fit_transform(X_raw)

    k_values = []
    for k in range(2, 7):
        model = KMeans(n_clusters=k, n_init=5, random_state=SEED)
        model.fit(X)
        k_values.append({
            "k": k,
            "inertia": round(float(model.inertia_), 2),
            "silhouette": round(float(silhouette_score(X, model.labels_)), 4),
        })

    # 客流聚类同样用 inertia 曲线肘点距离最大值法选 k：k=2 的 silhouette 虽略高，
    # 但会把 4 类潜在通道状态合并成 2 类；肘点法保留可解释的分区，轮廓系数仅作评价。
    tks = np.array([v["k"] for v in k_values], dtype=float)
    tinertia = np.array([v["inertia"] for v in k_values], dtype=float)
    x1, y1, x2, y2 = tks[0], tinertia[0], tks[-1], tinertia[-1]
    tden = np.hypot(y2 - y1, x2 - x1)
    tdist = np.abs((y2 - y1) * tks - (x2 - x1) * tinertia + x2 * y1 - y2 * x1) / tden
    selected_k = int(tks[int(np.argmax(tdist))])
    final = KMeans(n_clusters=selected_k, n_init=5, random_state=SEED).fit(X)
    labels = final.labels_

    proj = PCA(n_components=2, random_state=SEED).fit_transform(X)
    points = [[round(float(proj[i, 0]), 4), round(float(proj[i, 1]), 4), int(labels[i])] for i in range(len(X))]

    clusters = []
    for c in range(selected_k):
        mask = labels == c
        sub = X_raw[mask]
        majority_zone = int(np.bincount(truth[mask], minlength=len(zones)).argmax())
        avg_density = float(sub[:, 0].mean())
        level = "Low" if avg_density < 0.30 else ("Medium" if avg_density < 0.55 else "High")
        clusters.append({
            "id": c,
            "label": level,
            "count": int(mask.sum()),
            "avgDensity": round(avg_density, 4),
            "avgDwell": round(float(sub[:, 1].mean()), 2),
            "avgSpeed": round(float(sub[:, 2].mean()), 3),
            "avgOccupancy": round(float(sub[:, 3].mean()), 4),
            "avgObstacles": round(float(sub[:, 4].mean()), 2),
            "zoneType": zones[majority_zone][0],
        })

    method = (
        "确定性仿真：numpy RandomState(6143) 按 4 类潜在通道状态（开阔/常规/高峰拥挤/障碍阻塞）"
        "采样 600 条 5 维走廊状态，裁剪到物理合理区间；标准化后 KMeans(n_init=5, random_state=6143) "
        "对 k=2..6 拟合，inertia 与 silhouette 均为真实计算；选中 k 取 inertia 曲线肘点距离最大者"
        "（silhouette 仅作评价，k=2 虽略高但会把 4 类潜在状态合并为 2 类）；points 为 PCA 2D 投影。"
        "该数据为 SIMULATED，不代表任何真实监控。"
    )
    return {
        "algorithm": "K-Means",
        "source": "SIMULATED pedestrian/corridor state (seed 6143)",
        "features": feature_names,
        "sampleSize": int(len(X_raw)),
        "kValues": k_values,
        "selectedK": selected_k,
        "points": points,
        "clusters": clusters,
        "method": method,
    }


def main() -> None:
    started = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.RandomState(SEED)

    product = product_clustering(rng)
    traffic = traffic_clustering(rng)
    print("product clusters:", len(product["clusters"]), "selectedK", product["selectedK"], flush=True)
    print("traffic clusters:", len(traffic["clusters"]), "selectedK", traffic["selectedK"], flush=True)

    payload = {
        "version": "1.0.0",
        "task": "两套独立 K-Means 聚类：Instacart 真实商品属性分群 + 仿真行人/走廊状态分群",
        "seed": SEED,
        "product": product,
        "traffic": traffic,
        "separation": "商品聚类与客流聚类使用不同数据集，分别训练与评价，绝不混用。",
        "disclaimers": [
            "商品聚类使用 Instacart 线上订单的真实商品属性与订单聚合；线上订单不等于实体门店真实销量。",
            "客流/走廊数据为 SIMULATED 确定性仿真（seed 6143），不是真实监控或真实行人观测，不得用作现实安防判断。",
            "PCA 2D 坐标仅为可视化投影，簇的含义以 clusters 中的原始单位均值为准。",
            "inertia、silhouette 与选中 k 均为 sklearn 真实运行结果，非人工设定。",
        ],
        "seconds": round(time.perf_counter() - started, 1),
    }
    write_json("clustering-analysis.json", payload)


if __name__ == "__main__":
    main()
