"""INT6143 V2 — 多域仿真状态异常检测（IsolationForest）。

重要声明（数据性质）：
- 四个域的全部记录都是确定性 SIMULATED 仿真数据（seed 6143），不是真实传感器/运营数据。
- 每个域使用各自独立的 4 维特征空间，分别拟合 IsolationForest 并打分。
- 注入少量极端点使异常可被检测；异常分数是模型相对离群程度，不是"已确认故障"的标签。
- reason 由真实计算得到：用正常样本的均值/标准差求各特征 z 分数，取最偏离的分量生成中文说明。
- scatter 的 value 为各域第一个特征的取值，用于前端散点图；每域最多 120 点。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lab"
SEED = 6143
N_SAMPLES = 400
N_EXTREME = 10
CONTAMINATION = 0.05
N_ESTIMATORS = 150
SCATTER_LIMIT = 120


# 每个域：(key, label, features, zh names, source, 每维 (mean, std, lo, hi))
DOMAINS = [
    {
        "key": "crowd",
        "label": "异常客流",
        "features": ["Pedestrian Density", "Corridor Occupancy", "Dwell Time", "Walking Speed"],
        "zh": ["行人密度", "通道占用率", "停留时间", "行走速度"],
        "source": "SIMULATED pedestrian sensor state (seed 6143)",
        "params": [(1.8, 0.45, 0.05, 12.0), (0.42, 0.09, 0.02, 1.0),
                   (48.0, 14.0, 3.0, 400.0), (1.25, 0.18, 0.05, 3.0)],
    },
    {
        "key": "travel",
        "label": "异常通行时间",
        "features": ["Corridor Length", "Crowd Density", "Obstacle Count", "Actual Travel Time"],
        "zh": ["通道长度", "人群密度", "障碍物数", "实际通行时间"],
        "source": "SIMULATED corridor travel state (seed 6143)",
        "params": [(32.0, 8.0, 5.0, 200.0), (1.6, 0.40, 0.05, 12.0),
                   (1.2, 0.90, 0.0, 15.0), (26.0, 7.0, 2.0, 300.0)],
    },
    {
        "key": "robot",
        "label": "机器人运行异常",
        "features": ["Speed", "Battery Drain", "Replan Count", "Emergency Stop Seconds"],
        "zh": ["机器人速度", "电池消耗", "重规划次数", "急停秒数"],
        "source": "SIMULATED robot telemetry state (seed 6143)",
        "params": [(0.90, 0.15, 0.0, 3.0), (2.4, 0.60, 0.0, 20.0),
                   (0.8, 0.90, 0.0, 20.0), (1.5, 2.0, 0.0, 200.0)],
    },
    {
        "key": "inventory",
        "label": "异常库存变化",
        "features": ["Stock Level", "Restock Count", "Time Since Restock", "Demand Rate"],
        "zh": ["库存水平", "补货次数", "距上次补货时间", "需求速率"],
        "source": "SIMULATED inventory state (seed 6143)",
        "params": [(120.0, 30.0, 0.0, 1000.0), (2.0, 1.10, 0.0, 20.0),
                   (6.5, 2.50, 0.0, 100.0), (14.0, 4.0, 0.0, 150.0)],
    },
]


def generate_domain_data(rng: np.random.Generator, spec: dict) -> tuple[np.ndarray, np.ndarray]:
    """生成正常样本 + 注入极端点；返回 (含异常的数据, 仅正常数据)。"""
    params = spec["params"]
    d = len(params)
    X = np.empty((N_SAMPLES, d), dtype=np.float64)
    for j, (mu, sd, lo, hi) in enumerate(params):
        X[:, j] = np.clip(rng.normal(mu, sd, N_SAMPLES), lo, hi)
    normal_X = X.copy()

    injected = rng.choice(N_SAMPLES, size=N_EXTREME, replace=False)
    for r, row in enumerate(injected):
        n_features = 1 + (r % 2)                       # 每条异常 1~2 个维度极端
        cols = rng.choice(d, size=n_features, replace=False)
        for c in cols:
            mu, sd, lo, hi = params[c]
            # 多数向上极端；robot 速度与 inventory 库存交替出现向下极端
            downward = (spec["key"] == "robot" and c == 0 and r % 2 == 0) or \
                       (spec["key"] == "inventory" and c == 0 and r % 2 == 0)
            sign = -1.0 if downward else 1.0
            value = mu + sign * (4.5 + rng.uniform(0.0, 2.0)) * sd
            X[row, c] = float(np.clip(value, lo, hi))
    return X, normal_X


def make_time(idx: int) -> str:
    hour = 8 + (idx * 11 // N_SAMPLES) % 12
    minute = (idx * 17 + 23) % 60
    return f"{hour:02d}:{minute:02d}"


def make_location(idx: int) -> str:
    aisle = 1 + (idx * 7 + 3) % 24
    corridor = 1 + (idx * 3 + 1) % 8
    return f"Aisle {aisle} / Corridor {corridor}"


def make_reason(spec: dict, row: np.ndarray, normal_X: np.ndarray) -> str:
    """基于正常样本统计的 z 分数，生成中文可读的离群原因。"""
    mu = normal_X.mean(axis=0)
    sd = normal_X.std(axis=0) + 1e-9
    z = (row - mu) / sd
    order = np.argsort(-np.abs(z))
    top = int(order[0])
    direction = "高于" if z[top] > 0 else "低于"
    parts = [f"{spec['zh'][top]} {row[top]:.2f} 显著{direction}均值 {mu[top]:.2f}（z={z[top]:+.1f}）"]
    for j in order[1:]:
        if abs(z[j]) >= 2.0 and len(parts) < 2:
            d = "高于" if z[j] > 0 else "低于"
            parts.append(f"{spec['zh'][j]} {row[j]:.2f} {d}均值 {mu[j]:.2f}（z={z[j]:+.1f}）")
    return "；".join(parts)


def main() -> None:
    started = time.perf_counter()
    rng = np.random.default_rng(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    domains = []
    for spec in DOMAINS:
        X, normal_X = generate_domain_data(rng, spec)
        model = IsolationForest(n_estimators=N_ESTIMATORS, contamination=CONTAMINATION,
                                random_state=SEED)
        model.fit(X)
        # sklearn: score_samples 越低越异常；取负号使"分数越高 = 越离群"
        score = -model.score_samples(X)
        pred = model.predict(X)
        anomaly_idx = np.where(pred == -1)[0]
        inlier_idx = np.where(pred == 1)[0]

        anomalies = []
        for i in sorted(anomaly_idx, key=lambda k: -score[k]):
            idx = int(i)
            anomalies.append({
                "id": f"{spec['key']}-{idx:03d}",
                "time": make_time(idx),
                "location": make_location(idx),
                "score": round(float(score[idx]), 4),
                "reason": make_reason(spec, X[idx], normal_X),
                "values": {name: round(float(X[idx, j]), 2)
                           for j, name in enumerate(spec["features"])},
            })

        # 散点：全部异常（最多 60）+ 确定性抽样的内点，总共不超过 120
        chosen = [int(i) for i in anomaly_idx[:60]]
        need = SCATTER_LIMIT - len(chosen)
        if need > 0 and len(inlier_idx):
            extra = rng.choice(inlier_idx, size=min(need, len(inlier_idx)), replace=False)
            chosen.extend(int(i) for i in extra)
        chosen = sorted(set(chosen))[:SCATTER_LIMIT]
        scatter = [{
            "value": round(float(X[i, 0]), 2),
            "score": round(float(score[i]), 4),
            "isAnomaly": bool(pred[i] == -1),
        } for i in chosen]

        domains.append({
            "key": spec["key"],
            "label": spec["label"],
            "features": spec["features"],
            "source": spec["source"],
            "total": N_SAMPLES,
            "anomalyCount": int(len(anomaly_idx)),
            "scoreStats": {
                "min": round(float(np.min(score)), 4),
                "median": round(float(np.median(score)), 4),
                "max": round(float(np.max(score)), 4),
            },
            "anomalies": anomalies,
            "scatter": scatter,
        })
        print(f"{spec['key']}: anomalies={len(anomaly_idx)} "
              f"score[{domains[-1]['scoreStats']['min']}, {domains[-1]['scoreStats']['max']}]", flush=True)

    payload = {
        "version": "1.0.0",
        "task": "四个仿真域（客流 / 通行时间 / 机器人运行 / 库存变化）各自拟合 IsolationForest 并检测相对离群点；scatter.value 为各域第一个特征的取值，用于前端散点图。",
        "method": "IsolationForest",
        "source": "SIMULATED domain-specific state (seed 6143)",
        "seed": SEED,
        "seconds": round(time.perf_counter() - started, 1),
        "contamination": CONTAMINATION,
        "domains": domains,
        "methodNote": "Each domain is fitted and scored independently with its own feature space; scores are model outputs, not labeled ground truth.",
        "disclaimers": [
            "仿真数据",
            "异常分数只表示相对离群程度，不代表已确认故障",
            "四域数据均由 seed 6143 确定性生成并人工注入极端点，仅用于演示异常检测流程，不反映真实门店状态。",
            "reason 由正常样本的均值/标准差计算 z 分数得到，是对模型判定离群的事后解释，不是故障根因诊断。",
            "contamination=0.05 是模型预设的异常比例，anomalyCount 为模型输出而非真实异常数量。",
        ],
    }

    out = OUT / "anomaly-detection.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", out, out.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
