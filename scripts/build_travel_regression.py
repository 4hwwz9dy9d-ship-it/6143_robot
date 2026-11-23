"""INT6143 NEXUS RETAIL 2.0 — 通行时间回归（实验报告数据构建）。

用确定性物理规则生成仿真通行记录（numpy RandomState(6143)），训练标准化线性回归与
随机森林，在独立 20% 测试集上评价。全部数据为 SIMULATED，绝不代表真实监控。

无泄漏设计：historical_travel_time 是独立的滞后/聚合走廊信号（只由长度、密度、障碍等
输入特征与自己的独立噪声生成），不依赖目标标签的噪声项，因此不含测试标签泄漏。
所有指标、散点均为真实模型输出。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lab"
SEED = 6143


def write_json(name: str, payload: dict) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", path, path.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


def evaluate(y_true: np.ndarray, pred: np.ndarray) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y_true, pred)), 3),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, pred))), 3),
        "r2": round(float(r2_score(y_true, pred)), 4),
    }


def main() -> None:
    started = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.RandomState(SEED)

    # ---- 仿真生成规则（确定性，seed 6143） ----
    n = 1200
    length = rng.uniform(8.0, 60.0, n)                      # 通道长度 m
    density = rng.beta(2.0, 3.0, n)                         # 人群密度
    obstacles = np.clip(rng.poisson(0.9 + 1.5 * density, n), 0, 6).astype(float)
    occupancy = np.clip(0.10 + 0.75 * density + rng.normal(0, 0.05, n), 0.0, 1.0)
    speed = np.clip(1.40 - 0.70 * density - 0.04 * obstacles + rng.normal(0, 0.08, n), 0.30, 1.60)

    # 滞后/聚合走廊信号：只依赖输入特征与自己的独立噪声，不使用 y 的噪声项 -> 无目标泄漏。
    historical = (length / (1.20 - 0.50 * density)) * (1.0 + 0.5 * density + 0.2 * obstacles) \
        + rng.normal(0, 1.5, n)

    # 物理规则：time = length / speed * (1 + 1.4*density + 0.6*obstacles) + noise
    base = length / speed * (1.0 + 1.4 * density + 0.6 * obstacles)
    noise = rng.normal(0, np.maximum(2.0, 0.06 * base), n)
    y = base + noise

    X = np.column_stack([length, density, obstacles, occupancy, speed, historical])
    feature_defs = [
        {"name": "corridor_length_m", "description": "通道长度（米，8-60，仿真）"},
        {"name": "crowd_density", "description": "人群密度（0-1，仿真）"},
        {"name": "obstacle_count", "description": "障碍物数量（0-6，仿真）"},
        {"name": "corridor_occupancy", "description": "通道占用率（0-1，仿真）"},
        {"name": "pedestrian_speed", "description": "行人速度 m/s（0.3-1.6，仿真）"},
        {"name": "historical_travel_time", "description": "历史通行时间滞后/聚合信号（仿真，不含目标噪声）"},
    ]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.20, random_state=SEED)
    print("split train/test:", len(y_train), len(y_test), flush=True)

    baseline_pred = np.full_like(y_test, float(y_train.mean()))
    baseline_metrics = evaluate(y_test, baseline_pred)
    baseline_metrics["name"] = "mean"

    models = {
        "linear_regression": Pipeline([
            ("scaler", StandardScaler()),
            ("model", LinearRegression()),
        ]),
        "random_forest": RandomForestRegressor(
            n_estimators=150, min_samples_leaf=5, random_state=SEED, n_jobs=-1,
        ),
    }
    predictions = {}
    results = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        predictions[name] = pred
        m = evaluate(y_test, pred)
        m["baseline"] = dict(baseline_metrics)
        results[name] = m
        print(name, m, flush=True)

    # 最佳模型（测试集 RMSE 最小）输出 60 个随机真实测试样本的 actual / predicted。
    best_name = min(results, key=lambda k: results[k]["rmse"])
    best_pred = predictions[best_name]
    sample_rng = np.random.RandomState(SEED)
    idx = sample_rng.choice(len(y_test), size=min(60, len(y_test)), replace=False)
    actual_vs_predicted = [
        {"actual": round(float(y_test[i]), 3), "predicted": round(float(best_pred[i]), 3)}
        for i in idx
    ]

    payload = {
        "version": "1.0.0",
        "task": "由走廊几何与人流仿真特征预测 Estimated Travel Time (s)（回归）",
        "source": "SIMULATED corridor traversals (seed 6143)",
        "seed": SEED,
        "target": "Estimated Travel Time (s)",
        "features": feature_defs,
        "split": {
            "method": "80/20 随机划分（random_state=6143），训练/测试通行记录不相交。",
            "train": int(len(y_train)),
            "test": int(len(y_test)),
            "seed": SEED,
        },
        "models": results,
        "actualVsPredicted": actual_vs_predicted,
        "method": (
            "独立测试集评价；历史通行时间为仿真生成，不含测试标签泄漏。"
            "生成规则 time = length/speed*(1+1.4*density+0.6*obstacles)+noise，"
            "其中历史通行时间为独立的滞后/聚合代理信号，与目标噪声无关。"
            "线性回归在 StandardScaler Pipeline 中训练；均报告均值预测基线。"
            f"actualVsPredicted 为测试集上性能最佳模型（{best_name}，按 RMSE）的 60 个随机真实样本输出。"
        ),
        "disclaimers": [
            "全部通行记录为 SIMULATED 仿真（seed 6143），不是真实监控或真实机器人运行日志。",
            "物理公式中的系数是教学用假设参数，不代表真实场景标定结果。",
            "historical_travel_time 为仿真滞后信号，不含测试标签泄漏；线上部署需重新验证。",
            "MAE / RMSE / R² 与散点均为 sklearn 在独立测试集上的真实计算结果。",
        ],
        "seconds": round(time.perf_counter() - started, 1),
    }
    write_json("travel-regression.json", payload)


if __name__ == "__main__":
    main()
