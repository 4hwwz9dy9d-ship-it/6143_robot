// NEXUS RETAIL 2.1 — 运行时 ML 推理层
// 加载 scripts/build_runtime_models.py 真实训练并导出的 runtime-models.json，
// 在浏览器端直接执行 RandomForest / 线性回归 / K-Means 推理。
// 所有指标来自导出模型本身，不在前端重新训练、不伪造数值。
// 说明：anomaly_if 只导出了 normalMean/normalStd/scoreThreshold（未导出单棵树），
// 因此前端用「标准化正态偏离度」作为与训练阈值同源的异常打分代理，报告须注明。

const RISK_CN = ['低风险', '中风险', '高风险'];
const SHARE_CODE = new URLSearchParams(location.search).get('sharecode');
const withShareCode = path => SHARE_CODE
  ? `${path}${path.includes('?') ? '&' : '?'}sharecode=${encodeURIComponent(SHARE_CODE)}`
  : path;

/** 加载运行时模型。失败时返回 null，调用方降级到几何启发式，不影响仿真。 */
export async function loadRuntimeModels(url = './public/data/lab/runtime-models.json') {
  try {
    const res = await fetch(withShareCode(url), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.risk_rf?.trees?.length) throw new Error('模型文件缺少 risk_rf.trees');
    return data;
  } catch (error) {
    console.warn('[runtimeML] 运行时模型加载失败，将使用几何启发式降级：', error?.message || error);
    return null;
  }
}

/** 单棵决策树推理：从 root(0) 沿 feature/threshold 走到叶子，返回类别概率。 */
function treeProba(tree, features) {
  let node = 0;
  const { children_left, children_right, feature, threshold, value } = tree;
  // 防止导出树异常导致死循环：最多访问节点数 = feature.length
  for (let guard = 0; guard < feature.length; guard++) {
    if (feature[node] === -2 || children_left[node] === -1) {
      const v = value[node] || [];
      const total = v.reduce((a, b) => a + b, 0) || 1;
      return v.map(x => x / total);
    }
    const f = features[feature[node]];
    const thresholdValue = threshold[node];
    node = (Number.isFinite(f) && f < thresholdValue) ? children_left[node] : children_right[node];
    if (node == null || node < 0) node = 0;
  }
  const v = value[node] || [];
  const total = v.reduce((a, b) => a + b, 0) || 1;
  return v.map(x => x / total);
}

/** RandomForest 风险分类：对 12 棵树概率取平均，输出 { level, score, proba }。 */
export function predictRisk(models, sample) {
  if (!models?.risk_rf) return null;
  const names = models.risk_rf.featureNames;
  const features = names.map(name => {
    const v = sample[name];
    return Number.isFinite(v) ? v : 0;
  });
  const sums = [0, 0, 0];
  for (const tree of models.risk_rf.trees) {
    const p = treeProba(tree, features);
    for (let c = 0; c < sums.length; c++) sums[c] += p[c] || 0;
  }
  const n = models.risk_rf.trees.length || 1;
  const proba = sums.map(x => x / n);
  let label = 0;
  for (let c = 1; c < proba.length; c++) if (proba[c] > proba[label]) label = c;
  // score = 期望风险等级（0~2 归一化到 0~1），比单纯 argmax 更平滑，便于代价函数使用。
  const expected = (proba[1] || 0) + 2 * (proba[2] || 0);
  return { level: RISK_CN[label] || String(label), label, score: expected / 2, proba };
}

/** 标准化线性回归：预测通行时间（秒）。返回真实预测值，不做任何人工缩放。 */
export function predictTravelTime(models, sample) {
  const d = models?.travel_lr?.deployable;
  if (!d) return null;
  const names = models.travel_lr.featureNames;
  const x = names.map((name, i) => {
    const raw = Number.isFinite(sample[name]) ? sample[name] : d.mean[i];
    return (raw - d.mean[i]) / (d.scale[i] || 1);
  });
  let y = d.intercept;
  for (let i = 0; i < x.length; i++) y += d.coef[i] * x[i];
  return Math.max(0, y);
}

/** K-Means：返回最近的交通状态簇编号与该样本的欧氏距离。 */
export function predictTrafficCluster(models, sample) {
  const d = models?.traffic_kmeans;
  if (!d?.centroids?.length) return null;
  const names = d.featureNames;
  const x = names.map((name, i) => Number.isFinite(sample[name]) ? sample[name] : d.centroids[0][i]);
  let best = 0, bestDist = Infinity;
  d.centroids.forEach((c, i) => {
    let s = 0;
    for (let j = 0; j < x.length; j++) { const diff = x[j] - c[j]; s += diff * diff; }
    const dd = Math.sqrt(s);
    if (dd < bestDist) { bestDist = dd; best = i; }
  });
  return { cluster: best, distance: bestDist, k: d.centroids.length };
}

/** 异常检测代理：用训练得到的 normalMean/normalStd 计算标准化偏离度（z 均值），
 *  与训练时导出的 scoreThreshold 同尺度。注意：这是可解释的距离代理，不是 IsolationForest 树推理。 */
export function anomalyScore(models, domain, sample) {
  const d = models?.anomaly_if?.[domain];
  if (!d) return null;
  const names = d.featureNames;
  let sum = 0;
  names.forEach((name, i) => {
    const raw = Number.isFinite(sample[name]) ? sample[name] : d.normalMean[i];
    sum += Math.abs((raw - d.normalMean[i]) / (d.normalStd[i] || 1));
  });
  const score = sum / names.length;
  return { domain, score, threshold: d.scoreThreshold, anomaly: score > 2.2, features: names.length };
}

/** 为 app.js 的 LocalPlanner 构造风险预测闭包：把运行时状态映射到模型特征。 */
export function riskPredictor(models) {
  if (!models?.risk_rf?.trees?.length) return null;
  return sample => predictRisk(models, sample) || { level: '未知', score: 0, label: 0 };
}

/** 汇总模型真实指标，供 HUD / 报告 / 测试读取（不是硬编码展示文本）。 */
export function modelSummary(models) {
  if (!models) return null;
  return {
    source: models.source,
    seed: models.seed,
    risk: { ...models.risk_rf.metrics, trees: models.risk_rf.trees.length },
    travel: models.travel_lr.metrics,
    kmeans: { inertia: models.traffic_kmeans.inertia, silhouette: models.traffic_kmeans.silhouette, k: models.traffic_kmeans.centroids.length },
    anomaly: Object.fromEntries(Object.entries(models.anomaly_if).map(([k, v]) => [k, { anomalyCount: v.anomalyCount, features: v.featureNames.length }])),
  };
}
