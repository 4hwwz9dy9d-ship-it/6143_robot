"""INT6143 NEXUS RETAIL 2.0 — 拥堵等级分类器（实验报告数据构建）。

用确定性仿真生成的走廊样本训练决策树与随机森林，将走廊状态分为 Low / Medium / High。
所有数据均为 SIMULATED（numpy RandomState(6143)），绝不代表真实监控。
所有评估指标均由 sklearn 在独立 20% 分层测试集上真实计算。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score)
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lab"
SEED = 6143
CLASSES = ["Low", "Medium", "High"]


def write_json(name: str, payload: dict) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("written", path, path.stat().st_size, "bytes", f"{payload['seconds']}s", flush=True)


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    prec = precision_score(y_true, y_pred, average=None, labels=[0, 1, 2], zero_division=0)
    rec = recall_score(y_true, y_pred, average=None, labels=[0, 1, 2], zero_division=0)
    f1 = f1_score(y_true, y_pred, average=None, labels=[0, 1, 2], zero_division=0)
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": {CLASSES[i]: round(float(prec[i]), 4) for i in range(3)},
        "recall": {CLASSES[i]: round(float(rec[i]), 4) for i in range(3)},
        "f1": {CLASSES[i]: round(float(f1[i]), 4) for i in range(3)},
        "macroF1": round(float(f1_score(y_true, y_pred, average="macro", labels=[0, 1, 2], zero_division=0)), 4),
        "confusion": confusion_matrix(y_true, y_pred, labels=[0, 1, 2]).tolist(),
    }


def main() -> None:
    started = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.RandomState(SEED)

    # ---- 仿真生成规则（确定性，seed 6143） ----
    # 潜在拥挤度驱动各特征；标签由同一潜在拥挤度打分按三分位数切分，保证三类别平衡。
    n = 1800
    density = rng.beta(2.0, 3.0, n)
    occupancy = np.clip(0.15 + 0.70 * density + rng.normal(0, 0.08, n), 0.0, 1.0)
    obstacles = np.clip(rng.poisson(1.2 + 2.5 * density, n), 0, 8).astype(float)
    speed = np.clip(1.50 - 0.90 * density - 0.05 * obstacles + rng.normal(0, 0.10, n), 0.20, 1.70)
    historical = np.clip(0.10 + 0.80 * density + rng.normal(0, 0.10, n), 0.0, 1.0)
    dwell = np.clip(5.0 + 45.0 * density + rng.normal(0, 4.0, n), 2.0, 75.0)

    score = (1.4 * density + 0.8 * occupancy + 0.12 * obstacles
             - 0.9 * speed + 0.6 * historical + rng.normal(0, 0.15, n))
    t1, t2 = np.quantile(score, [1 / 3, 2 / 3])
    y = np.where(score < t1, 0, np.where(score < t2, 1, 2)).astype(int)

    X = np.column_stack([density, obstacles, occupancy, speed, historical, dwell])
    feature_defs = [
        {"name": "pedestrian_density", "description": "行人密度（0-1 归一化，仿真）"},
        {"name": "obstacle_count", "description": "通道内障碍物数量（0-8，仿真）"},
        {"name": "corridor_occupancy", "description": "走廊占用率（0-1，仿真）"},
        {"name": "avg_walking_speed", "description": "平均步行速度 m/s（0.2-1.7，仿真）"},
        {"name": "historical_traffic", "description": "历史拥堵信号（滞后聚合代理，仿真）"},
        {"name": "avg_dwell_time", "description": "平均停留时间秒（2-75，仿真）"},
    ]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=SEED
    )
    print("split train/test:", len(y_train), len(y_test), flush=True)

    models = {
        "decision_tree": DecisionTreeClassifier(max_depth=6, class_weight="balanced", random_state=SEED),
        "random_forest": RandomForestClassifier(
            n_estimators=150, min_samples_leaf=5, class_weight="balanced",
            random_state=SEED, n_jobs=-1,
        ),
    }
    results, probas, preds = {}, {}, {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        preds[name] = pred
        probas[name] = model.predict_proba(X_test)
        results[name] = metrics(y_test, pred)
        print(name, results[name]["accuracy"], results[name]["macroF1"], flush=True)

    # 预测示例：从测试集中挑选一个真实标签 High 且随机森林预测 High 的样本，保证输出真实可复现。
    rf_pred = preds["random_forest"]
    candidates = np.where((y_test == 2) & (rf_pred == 2))[0]
    pick = int(candidates[int(np.argmax(probas["random_forest"][candidates, 2]))])
    row = X_test[pick]
    feature_values = {
        "pedestrian_density": round(float(row[0]), 4),
        "obstacle_count": int(row[1]),
        "corridor_occupancy": round(float(row[2]), 4),
        "avg_walking_speed": round(float(row[3]), 4),
        "historical_traffic": round(float(row[4]), 4),
        "avg_dwell_time": round(float(row[5]), 2),
    }
    probabilities = {CLASSES[i]: round(float(probas["random_forest"][pick, i]), 4) for i in range(3)}

    majority = int(np.bincount(y_train, minlength=3).argmax())
    baseline = {
        "name": "majority",
        "accuracy": round(float(np.mean(y_test == majority)), 4),
    }
    by_class = {c: int(np.sum(y == i)) for i, c in enumerate(CLASSES)}

    payload = {
        "version": "1.0.0",
        "task": "仿真走廊状态三分类：根据行人/障碍/占用等特征预测 Low / Medium / High 拥堵等级",
        "source": "SIMULATED labeled corridor samples (seed 6143)",
        "seed": SEED,
        "features": feature_defs,
        "classes": CLASSES,
        "split": {
            "method": "80/20 分层随机划分（stratify=y），训练/测试样本不相交。",
            "train": int(len(y_train)),
            "test": int(len(y_test)),
            "seed": SEED,
        },
        "samples": {"total": int(n), "byClass": by_class},
        "models": results,
        "predictionExample": {
            "features": feature_values,
            "probabilities": probabilities,
            "predicted": "High",
        },
        "baseline": baseline,
        "disclaimers": [
            "仿真标签，不是真实监控数据；全部样本由 numpy RandomState(6143) 确定性生成。",
            "标签由仿真规则按三分位数切分，类别平衡是人为设计的结果，不代表真实路口拥堵分布。",
            "historical_traffic 为滞后聚合代理信号，不是对真实历史监控的测量。",
            "混淆矩阵行为真实类别 Low/Medium/High，指标由 sklearn 在独立测试集上计算。",
        ],
        "seconds": round(time.perf_counter() - started, 1),
    }
    write_json("congestion-classifier.json", payload)


if __name__ == "__main__":
    main()
