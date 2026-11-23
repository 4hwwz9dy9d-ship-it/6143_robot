"""NEXUS RETAIL 2.1 — 浏览器可部署的离线训练模型导出（seed 6143）。

本脚本只创建一个新文件 public/data/lab/runtime-models.json，导出 4 个模型的
「可部署结构」而不只是指标，使前端可直接在浏览器用 JS 执行推理：
  risk_rf       — 随机森林：导出 12 棵树的紧凑结构，JS 遍历树做分类
  travel_lr     — 标准化线性回归：导出 mean/scale/coef/intercept
  traffic_kmeans — KMeans：导出按密度升序重编号的质心，JS 最近质心分类
  anomaly_if    — IsolationForest：导出真实 decision_function 阈值 + 各域正态统计

所有样本由 numpy RandomState(6143) 确定性仿真生成；所有指标由 sklearn 真实计算。
数据为 SIMULATED，绝不代表真实监控。不修改任何现有文件。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             mean_absolute_error, r2_score, silhouette_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lab" / "runtime-models.json"
SEED = 6143


def write_json(payload: dict, secs: float) -> None:
    """写入紧凑 JSON 并按要求打印 written <path> <bytes> bytes <secs>s。"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text, encoding="utf-8")
    print(f"written {OUT} {OUT.stat().st_size} bytes {secs}s", flush=True)


def export_tree(tree) -> dict:
    """把 sklearn DecisionTree 转成紧凑可序列化结构，threshold 用 float，value 用 count。"""
    t = tree.tree_
    v = np.asarray(t.value)
    n_nodes = int(t.n_node_samples.shape[0])
    proportions = False
    if v.ndim == 3 and v.shape[0] == n_nodes:
        if v.shape[1] == 1:            # sklearn >=1.9: (n_nodes, n_outputs, n_classes) 比例
            v = v[:, 0, :]
            proportions = True
        else:                          # 旧版: (n_nodes, n_classes, n_outputs) 计数
            v = v[:, :, 0]
    # 新版 value 是类别比例，需乘节点样本数还原为 count（每行之和 == n_node_samples）
    value = np.rint(v * t.n_node_samples[:, None]).astype(int) if proportions else np.rint(v).astype(int)
    return {
        "children_left": [int(x) for x in t.children_left],
        "children_right": [int(x) for x in t.children_right],
        "feature": [int(x) for x in t.feature],
        "threshold": [float(x) for x in t.threshold],
        "value": [[int(x) for x in row] for row in value],
    }


# ---------------------------------------------------------------------------
# (1) risk_rf — RandomForestClassifier 拥堵风险分类
# ---------------------------------------------------------------------------
def build_risk_rf(rng: np.random.RandomState) -> dict:
    names = ['pedestrian_density', 'robot_ped_distance', 'relative_velocity',
             'ttc', 'corridor_width', 'obstacle_count']
    n = 1800
    density = rng.beta(2.0, 3.0, n)                                   # 行人密度高 -> 高风险
    robot_ped_distance = np.clip(4.0 - 3.0 * density + rng.normal(0, 0.45, n), 0.2, 6.0)  # 距离近 -> 高风险
    relative_velocity = np.clip(0.4 + 1.6 * density + rng.normal(0, 0.25, n), 0.0, 3.0)    # 相对速度高 -> 高风险
    ttc = np.clip(8.0 - 6.0 * density + rng.normal(0, 0.7, n), 0.3, 12.0)                  # TTC 低 -> 高风险
    corridor_width = np.clip(3.6 - 2.2 * density + rng.normal(0, 0.3, n), 0.8, 4.0)        # 通道窄 -> 高风险
    obstacles = np.clip(rng.poisson(0.8 + 2.2 * density, n), 0, 8).astype(float)            # 障碍多 -> 高风险

    # 风险打分：密度↑、障碍↑、通道窄、TTC↓、距离近、相对速度↑ -> 分高
    score = (2.0 * density - 0.35 * robot_ped_distance + 0.5 * relative_velocity
             - 0.45 * ttc - 0.8 * corridor_width + 0.35 * obstacles
             + rng.normal(0, 0.2, n))
    t1, t2 = np.quantile(score, [1 / 3, 2 / 3])
    y = np.where(score < t1, 0, np.where(score < t2, 1, 2)).astype(int)
    X = np.column_stack([density, robot_ped_distance, relative_velocity,
                         ttc, corridor_width, obstacles])

    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=SEED)
    clf = RandomForestClassifier(
        n_estimators=12, max_depth=6, min_samples_leaf=12, random_state=SEED)
    clf.fit(X_tr, y_tr)
    pred = clf.predict(X_te)

    metrics = {
        "accuracy": round(float(accuracy_score(y_te, pred)), 4),
        "macroF1": round(float(f1_score(y_te, pred, average="macro", labels=[0, 1, 2], zero_division=0)), 4),
        "confusion": [[int(v) for v in row] for row in confusion_matrix(y_te, pred, labels=[0, 1, 2])],
    }
    return {
        "featureNames": names,
        "classes": [0, 1, 2],
        "trees": [export_tree(t) for t in clf.estimators_],
        "metrics": metrics,
        "split": {"train": int(len(y_tr)), "test": int(len(y_te)), "seed": SEED},
    }


# ---------------------------------------------------------------------------
# (2) travel_lr — 标准化线性回归通行时间
# ---------------------------------------------------------------------------
def build_travel_lr(rng: np.random.RandomState) -> dict:
    names = ['corridor_length', 'ped_density', 'occupancy', 'walking_speed', 'obstacle_count']
    n = 1200
    length = rng.uniform(8.0, 60.0, n)
    density = rng.beta(2.0, 3.0, n)
    occupancy = np.clip(0.15 + 0.7 * density + rng.normal(0, 0.08, n), 0.0, 1.0)
    speed = np.clip(rng.normal(1.3, 0.25, n), 0.4, 2.0)
    obstacles = np.clip(rng.poisson(1.0, n), 0, 8).astype(float)
    target = (length / speed * (1.0 + 1.2 * density + 0.5 * obstacles + 0.3 * occupancy)
              + rng.normal(0, 1.5, n))
    X = np.column_stack([length, density, occupancy, speed, obstacles])

    X_tr, X_te, y_tr, y_te = train_test_split(X, target, test_size=0.20, random_state=SEED)
    pipe = Pipeline([("scaler", StandardScaler()), ("reg", LinearRegression())])
    pipe.fit(X_tr, y_tr)
    pred = pipe.predict(X_te)

    scaler = pipe.named_steps["scaler"]
    reg = pipe.named_steps["reg"]
    deployable = {
        "mean": [float(x) for x in scaler.mean_],
        "scale": [float(x) for x in scaler.scale_],
        "coef": [float(x) for x in reg.coef_],
        "intercept": float(reg.intercept_),
    }
    metrics = {
        "mae": round(float(mean_absolute_error(y_te, pred)), 4),
        "rmse": round(float(np.sqrt(np.mean((y_te - pred) ** 2))), 4),
        "r2": round(float(r2_score(y_te, pred)), 4),
    }
    return {
        "featureNames": names,
        "deployable": deployable,
        "metrics": metrics,
        "split": {"train": int(len(y_tr)), "test": int(len(y_te)), "seed": SEED},
    }


# ---------------------------------------------------------------------------
# (3) traffic_kmeans — KMeans 客流聚类
# ---------------------------------------------------------------------------
def build_traffic_kmeans(rng: np.random.RandomState) -> dict:
    names = ['pedestrian_density', 'avg_speed', 'dwell_time', 'corridor_occupancy', 'pedestrian_count']
    n = 600
    density = rng.beta(2.0, 2.5, n)
    avg_speed = np.clip(1.5 - 0.9 * density + rng.normal(0, 0.12, n), 0.2, 1.7)
    dwell = np.clip(5.0 + 45.0 * density + rng.normal(0, 4.0, n), 2.0, 75.0)
    occupancy = np.clip(0.15 + 0.75 * density + rng.normal(0, 0.07, n), 0.0, 1.0)
    ped_count = np.clip(rng.poisson(5 + 35 * density, n), 0, 80).astype(float)
    X = np.column_stack([density, avg_speed, dwell, occupancy, ped_count])

    km = KMeans(n_clusters=4, n_init=10, random_state=SEED)
    labels = km.fit_predict(X)

    # 按 pedestrian_density（第 0 维）升序重编号质心，标签名本身已按流量升序
    order = np.argsort(km.cluster_centers_[:, 0])
    centroids = [[float(x) for x in km.cluster_centers_[i]] for i in order]
    label_names = ['Low Traffic Area', 'Medium Traffic Area',
                   'High Traffic Area', 'Congestion Hotspot']
    sil = round(float(silhouette_score(X, labels, sample_size=500, random_state=SEED)), 4)
    return {
        "featureNames": names,
        "centroids": centroids,
        "labels": label_names,
        "inertia": round(float(km.inertia_), 4),
        "silhouette": sil,
        "source": "SIMULATED",
    }


# ---------------------------------------------------------------------------
# (4) anomaly_if — IsolationForest 异常阈值（4 个领域）
# ---------------------------------------------------------------------------
def build_anomaly_if(rng: np.random.RandomState) -> dict:
    CONTAM = 0.05
    domains = ['crowd', 'travel', 'robot', 'trajectory']

    def simulate(domain: str, n: int = 400):
        """返回 (正常样本, 极端点)，特征顺序与 featureNames 一致。"""
        if domain == 'crowd':
            # density, occupancy, dwell, speed
            d = rng.beta(2.0, 3.0, n)
            occ = np.clip(0.2 + 0.6 * d + rng.normal(0, 0.07, n), 0, 1)
            dwell = np.clip(5 + 40 * d + rng.normal(0, 4, n), 2, 80)
            speed = np.clip(1.5 - 0.9 * d + rng.normal(0, 0.1, n), 0.2, 1.7)
            normal = np.column_stack([d, occ, dwell, speed])
            extreme = np.array([
                [0.98, 0.99, 78, 0.22], [0.96, 0.97, 75, 0.25],
                [0.99, 0.98, 80, 0.20], [0.97, 0.99, 79, 0.23],
                [0.95, 0.96, 76, 0.24], [0.98, 0.99, 80, 0.21],
            ])
            names = ['density', 'occupancy', 'dwell', 'speed']
        elif domain == 'travel':
            # corridor_length, ped_density, occupancy, walking_speed, obstacle_count
            L = rng.uniform(8, 50, n)
            d = rng.beta(2.0, 3.0, n)
            occ = np.clip(0.15 + 0.7 * d + rng.normal(0, 0.07, n), 0, 1)
            sp = np.clip(rng.normal(1.3, 0.25, n), 0.4, 2.0)
            ob = np.clip(rng.poisson(1.0, n), 0, 8).astype(float)
            normal = np.column_stack([L, d, occ, sp, ob])
            extreme = np.array([
                [60, 0.98, 0.99, 0.42, 8], [58, 0.97, 0.98, 0.40, 8],
                [59, 0.99, 0.99, 0.41, 7], [57, 0.96, 0.97, 0.43, 8],
                [60, 0.98, 0.99, 0.40, 8], [56, 0.98, 0.98, 0.41, 7],
            ])
            names = ['corridor_length', 'ped_density', 'occupancy', 'walking_speed', 'obstacle_count']
        elif domain == 'robot':
            # ped_distance, relative_velocity, ttc, obstacle_count, robot_speed
            dist = np.clip(rng.uniform(1.5, 6.0, n) + rng.normal(0, 0.3, n), 0.3, 7)
            rv = np.clip(rng.normal(0.8, 0.3, n), 0.0, 2.0)
            ttc = np.clip(rng.uniform(3, 12, n) + rng.normal(0, 0.6, n), 0.4, 14)
            ob = np.clip(rng.poisson(1.0, n), 0, 8).astype(float)
            rs = np.clip(rng.normal(1.1, 0.2, n), 0.3, 1.8)
            normal = np.column_stack([dist, rv, ttc, ob, rs])
            extreme = np.array([
                [0.25, 2.0, 0.4, 8, 1.7], [0.30, 1.9, 0.5, 7, 1.8],
                [0.20, 2.0, 0.4, 8, 1.7], [0.28, 1.8, 0.45, 8, 1.6],
                [0.22, 2.0, 0.42, 7, 1.8], [0.26, 1.9, 0.48, 8, 1.7],
            ])
            names = ['ped_distance', 'relative_velocity', 'ttc', 'obstacle_count', 'robot_speed']
        else:  # trajectory
            # avg_speed, dwell_time, path_deviation, turn_rate, ped_count
            sp = np.clip(rng.normal(1.2, 0.25, n), 0.3, 1.8)
            dwell = np.clip(rng.normal(12, 5, n), 2, 60)
            dev = np.clip(rng.normal(0.3, 0.12, n), 0.0, 1.2)
            turn = np.clip(rng.normal(20, 8, n), 0, 120)
            pc = np.clip(rng.poisson(12, n), 0, 60).astype(float)
            normal = np.column_stack([sp, dwell, dev, turn, pc])
            extreme = np.array([
                [0.25, 58, 1.2, 118, 60], [0.30, 55, 1.1, 115, 58],
                [0.22, 60, 1.2, 120, 60], [0.28, 57, 1.15, 116, 59],
                [0.27, 59, 1.18, 119, 60], [0.24, 56, 1.12, 117, 58],
            ])
            names = ['avg_speed', 'dwell_time', 'path_deviation', 'turn_rate', 'ped_count']
        return normal, extreme, names

    result = {}
    for domain in domains:
        normal, extreme, names = simulate(domain)
        X = np.vstack([normal, extreme])
        model = IsolationForest(n_estimators=120, contamination=CONTAM, random_state=SEED)
        pred = model.fit_predict(X)
        scores = model.decision_function(X)          # 越低越异常
        threshold = float(np.percentile(scores, CONTAM * 100))
        mask = pred == 1                             # 正常点
        normal_mean = [float(x) for x in X[mask].mean(axis=0)] if mask.any() else [0.0] * X.shape[1]
        normal_std = [float(x) for x in X[mask].std(axis=0)] if mask.any() else [1.0] * X.shape[1]
        result[domain] = {
            "featureNames": names,
            "scoreThreshold": round(threshold, 6),
            "normalMean": normal_mean,
            "normalStd": normal_std,
            "anomalyCount": int(np.sum(pred == -1)),
        }
    return result


def main() -> None:
    started = time.perf_counter()
    rng = np.random.RandomState(SEED)

    risk = build_risk_rf(rng)
    travel = build_travel_lr(rng)
    traffic = build_traffic_kmeans(rng)
    anomaly = build_anomaly_if(rng)

    secs = round(time.perf_counter() - started, 1)
    payload = {
        "version": "1.0.0",
        "task": "NEXUS RETAIL 2.1 浏览器端可部署模型：拥堵风险随机森林、通行时间回归、客流聚类、异常检测阈值（全部为仿真离线训练）",
        "source": "SIMULATED offline training (seed 6143); NOT real surveillance",
        "seed": SEED,
        "seconds": secs,
        "disclaimers": [
            "本模型全部使用 numpy RandomState(6143) 生成的仿真数据离线训练，不是真实监控数据。",
            "所有指标均由 sklearn 在独立测试集上真实计算，仅反映仿真分布上的性能。",
            "模型结构（树/系数/质心/阈值）仅为演示浏览器端推理而导出，不可用于真实安全决策。",
            "异常阈值为仿真 IsolationForest 的 decision_function 分位数，配合特征 z 分数做轻量判定。",
        ],
        "risk_rf": risk,
        "travel_lr": travel,
        "traffic_kmeans": traffic,
        "anomaly_if": anomaly,
    }
    write_json(payload, secs)


if __name__ == "__main__":
    main()
