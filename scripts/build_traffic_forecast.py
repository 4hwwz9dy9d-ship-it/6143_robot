"""INT6143 V2 — 仿真店内逐小时客流的短期预测（时间序列基线对比）。

重要声明（数据性质）：
- 本脚本的全部客流数据是确定性 SIMULATED 仿真数据（seed 6143），不是真实监控计数。
- Instacart 的 order_hour_of_day / summary.json 的 orderHour 是"用户下单时段"，
  绝不等于实体店内的进店客流。这里只把它归一化后作为"仿真形状模板"参与曲线构造，
  主峰仍由人工设定的高斯峰生成；它不代表任何真实到店人数。
- 评估协议：前 18 小时（0..17）用于初始化/训练，最后 6 小时（18..23）作为测试集，
  所有 MAE/RMSE/MAPE 只在这 6 个测试点上用 numpy 真实计算。
- MAPE 以百分比表示；actual=0 时用 epsilon=1e-9 作分母保护（并在 disclaimers 中说明）。
- 线性回归特征只由 hour 构造（hour, sin/cos hour, 固定规则的 is_peak），
  不使用任何未来/历史客流量，杜绝目标泄漏。
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
from sklearn.linear_model import LinearRegression

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lab"
SUMMARY = ROOT / "public/data/summary.json"
SEED = 6143

TRAIN_HOURS = 18   # 0..17 初始化/训练
TEST_HOURS = 6     # 18..23 测试集
WINDOW = 3
ALPHA = 0.4
EPS = 1e-9
FUTURE_STEPS = 6

NAME_MA = "Moving Average (window=3)"
NAME_ES = "Exponential Smoothing (alpha=0.4)"
NAME_LR = "Linear Regression (time features)"


def build_synthetic_counts(rng: np.random.Generator) -> np.ndarray:
    """构造确定性仿真客流（早/午/晚三峰）。

    orderHour 只作为归一化形状模板（仿真用途），不是真实进店人数。
    """
    summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
    shape = np.array([float(summary["orderHour"][str(h)]) for h in range(24)], dtype=np.float64)
    shape /= shape.max()

    hours = np.arange(24, dtype=np.float64)

    def bump(center: float, width: float) -> np.ndarray:
        return np.exp(-0.5 * ((hours - center) / width) ** 2)

    synthetic = (
        90.0
        + 250.0 * bump(9.0, 1.5)      # 早高峰（仿真）
        + 290.0 * bump(13.0, 1.8)     # 午高峰（仿真）
        + 330.0 * bump(18.5, 1.6)     # 晚高峰（仿真）
        + 120.0 * shape               # 归一化形状模板 contribution（仿真）
        + rng.normal(0.0, 6.0, size=24)
    )
    return np.clip(np.rint(synthetic), 5, None).astype(int)


def compute_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    """用 numpy 计算 MAE / RMSE / MAPE（MAPE 零值 epsilon 保护，单位为 %）。"""
    a = np.asarray(actual, dtype=np.float64)
    p = np.asarray(predicted, dtype=np.float64)
    err = np.abs(a - p)
    mae = float(np.mean(err))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    denom = np.maximum(np.abs(a), EPS)
    mape = float(np.mean(err / denom) * 100.0)
    return {"mae": mae, "rmse": rmse, "mape": mape}


def rounded(metrics: dict) -> dict:
    return {k: round(v, 2) for k, v in metrics.items()}


def lr_features(hour: int) -> list[float]:
    """线性回归特征：仅由 hour 构造，无任何客流量/未来信息。

    is_peak 是固定业务时段规则（8-12 点、17-19 点），不是从观测计数里挑出来的。
    """
    h = float(hour)
    is_peak = 1.0 if (8 <= hour <= 12 or 17 <= hour <= 19) else 0.0
    return [h, math.sin(2 * math.pi * h / 24.0), math.cos(2 * math.pi * h / 24.0), is_peak]


def future_moving_average(series: np.ndarray, steps: int, window: int) -> list[float]:
    """MA 递推：把上一步预测值回填进历史，继续滚动求均值。"""
    hist = [float(v) for v in series]
    out = []
    for _ in range(steps):
        nxt = float(np.mean(hist[-window:]))
        out.append(nxt)
        hist.append(nxt)
    return out


def future_exp_smoothing(level: float, steps: int, alpha: float) -> list[float]:
    """指数平滑递推：无新实际值时，用上一步预测同时作为新观测更新水平。"""
    out = []
    lvl = level
    for _ in range(steps):
        out.append(lvl)
        lvl = alpha * lvl + (1.0 - alpha) * lvl
    return out


def main() -> None:
    started = time.perf_counter()
    rng = np.random.default_rng(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    counts = build_synthetic_counts(rng)
    test_hours = list(range(TRAIN_HOURS, 24))
    actual = counts[test_hours]

    # ---- 方法 1：移动平均（一步向前，滑动窗口只用当前 hour 之前的历史） ----
    ma_preds = [float(np.mean(counts[t - WINDOW:t])) for t in test_hours]

    # ---- 方法 2：简单指数平滑（训练段初始化，测试段一步向前） ----
    es_preds: list[float] = []
    es_level = float(counts[0])
    for t in range(1, 24):
        if t >= TRAIN_HOURS:
            es_preds.append(es_level)  # 对 t 的预测来自 t-1 时刻的水平
        es_level = ALPHA * float(counts[t]) + (1.0 - ALPHA) * es_level
    final_es_level = es_level  # 已吸收全部 24 小时实际值，用于未来递推

    # ---- 方法 3：线性回归（特征只含 hour 派生的 4 项，训练只用前 18 小时） ----
    X_train = np.asarray([lr_features(h) for h in range(TRAIN_HOURS)], dtype=np.float64)
    y_train = counts[:TRAIN_HOURS].astype(np.float64)
    lr = LinearRegression().fit(X_train, y_train)
    X_test = np.asarray([lr_features(h) for h in test_hours], dtype=np.float64)
    lr_preds = [float(v) for v in lr.predict(X_test)]

    # 预测值统一保留 2 位小数，指标与实际值展示使用同一份数据
    raw_preds = {NAME_MA: ma_preds, NAME_ES: es_preds, NAME_LR: lr_preds}
    preds = {k: [round(float(v), 2) for v in vv] for k, vv in raw_preds.items()}

    specs = [
        (NAME_MA, {"window": WINDOW}),
        (NAME_ES, {"alpha": ALPHA}),
        (NAME_LR, {"features": "hour, sin/cos hour, is_peak"}),
    ]
    methods = []
    raw_metrics = {}
    for name, params in specs:
        m = compute_metrics(actual, preds[name])
        raw_metrics[name] = m
        methods.append({
            "name": name,
            "params": params,
            "mae": round(m["mae"], 2),
            "rmse": round(m["rmse"], 2),
            "mape": round(m["mape"], 2),
            "actualVsPredicted": [
                {"hour": int(h), "actual": int(counts[h]), "predicted": preds[name][i]}
                for i, h in enumerate(test_hours)
            ],
        })
        print(f"{name}: mae={m['mae']:.2f} rmse={m['rmse']:.2f} mape={m['mape']:.2f}%", flush=True)

    best = min(specs, key=lambda s: (raw_metrics[s[0]]["mae"], raw_metrics[s[0]]["rmse"]))[0]

    # ---- 未来 6 小时预测（来自最优方法，递推 / 模型 predict） ----
    if best == NAME_MA:
        future_vals = future_moving_average(counts, FUTURE_STEPS, WINDOW)
    elif best == NAME_ES:
        future_vals = future_exp_smoothing(final_es_level, FUTURE_STEPS, ALPHA)
    else:
        X_future = np.asarray([lr_features(h) for h in range(24, 24 + FUTURE_STEPS)], dtype=np.float64)
        future_vals = [float(v) for v in lr.predict(X_future)]
    future = [{"hour": 24 + i, "predicted": round(float(v), 2), "method": best}
              for i, v in enumerate(future_vals)]

    peak_order = np.argsort(-counts)
    valley_order = np.argsort(counts)

    payload = {
        "version": "1.0.0",
        "task": "仿真店内逐小时客流的短期预测：比较移动平均、指数平滑与线性回归，在最后 6 小时测试集上计算 MAE/RMSE/MAPE，并给出未来 6 小时预测。MAE/RMSE 为计数误差，MAPE 为百分比且对 actual=0 用 epsilon=1e-9 做分母保护；LR 的 is_peak 为固定时段规则，仅由 hour 派生。",
        "source": "SIMULATED hourly in-store footfall (seed 6143)",
        "seed": SEED,
        "seconds": round(time.perf_counter() - started, 1),
        "hourly": [{"hour": int(h), "count": int(counts[h]), "label": f"{int(h):02d}:00"}
                   for h in range(24)],
        "peak": [{"hour": int(h), "count": int(counts[h])} for h in peak_order[:3]],
        "valley": [{"hour": int(h), "count": int(counts[h])} for h in valley_order[:3]],
        "methods": methods,
        "bestMethod": best,
        "future": future,
        "evaluationProtocol": "留出最后 6 小时作为测试集，前 18 小时训练/初始化；指标只在测试集计算。",
        "disclaimers": [
            "仿真客流，不是真实监控",
            "Instacart 下单时段 ≠ 店内客流",
            "summary.json 的 orderHour 仅作为归一化仿真形状模板参与曲线构造，绝非真实进店人数；主峰为人工设定的仿真高峰。",
            "MAE/RMSE 为计数误差；MAPE 以百分比表示，actual=0 时以 epsilon=1e-9 作分母保护。",
            "所有指标均由模型在测试集上的真实输出计算得到，非人工填写；未来 6 小时为递推/外推预测，置信度有限。",
        ],
    }

    out = OUT / "traffic-forecast.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", out, out.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
