// NEXUS RETAIL 2.0 — Data-mining lab views.
// Every number shown here is read from a versioned offline JSON produced by scripts/.
// Nothing is fabricated at render time; controls only filter/select precomputed REAL results.
// Real data: Instacart cleaned CSV. Simulated data: corridor / pedestrian / robot state (labelled).

const BASE = './public/data/';
const LAB_FILES = {
  dataProfile: 'lab/data-profile.json',
  association: 'lab/association-analysis.json',
  recommendation: 'lab/recommendation-analysis.json',
  clustering: 'lab/clustering-analysis.json',
  congestion: 'lab/congestion-classifier.json',
  regression: 'lab/travel-regression.json',
  forecast: 'lab/traffic-forecast.json',
  anomaly: 'lab/anomaly-detection.json',
  reorder: 'ml/reorder-model.json',
  cf: 'ml/cf-recommendations.json',
  summary: 'summary.json',
};
const NEW_VIEWS = ['data-explorer', 'association', 'recommendation', 'clustering', 'ml', 'regression', 'forecast', 'anomaly', 'evaluation-lab', 'research'];

let lab = null;
let lastContext = { mlData: null, research: null, strategyComparison: null };
const ui = {
  dataDataset: null, normalize: 'zscore', cleanRules: null,
  assocSupport: null, assocConf: null,
  recSeed: null, clusterDomain: 'product', clusterK: null,
  forecastMethod: null, anomalyDomain: null,
  evalAlgorithm: 'ALL', evalSource: 'ALL', evalQuery: '',
};

/* ------------------------------------------------------------- primitives */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: d }) : '—';
};
const pct = (v, d = 1) => Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(d)}%` : '—';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLORS = { blue: '#3D7BD6', teal: '#20A995', amber: '#E8A34A', red: '#D96C68', purple: '#8E6FD0' };
const arr = v => Array.isArray(v) ? v : [];

async function loadJson(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
export async function loadMiningLab() {
  const entries = Object.entries(LAB_FILES);
  const results = await Promise.all(entries.map(async ([key, path]) => {
    try { return [key, await loadJson(path)]; }
    catch (error) { console.warn(`[miningLab] ${path} 加载失败：`, error); return [key, null]; }
  }));
  return Object.fromEntries(results);
}
export function setMiningLabData(data) { lab = data; }
export function getMiningLabData() { return lab; }

function attachHover(root) {
  root.querySelectorAll?.('.chart[data-tip-host]')?.forEach(host => {
    const tip = host.querySelector('.chart-hover');
    if (!tip) return;
    host.querySelectorAll('[data-tip]').forEach(node => {
      node.addEventListener('mouseenter', () => { tip.textContent = node.dataset.tip; tip.classList.add('is-visible'); });
      node.addEventListener('mousemove', event => {
        const box = host.getBoundingClientRect();
        tip.style.left = `${clamp(event.clientX - box.left, 50, box.width - 50)}px`;
        tip.style.top = `${clamp(event.clientY - box.top, 28, box.height - 10)}px`;
      });
      node.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
    });
  });
}
function bars(items, unit = '') {
  const rows = arr(items).map(item => ({ label: item.label ?? item.range ?? item.name ?? '', value: Number(item.count ?? item.value ?? 0) }));
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="chart research-bars" data-tip-host>${rows.map(r =>
    `<div class="research-bar" data-tip="${esc(`${r.label}：${num(r.value, 2)}${unit}`)}"><span>${esc(r.label)}</span><div><i class="bar" style="width:${clamp(r.value / max * 100, 1, 100)}%"></i></div><b>${num(r.value, 0)}${unit}</b></div>`).join('')}<div class="chart-hover"></div></div>`;
}
function dualBars(groups, colorA = COLORS.blue, colorB = COLORS.teal) {
  const max = Math.max(1, ...groups.flatMap(g => [Number(g.a ?? 0), Number(g.b ?? 0)]));
  return `<div class="lab-dualbars">${groups.map(g => `<div class="lab-dualbar">
    <span>${esc(g.label)}</span>
    <div class="lab-dualbar-track"><i style="width:${clamp(Number(g.a ?? 0) / max * 100, 1, 100)}%;background:${colorA}"></i><i style="width:${clamp(Number(g.b ?? 0) / max * 100, 1, 100)}%;background:${colorB}"></i></div>
    <b>${num(g.a)} / ${num(g.b)}</b></div>`).join('')}</div>`;
}
function lineChart(series, labels, opts = {}) {
  const w = 640, h = 220, pad = 34;
  const all = series.flatMap(s => arr(s.values).map(Number).filter(Number.isFinite));
  const max = opts.max ?? Math.max(1, ...all), min = opts.min ?? Math.min(0, ...all);
  const span = Math.max(1e-9, max - min);
  const xs = i => pad + i * (w - 2 * pad) / Math.max(1, labels.length - 1);
  const ys = v => h - pad - (Number(v) - min) / span * (h - 2 * pad);
  const paths = series.map(s => {
    const pts = arr(s.values).map((v, i) => [xs(i), ys(v)]);
    return `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color || COLORS.blue}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }).join('');
  const dots = series.map((s, si) => arr(s.values).map((v, i) =>
    `<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3.6" fill="${s.color || COLORS.blue}" data-tip="${esc(`${s.name} · ${labels[i]}：${num(v)}`)}"/>`).join('')).join('');
  const grid = [0, .5, 1].map(f => `<line class="grid-line" x1="${pad}" x2="${w - pad}" y1="${(h - pad - f * (h - 2 * pad)).toFixed(1)}" y2="${(h - pad - f * (h - 2 * pad)).toFixed(1)}"/>`).join('');
  const legend = `<div class="chart-legend">${series.map(s => `<span><i style="background:${s.color || COLORS.blue}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  return `<div class="chart" data-tip-host><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.label || 'line chart')}">${grid}
    ${series.map(s => arr(s.values).map((v, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="1" opacity="0" data-tip="${esc(`${s.name} · ${labels[i]}：${num(v)}`)}"/>`).join('')).join('')}
    ${paths}${dots}
    ${labels.map((l, i) => i % Math.max(1, Math.ceil(labels.length / 12)) === 0 ? `<text class="axis-label" x="${xs(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(l)}</text>` : '').join('')}
    </svg>${legend}<div class="chart-hover"></div></div>`;
}
function scatterChart(points, opts = {}) {
  const w = 640, h = 230, pad = 34;
  const xs = arr(points).map(p => Number(p.x)); const ys = arr(points).map(p => Number(p.y));
  const xmin = Math.min(...xs, 0), xmax = Math.max(...xs, 1), ymin = Math.min(...ys, 0), ymax = Math.max(...ys, 1);
  const X = v => pad + (Number(v) - xmin) / Math.max(1e-9, xmax - xmin) * (w - 2 * pad);
  const Y = v => h - pad - (Number(v) - ymin) / Math.max(1e-9, ymax - ymin) * (h - 2 * pad);
  return `<div class="chart" data-tip-host><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="scatter">
    ${[0, .5, 1].map(f => `<line class="grid-line" x1="${pad}" x2="${w - pad}" y1="${(h - pad - f * (h - 2 * pad)).toFixed(1)}" y2="${(h - pad - f * (h - 2 * pad)).toFixed(1)}"/>`).join('')}
    ${arr(points).slice(0, opts.limit || 400).map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 4}" fill="${p.color || (p.isAnomaly ? COLORS.red : COLORS.blue)}" opacity="${p.opacity || .72}" data-tip="${esc(p.tip || `${opts.xLabel || 'x'}=${num(p.x)} · ${opts.yLabel || 'y'}=${num(p.y)}`)}"/>`).join('')}
    <text class="axis-label" x="${w / 2}" y="${h - 6}" text-anchor="middle">${esc(opts.xLabel || '')}</text>
    <text class="axis-label" transform="translate(11 ${h / 2}) rotate(-90)" text-anchor="middle">${esc(opts.yLabel || '')}</text>
    </svg><div class="chart-hover"></div></div>`;
}
function networkSvg(nodes, edges) {
  const w = 640, h = 360, cx = w / 2, cy = h / 2, r = 128;
  const list = arr(nodes).slice(0, 24);
  const index = new Map(list.map((n, i) => [String(n.id), i]));
  const pos = list.map((_, i) => [cx + r * Math.cos(i / Math.max(1, list.length) * Math.PI * 2), cy + r * Math.sin(i / Math.max(1, list.length) * Math.PI * 2)]);
  const lines = arr(edges).filter(e => index.has(String(e.source)) && index.has(String(e.target))).slice(0, 45).map(e => {
    const a = pos[index.get(String(e.source))], b = pos[index.get(String(e.target))];
    const strength = clamp(Number(e.lift ?? 1) / 20, .12, .9);
    return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${COLORS.teal}" stroke-width="${(1 + strength * 2).toFixed(1)}" opacity="${strength.toFixed(2)}" data-tip="${esc(`${e.source} → ${e.target} · lift ${num(e.lift)} · conf ${pct(e.confidence)}`)}"/>`;
  }).join('');
  return `<div class="chart" data-tip-host><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="商品关联网络">${lines}
    ${list.map((n, i) => `<g data-tip="${esc(`${n.name} · 度 ${n.degree ?? 0}`)}"><circle cx="${pos[i][0].toFixed(1)}" cy="${pos[i][1].toFixed(1)}" r="${(5 + clamp(Number(n.degree ?? 1), 1, 14) * .55).toFixed(1)}" fill="${COLORS.primary || '#172C40'}" stroke="${COLORS.teal}" stroke-width="1.6"/><text x="${pos[i][0].toFixed(1)}" y="${(pos[i][1] - 12).toFixed(1)}" font-size="9" fill="#263746" text-anchor="middle">${esc(String(n.name || '').slice(0, 13))}</text></g>`).join('')}
    </svg><div class="chart-hover"></div></div>`;
}
function table(headers, rows, opts = {}) {
  const body = Array.isArray(rows) ? rows.join('') : String(rows ?? '');
  return `<div class="table-wrap"${opts.maxHeight ? ` style="max-height:${opts.maxHeight};overflow:auto"` : ''}><table class="data-table"><thead><tr>${headers.map(h => `<th${h.cls ? ` class="${h.cls}"` : ''}>${esc(h.label || h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}"><span class="empty">暂无数据</span></td></tr>`}</tbody></table></div>`;
}
function statRow(items) {
  return `<div class="research-stats">${items.map(i => `<div><b>${esc(i.value)}</b><span>${esc(i.label)}</span></div>`).join('')}</div>`;
}
function hero(kicker, title, subtitle, badge) {
  return `<div class="research-hero"><div><p class="section-kicker">${esc(kicker)}</p><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span class="research-badge">${esc(badge)}</span></div>`;
}
function disclaimer(texts) {
  return arr(texts).length ? `<p class="assumption" style="margin:10px 0">${arr(texts).map(t => `· ${esc(t)}`).join('　')}</p>` : '';
}
function select(id, label, options, value) {
  return `<label class="field"><span class="field-label">${esc(label)}</span><select id="${id}">${options.map(o => {
    const v = String(o.value ?? o); const l = String(o.label ?? o);
    return `<option value="${esc(v)}"${String(value) === v ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('')}</select></label>`;
}
function bindSelect(id, handler) {
  const node = document.getElementById(id);
  if (node) node.addEventListener('change', event => handler(event.target.value));
}
function renderInto(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html;
  attachHover(el);
}

/* --------------------------------------------------------- data explorer */
function renderDataExplorer() {
  const d = lab?.dataProfile;
  if (!d) return renderInto('dataExplorerDashboard', '<p class="empty">数据探索数据未生成或加载失败。请运行 scripts/build_data_profile.py 后刷新。</p>');
  const datasets = arr(d.datasets).map((x, i) => ({ ...x, key: x.key || x.dataset || `dataset-${i}` }));
  if (!ui.dataDataset || !datasets.some(x => x.key === ui.dataDataset)) ui.dataDataset = datasets[0]?.key;
  const active = datasets.find(x => x.key === ui.dataDataset) || {};
  const normalize = ui.normalize === 'minmax' ? 'minmax' : 'zscore';
  const fields = arr(active.fields);
  const outliers = arr(active.outliers);
  const cleaning = arr(d.cleaning);
  let kept = Number(active.rows ?? 0);
  const cleaningRows = cleaning.map((step, i) => {
    const enabled = ui.cleanRules === null ? true : !arr(ui.cleanRules).includes(i);
    if (enabled) kept = Math.min(kept, Number(step.rowsAfter ?? kept));
    return `<tr><td>${esc(step.step || `步骤 ${i + 1}`)}</td><td>${esc(step.description || '')}</td><td class="right">${num(step.rowsBefore, 0)}</td><td class="right">${num(step.rowsAfter, 0)}</td><td>${enabled ? '<span class="pill pill--ok">应用</span>' : '<span class="pill">跳过</span>'}</td><td><button class="btn btn-secondary btn-sm" data-clean-toggle="${i}" type="button">${enabled ? '跳过' : '应用'}</button></td></tr>`;
  }).join('');
  const normRows = arr(d.normalization).map(n => {
    // 脚本输出的 min/max/mean/std 已是变换后的统计量；raw* 为原始值。
    const stat = normalize === 'zscore'
      ? { min: n.min, max: n.max, mean: n.mean, std: n.std, rawMin: n.rawMin, rawMax: n.rawMax }
      : { min: 0, max: 1, mean: 0.5, std: '—', rawMin: n.rawMin, rawMax: n.rawMax };
    return `<tr><td>${esc(n.feature)}</td><td>${esc(n.method || '—')}</td><td class="right">${num(n.rawMin ?? n.min, 3)}</td><td class="right">${num(n.rawMax ?? n.max, 3)}</td><td class="right">${num(n.mean, 3)}</td><td class="right">${num(n.std, 3)}</td><td class="right mono">${esc(n.method || 'z-score')}</td></tr>`;
  }).join('');
  const html = `${hero('DATA EXPLORER · VERSIONED DATASET', '数据探索中心', '字段类型、缺失、重复、异常、分布、清洗、特征工程与归一化——全部来自离线审计脚本。', `schema ${esc(d.version || '—')} · seed ${num(d.seed, 0)}`)}
    ${statRow([
      { value: num(datasets.length, 0), label: '数据集' },
      { value: num(datasets.filter(x => x.real).length, 0), label: '真实数据集' },
      { value: num(datasets.reduce((s, x) => s + arr(x.fields).filter(f => Number(f.missing) > 0).length, 0), 0), label: '含缺失字段' },
      { value: num(arr(d.versions).length, 0), label: '数据版本' },
    ])}
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad">
        <p class="section-kicker">DATASET SELECTOR</p><h3>数据集与字段类型</h3>
        ${select('deDataset', '选择数据集', datasets.map(x => ({ value: x.key, label: `${x.label || x.key}${x.real ? ' · 真实' : ' · 仿真'}` })), ui.dataDataset)}
        <p class="lead" style="font-size:11px">${esc(active.rows ?? 0)} 行 × ${esc(active.columns ?? 0)} 列 · ${active.real ? '真实 Instacart 数据' : '仿真数据（教学规则生成）'}</p>
        ${table([{ label: '字段' }, { label: '类型' }, { label: '非空', cls: 'right' }, { label: '缺失', cls: 'right' }, { label: '缺失率', cls: 'right' }, { label: '唯一值', cls: 'right' }],
          fields.map(f => `<tr><td class="mono">${esc(f.name)}</td><td>${esc(f.type || '—')}</td><td class="right">${num(f.nonNull, 0)}</td><td class="right">${num(f.missing, 0)}</td><td class="right">${pct(f.missingPct)}</td><td class="right">${num(f.unique, 0)}</td></tr>`), { maxHeight: '300px' })}
        <p class="assumption">重复键 ${esc(active.duplicates?.key || '—')}：${num(active.duplicates?.count, 0)} 条。</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">OUTLIERS & DISTRIBUTION</p><h3>异常值与真实分布</h3>
        ${outliers.length ? table([{ label: '字段' }, { label: '方法' }, { label: '数量', cls: 'right' }, { label: '示例' }],
          outliers.map(o => `<tr><td>${esc(o.field)}</td><td>${esc(o.method)}</td><td class="right">${num(o.count, 0)}</td><td>${esc(o.example ?? '—')}</td></tr>`)) : '<p class="empty">未检出异常值。</p>'}
        <h4 style="margin-top:12px">下单时段（真实 · 线上时间）</h4>${bars(arr(d.distributions?.orderHour).slice(0, 24), ' 单')}
      </article>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">PRICE / WEIGHT DISTRIBUTION</p><h3>商品价格与重量</h3>
        <h4>价格区间（USD · 数据集自带估算）</h4>${bars(d.distributions?.price, ' 件')}
        <h4 style="margin-top:10px">重量区间（g）</h4>${bars(d.distributions?.weight, ' 件')}
      </article>
      <article class="card card-pad"><p class="section-kicker">DATA CLEANING</p><h3>清洗流程（可交互预览）</h3>
        <p class="lead" style="font-size:11px">按勾选顺序应用：预计剩余 <b>${num(kept, 0)}</b> 行。</p>
        ${table([{ label: '步骤' }, { label: '说明' }, { label: '前', cls: 'right' }, { label: '后', cls: 'right' }, { label: '状态' }, { label: '' }], cleaningRows, { maxHeight: '300px' })}
      </article>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">FEATURE ENGINEERING</p><h3>特征工程</h3>
        ${table([{ label: '特征' }, { label: '变换' }, { label: '来源' }], arr(d.featureEngineering).map(f => `<tr><td class="mono">${esc(f.feature)}</td><td>${esc(f.transform)}</td><td>${esc(f.source)}</td></tr>`), { maxHeight: '280px' })}
      </article>
      <article class="card card-pad"><p class="section-kicker">NORMALIZATION</p><h3>标准化与归一化</h3>
        ${select('deNorm', '显示方式', [{ value: 'zscore', label: 'Z-score 标准化 (x−μ)/σ' }, { value: 'minmax', label: 'Min-Max 归一化 (x−min)/(max−min)' }], normalize)}
        ${table([{ label: '特征' }, { label: '变换方法' }, { label: '原始 min', cls: 'right' }, { label: '原始 max', cls: 'right' }, { label: '变换后均值', cls: 'right' }, { label: '变换后标准差', cls: 'right' }, { label: '标注' }], normRows, { maxHeight: '280px' })}
        <p class="assumption">统计量由真实商品属性计算；切换显示方式查看归一化(0–1)或标准化(μ=0,σ=1)的取值区间。</p>
      </article>
    </div>
    <article class="card card-pad" style="margin-top:14px"><p class="section-kicker">DATASET VERSION MANAGEMENT</p><h3>数据集版本</h3>
      ${table([{ label: '版本' }, { label: '日期' }, { label: '文件' }, { label: '说明' }], arr(d.versions).map(v => `<tr><td class="mono">${esc(v.version)}</td><td>${esc(v.date)}</td><td>${esc(arr(v.files).join(', '))}</td><td>${esc(v.note)}</td></tr>`))}
    </article>${disclaimer(d.disclaimers)}`;
  renderInto('dataExplorerDashboard', html);
  bindSelect('deDataset', value => { ui.dataDataset = value; renderDataExplorer(); });
  bindSelect('deNorm', value => { ui.normalize = value; renderDataExplorer(); });
  const container = document.getElementById('dataExplorerDashboard');
  container?.addEventListener('click', event => {
    const btn = event.target.closest('[data-clean-toggle]');
    if (!btn) return;
    const i = Number(btn.dataset.cleanToggle);
    const set = new Set(ui.cleanRules || cleaning.map((_, idx) => idx));
    set.has(i) ? set.delete(i) : set.add(i);
    ui.cleanRules = [...set];
    renderDataExplorer();
  }, { once: true });
}

/* ------------------------------------------------------------ association */
function renderAssociation() {
  const d = lab?.association;
  if (!d) return renderInto('associationDashboard', '<p class="empty">关联规则分析数据未生成或加载失败。请运行 scripts/build_association_analysis.py 后刷新。</p>');
  const sweeps = arr(d.sweeps);
  const supports = [...new Set(sweeps.map(s => Number(s.minSupportCount)))].sort((a, b) => a - b);
  const confs = [...new Set(sweeps.map(s => Number(s.minConfidence)))].sort((a, b) => a - b);
  if (ui.assocSupport === null) ui.assocSupport = supports.includes(35) ? 35 : supports[0];
  if (ui.assocConf === null) ui.assocConf = confs.includes(0.25) ? 0.25 : confs[0];
  const current = sweeps.find(s => Number(s.minSupportCount) === Number(ui.assocSupport) && Math.abs(Number(s.minConfidence) - Number(ui.assocConf)) < 1e-6);
  const top = arr(current?.topRules).slice(0, 20);
  const sweepStats = sweeps.map(s => ({ label: `s${s.minSupportCount}/c${Number(s.minConfidence).toFixed(2)}`, a: Number(s.ruleCount), b: Number(s.maxLift) }));
  const f = d.formula || {};
  const html = `${hero('ASSOCIATION MINING · APRIORI', '关联规则挖掘', '真实购物篮上的 Apriori 实验：调节最小支持度与置信度，实时查看规则数量、Top-20 规则与商品关联网络。', `seed ${num(d.seed, 0)} · ${num(d.baskets, 0)} 篮`)}
    <div class="card card-pad" style="margin-top:12px"><div class="card-head"><div><p class="section-kicker">PARAMETER SWEEP</p><h3>参数调节（重新筛选，不重新编造）</h3></div>
      <div class="btn-row">${select('asSupport', '最小支持度计数', supports.map(v => ({ value: v, label: `${v} (${pct(v / Math.max(1, d.baskets), 4)})` })), ui.assocSupport)}${select('asConf', '最小置信度', confs.map(v => ({ value: v, label: pct(v, 0) })), ui.assocConf)}</div></div>
      ${statRow([
        { value: num(current?.ruleCount, 0), label: '当前规则数' },
        { value: num(current?.maxLift, 2), label: '最大 Lift' },
        { value: pct(current?.avgConfidence), label: '平均置信度' },
        { value: num(sweeps.length, 0), label: '已计算参数组合' },
      ])}
      <p class="assumption">商品池 ${num(d.candidateProducts, 0)} 件（购买频次最高），规则由真实 train 购物篮离线计算；每次调参只在已算出的 ${num(sweeps.length, 0)} 组真实结果中筛选。</p>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">TOP 20 RULES</p><h3>当前参数下的规则</h3>
        ${table([{ label: '前件' }, { label: '后件' }, { label: '支持度', cls: 'right' }, { label: '置信度', cls: 'right' }, { label: 'Lift', cls: 'right' }, { label: '计数', cls: 'right' }],
          top.map(r => `<tr><td>${esc(r.fromName || r.from)}</td><td>${esc(r.toName || r.to)}</td><td class="right">${pct(r.support, 4)}</td><td class="right">${pct(r.confidence)}</td><td class="right"><b>${num(r.lift)}</b></td><td class="right">${num(r.count, 0)}</td></tr>`), { maxHeight: '420px' })}
      </article>
      <article class="card card-pad"><p class="section-kicker">PARAMETER SENSITIVITY</p><h3>规则数量 vs 最大 Lift</h3>
        ${dualBars(sweepStats, COLORS.blue, COLORS.amber)}
        <p class="assumption">左条=规则数量，右条=最大 Lift（各自归一化）。更高支持度 → 更少但更可靠的规则；更高置信度 → 过滤弱关联。</p>
        <p class="section-kicker" style="margin-top:12px">FORMULAS</p>
        <div class="quality-steps">${[f.support, f.confidence, f.lift].filter(Boolean).map((x, i) => `<div><b>${['Support', 'Confidence', 'Lift'][i]}</b><p>${esc(x)}</p></div>`).join('')}</div>
      </article>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">PRODUCT ASSOCIATION NETWORK</p><h3>商品关联网络</h3>
        ${networkSvg(d.network?.nodes, d.network?.edges)}
        <p class="assumption">节点大小=关联度；边粗细=Lift。悬停查看精确数值。</p>
      </article>
      <article class="card card-pad"><p class="section-kicker">COMBINATION ANALYSIS</p><h3>商品组合分析</h3>
        ${table([{ label: '组合' }, { label: '支持度', cls: 'right' }, { label: '置信度', cls: 'right' }, { label: 'Lift', cls: 'right' }],
          arr(d.combos).slice(0, 12).map(c => `<tr><td>${esc(arr(c.items).join(' + '))}</td><td class="right">${pct(c.support, 4)}</td><td class="right">${pct(c.confidence)}</td><td class="right">${num(c.lift)}</td></tr>`), { maxHeight: '300px' })}
        <p class="assumption" style="margin-top:10px"><b>实际订单应用：</b>${esc(d.application || '共购关系用于货区邻接建议，减少机器人折返。')}</p>
      </article>
    </div>${disclaimer(d.disclaimers)}`;
  renderInto('associationDashboard', html);
  bindSelect('asSupport', v => { ui.assocSupport = v; renderAssociation(); });
  bindSelect('asConf', v => { ui.assocConf = v; renderAssociation(); });
}

/* ---------------------------------------------------------- recommendation */
function renderRecommendation() {
  const d = lab?.recommendation;
  if (!d) return renderInto('recommendationDashboard', '<p class="empty">推荐系统数据未生成或加载失败。请运行 scripts/build_recommendation_analysis.py 后刷新。</p>');
  const seeds = arr(d.topN);
  if (!ui.recSeed || !seeds.some(s => String(s.seedId) === String(ui.recSeed))) ui.recSeed = seeds[0]?.seedId;
  const active = seeds.find(s => String(s.seedId) === String(ui.recSeed)) || {};
  const ev = d.evaluation || {};
  const cf = ev.cf || {}, pop = ev.popularityBaseline || {};
  const metricKeys = ['precision@5', 'precision@10', 'recall@5', 'recall@10', 'ndcg@5', 'ndcg@10'];
  const html = `${hero('RECOMMENDATION · ITEM-BASED CF', '推荐系统', '用户—商品交互矩阵、共现余弦相似度、Top-N 推荐与解释，并与热门商品基线做真实离线对比。', esc(d.method || 'Item-based CF'))}
    ${statRow([
      { value: num(d.interactionMatrix?.users, 0), label: '用户' },
      { value: num(d.interactionMatrix?.items, 0), label: '候选商品' },
      { value: pct(d.interactionMatrix?.density, 3), label: '矩阵密度' },
      { value: num(ev.evaluatedBaskets || cf.evaluatedBaskets, 0), label: '评估购物篮' },
    ])}
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">TOP-N RECOMMENDATION</p><h3>Top-N 推荐与基线对比</h3>
        ${select('recSeed', '种子商品', seeds.map(s => ({ value: s.seedId, label: s.seedName || s.seedId })), ui.recSeed)}
        <p class="lead" style="font-size:11px">相似商品（协同过滤）</p>
        ${table([{ label: '商品' }, { label: '相似度', cls: 'right' }, { label: '解释' }],
          arr(active.recommendations).map(r => `<tr><td>${esc(r.name || r.id)}</td><td class="right">${num(r.similarity, 4)}</td><td>${esc(r.reason || '与种子商品在购物篮中高频共现')}</td></tr>`), { maxHeight: '280px' })}
        <p class="lead" style="font-size:11px;margin-top:10px">热门商品基线（仅按购买频次）</p>
        ${table([{ label: '商品' }, { label: '频次/排名', cls: 'right' }], arr(active.popularityBaseline).map((r, i) => `<tr><td>${esc(r.name || r.id)}</td><td class="right">${num(r.popularity ?? r.frequency ?? i + 1, 0)}</td></tr>`), { maxHeight: '200px' })}
      </article>
      <article class="card card-pad"><p class="section-kicker">OFFLINE EVALUATION</p><h3>Precision@K / Recall@K / NDCG@K</h3>
        ${table([{ label: '指标' }, { label: 'Item-CF', cls: 'right' }, { label: '热门基线', cls: 'right' }],
          metricKeys.map(k => `<tr><td class="mono">${k}</td><td class="right">${num(cf[k], 4)}</td><td class="right">${num(pop[k], 4)}</td></tr>`))}
        <p class="assumption">评估协议：${esc(ev.protocol || '按用户不相交划分，篮内前一半为种子、后一半为相关商品。')}</p>
        <p class="assumption">${esc(ev.note || d.limitations || '')}</p>
      </article>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">SIMILARITY MATRIX (SAMPLE)</p><h3>商品相似度</h3>
        ${table([{ label: '商品 A' }, { label: '商品 B' }, { label: '余弦相似度', cls: 'right' }],
          arr(d.similarity?.pairs).map(p => `<tr><td>${esc(p.nameA || p.a)}</td><td>${esc(p.nameB || p.b)}</td><td class="right">${num(p.similarity, 4)}</td></tr>`), { maxHeight: '320px' })}
      </article>
      <article class="card card-pad"><p class="section-kicker">SCORE EXPLANATION</p><h3>推荐分数如何得到</h3>
        <p class="lead">${esc(d.explanation || '')}</p>
        <div class="quality-steps"><div><b>1 · 交互矩阵</b><p>训练篮中商品共现构成稀疏矩阵，按用户不相交划分避免同一用户泄漏到评估集。</p></div>
        <div><b>2 · 相似度</b><p>sim(i,j)=co(i,j)/√(freq_i·freq_j)，只在构建集统计，候选池取构建集高频商品。</p></div>
        <div><b>3 · 推荐与评价</b><p>近邻加权打分输出 Top-N；Precision/Recall/NDCG 在独立评估篮上计算，与热门基线对比。</p></div></div>
        <p class="assumption"><b>限制：</b>${esc(d.limitations || '共购不代表因果，未做增购效果的随机对照实验。')}</p>
      </article>
    </div>${disclaimer(d.disclaimers)}`;
  renderInto('recommendationDashboard', html);
  bindSelect('recSeed', v => { ui.recSeed = v; renderRecommendation(); });
}

/* --------------------------------------------------------------- clustering */
function renderClustering() {
  const d = lab?.clustering;
  if (!d) return renderInto('clusteringDashboard', '<p class="empty">聚类分析数据未生成或加载失败。请运行 scripts/build_clustering_analysis.py 后刷新。</p>');
  const domains = [{ value: 'product', label: '商品聚类 · 真实属性' }, { value: 'traffic', label: '客流聚类 · 仿真' }];
  const domain = ui.clusterDomain === 'traffic' && d.traffic ? 'traffic' : 'product';
  const c = d[domain] || {};
  const kValues = arr(c.kValues);
  if (ui.clusterK === null || !kValues.some(k => Number(k.k) === Number(ui.clusterK))) ui.clusterK = Number(c.selectedK || kValues[0]?.k);
  const selected = kValues.find(k => Number(k.k) === Number(ui.clusterK)) || {};
  const pts = arr(c.points).filter(p => Number(p[2]) <= Number(ui.clusterK));
  const scatter = pts.map((p, i) => ({ x: Number(p[0]), y: Number(p[1]), color: [COLORS.blue, COLORS.teal, COLORS.amber, COLORS.purple, COLORS.red][(Number(p[2]) - 1) % 5], tip: `PC1 ${num(p[0])} · PC2 ${num(p[1])} · 簇 ${p[2]}` }));
  const clusters = arr(c.clusters).filter(cl => Number(cl.id) <= Number(ui.clusterK));
  const isProduct = domain === 'product';
  const html = `${hero('CLUSTERING · K-MEANS', '聚类分析', '两类独立实验：商品聚类使用真实商品属性；客流聚类使用仿真通道状态。分别训练、分别评价，绝不混用数据。', esc(c.algorithm || 'K-Means'))}
    <div class="card card-pad" style="margin-top:12px"><div class="card-head"><div><p class="section-kicker">TWO INDEPENDENT EXPERIMENTS</p><h3>选择实验域与 K 值</h3></div>
      <div class="btn-row">${select('clDomain', '实验域', domains, domain)}${select('clK', 'K 值', kValues.map(k => ({ value: k.k, label: `K=${k.k}` })), ui.clusterK)}</div></div>
      <p class="assumption">数据源：${esc(c.source || '')}　·　${esc(d.separation || '商品与客流数据不混用。')}</p>
      ${statRow([{ value: `K=${num(c.selectedK, 0)}`, label: '推荐 K' }, { value: num(c.sampleSize, 0), label: '样本量' }, { value: num(selected.silhouette, 3), label: '轮廓系数' }, { value: num(selected.inertia, 0), label: '簇内平方和' }])}
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">ELBOW METHOD</p><h3>肘部法与轮廓系数</h3>
        ${lineChart([{ name: 'Inertia', values: kValues.map(k => k.inertia), color: COLORS.blue }], kValues.map(k => `K=${k.k}`), { label: 'elbow' })}
        ${bars(kValues.map(k => ({ label: `K=${k.k}`, count: Number(k.silhouette) })), '')}
        <p class="assumption">${esc(c.kSelection || c.method || '按最大肘点距离选 K；轮廓系数仅作参考。')}</p>
      </article>
      <article class="card card-pad"><p class="section-kicker">CLUSTER SCATTER (PCA 2D)</p><h3>聚类散点图</h3>
        ${scatter ? scatterChart(scatter, { xLabel: 'PC1', yLabel: 'PC2' }) : '<p class="empty">无散点数据。</p>'}
        <p class="assumption">散点为 PCA 投影（仅可视化）；颜色代表簇编号。K 改变时按已计算的簇标签过滤显示。</p>
      </article>
    </div>
    <article class="card card-pad" style="margin-top:14px"><p class="section-kicker">CLUSTER DETAILS</p><h3>各簇详情</h3>
      ${table(isProduct
        ? [{ label: '簇' }, { label: '商品数', cls: 'right' }, { label: '均价 USD', cls: 'right' }, { label: '均重 g', cls: 'right' }, { label: '均热量', cls: 'right' }, { label: '复购率', cls: 'right' }, { label: '代表商品' }]
        : [{ label: '簇' }, { label: '区域类型' }, { label: '样本数', cls: 'right' }, { label: '密度', cls: 'right' }, { label: '停留(s)', cls: 'right' }, { label: '速度', cls: 'right' }, { label: '占用率', cls: 'right' }, { label: '障碍数', cls: 'right' }],
        clusters.map(cl => isProduct
          ? `<tr><td>簇 ${esc(cl.id)}</td><td class="right">${num(cl.count, 0)}</td><td class="right">${num(cl.avgPriceUsd)}</td><td class="right">${num(cl.avgWeightG, 0)}</td><td class="right">${num(cl.avgCalories100g, 1)}</td><td class="right">${pct(cl.avgReorderRate)}</td><td>${esc(arr(cl.representatives).join('、'))}</td></tr>`
          : `<tr><td>簇 ${esc(cl.id)} · ${esc(cl.label || '')}</td><td>${esc(cl.zoneType || '')}</td><td class="right">${num(cl.count, 0)}</td><td class="right">${num(cl.avgDensity)}</td><td class="right">${num(cl.avgDwell, 1)}</td><td class="right">${num(cl.avgSpeed)}</td><td class="right">${pct(cl.avgOccupancy)}</td><td class="right">${num(cl.avgObstacles, 1)}</td></tr>`), { maxHeight: '360px' })}
    </article>${disclaimer(d.disclaimers)}`;
  renderInto('clusteringDashboard', html);
  bindSelect('clDomain', v => { ui.clusterDomain = v; ui.clusterK = null; renderClustering(); });
  bindSelect('clK', v => { ui.clusterK = v; renderClustering(); });
}

/* --------------------------------------------------------------- congestion */
function renderCongestion() {
  const d = lab?.congestion;
  if (!d) return renderInto('congestionDashboard', '<p class="empty">拥堵分类数据未生成或加载失败。请运行 scripts/build_congestion_classifier.py 后刷新。</p>');
  const classes = arr(d.classes);
  const models = d.models || {};
  const modelKeys = Object.keys(models);
  const rows = modelKeys.map(k => {
    const m = models[k];
    return `<tr><td>${esc(k.replace('_', ' '))}</td><td class="right">${pct(m.accuracy)}</td>${classes.map(c => `<td class="right">${num(m.f1?.[c], 3)}</td>`).join('')}<td class="right"><b>${num(m.macroF1, 3)}</b></td></tr>`;
  }).join('');
  const matrices = modelKeys.map(k => {
    const m = models[k];
    return `<div><p class="lead" style="font-size:11px">${esc(k.replace('_', ' '))} · 混淆矩阵（行=真实，列=预测）</p>
      ${table([{ label: '' }, ...classes.map(c => ({ label: c, cls: 'right' }))], arr(m.confusion).map((row, i) => `<tr><td>${esc(classes[i] || i)}</td>${arr(row).map(v => `<td class="right">${num(v, 0)}</td>`).join('')}</tr>`))}</div>`;
  }).join('');
  const ex = d.predictionExample || {};
  const html = `<article class="card card-pad" style="margin-top:14px">
    <p class="section-kicker">SUPERVISED TASK B · SIMULATED LABELS</p><h3>超市通道拥堵分类（仿真标签）</h3>
    <p class="assumption">${esc(d.source || '')}　·　类别：${esc(classes.join(' / '))}　·　划分：${esc(d.split?.method || '')}（训练 ${num(d.split?.train, 0)} / 测试 ${num(d.split?.test, 0)}，seed ${num(d.split?.seed || d.seed, 0)}）</p>
    ${statRow([{ value: num(d.samples?.total, 0), label: '仿真样本' }, { value: num(d.samples?.byClass?.High, 0), label: 'High 样本' }, { value: modelKeys.length, label: '模型数' }, { value: pct(d.baseline?.accuracy), label: '多数类基线' }])}
    ${table([{ label: '模型' }, { label: 'Accuracy', cls: 'right' }, ...classes.map(c => ({ label: `F1 ${c}`, cls: 'right' })), { label: 'Macro F1', cls: 'right' }], [rows])}
    <div class="research-grid" style="margin-top:12px"><div>${matrices}</div>
      <div><p class="lead" style="font-size:11px">单样本预测与类别概率</p>
        ${table([{ label: '特征' }, { label: '输入值', cls: 'right' }], Object.entries(ex.features || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="right">${num(v)}</td></tr>`))}
        ${bars(Object.entries(ex.probabilities || {}).map(([k, v]) => ({ label: k, count: Number(v) })), '')}
        <p class="assumption">预测类别：<b>${esc(ex.predicted || '—')}</b></p>
      </div></div>
    <p class="assumption">输入特征：${esc(arr(d.features).map(f => f.name || f).join('、'))}</p>
    ${disclaimer(d.disclaimers)}
  </article>`;
  renderInto('congestionDashboard', html);
}

/* ---------------------------------------------------------------- regression */
function renderRegression() {
  const d = lab?.regression;
  if (!d) return renderInto('regressionDashboard', '<p class="empty">回归分析数据未生成或加载失败。请运行 scripts/build_travel_regression.py 后刷新。</p>');
  const models = d.models || {};
  const keys = Object.keys(models);
  const rows = keys.map(k => {
    const m = models[k];
    return `<tr><td>${esc(k.replace('_', ' '))}</td><td class="right">${num(m.mae, 3)}</td><td class="right">${num(m.rmse, 3)}</td><td class="right"><b>${num(m.r2, 3)}</b></td><td class="right">${num(m.baseline?.mae, 3)}</td><td class="right">${num(m.baseline?.r2, 3)}</td></tr>`;
  }).join('');
  const pts = arr(d.actualVsPredicted);
  const html = `${hero('REGRESSION ANALYSIS · TRAVEL TIME', '通行时间回归预测', '用通道长度、人群密度、障碍数、占用率、行人速度等特征预测通行时间；线性与随机森林在独立测试集上评价。', esc(d.source || 'SIMULATED'))}
    ${statRow([{ value: esc(d.target || '—'), label: '预测目标' }, { value: num(d.split?.train, 0), label: '训练样本' }, { value: num(d.split?.test, 0), label: '测试样本' }, { value: num(pts.length, 0), label: '对比点' }])}
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">MODEL COMPARISON</p><h3>独立测试集评价</h3>
        ${table([{ label: '模型' }, { label: 'MAE', cls: 'right' }, { label: 'RMSE', cls: 'right' }, { label: 'R²', cls: 'right' }, { label: '基线 MAE', cls: 'right' }, { label: '基线 R²', cls: 'right' }], [rows])}
        <p class="assumption">${esc(d.method || '')}</p>
        <h4 style="margin-top:12px">输入特征</h4>
        ${table([{ label: '特征' }, { label: '说明' }], arr(d.features).map(f => `<tr><td class="mono">${esc(f.name || f)}</td><td>${esc(f.description || '')}</td></tr>`))}
      </article>
      <article class="card card-pad"><p class="section-kicker">PREDICTED vs ACTUAL</p><h3>预测值与实际值对比</h3>
        ${lineChart([
          { name: '实际通行时间', values: pts.map(p => p.actual), color: COLORS.blue },
          { name: '预测通行时间', values: pts.map(p => p.predicted), color: COLORS.teal },
        ], pts.map((_, i) => `#${i + 1}`), { label: 'predicted vs actual' })}
        <p class="assumption">曲线来自独立测试集的真实模型输出；横轴为测试样本序号。</p>
      </article>
    </div>${disclaimer(d.disclaimers)}`;
  renderInto('regressionDashboard', html);
}

/* ----------------------------------------------------------------- forecast */
function renderForecast() {
  const d = lab?.forecast;
  if (!d) return renderInto('forecastDashboard', '<p class="empty">客流预测数据未生成或加载失败。请运行 scripts/build_traffic_forecast.py 后刷新。</p>');
  const methods = arr(d.methods);
  if (!ui.forecastMethod || !methods.some(m => m.name === ui.forecastMethod)) ui.forecastMethod = d.bestMethod || methods[0]?.name;
  const active = methods.find(m => m.name === ui.forecastMethod) || {};
  const hourly = arr(d.hourly);
  const labels = hourly.map(h => h.label ?? String(h.hour));
  const peaks = arr(d.peak).map(p => p.hour); const valleys = arr(d.valley).map(p => p.hour);
  const html = `${hero('TRAFFIC FORECAST · TIME SERIES', '客流时间序列预测', '基于仿真小时客流序列：高峰/低谷识别、移动平均、指数平滑与时间特征线性回归，留出最后 6 小时评价。', 'SIMULATED FOOTFALL')}
    ${statRow([{ value: num(hourly.length, 0), label: '小时点' }, { value: `${peaks.map(p => `${p}:00`).join(' / ')}`, label: '高峰' }, { value: `${valleys.map(p => `${p}:00`).join(' / ')}`, label: '低谷' }, { value: esc(d.bestMethod || '—'), label: '最佳方法' }])}
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">HOURLY FOOTFALL</p><h3>每小时客流（仿真）</h3>
        ${lineChart([{ name: '仿真客流', values: hourly.map(h => h.count), color: COLORS.blue }], labels, { label: 'hourly' })}
        <p class="assumption">${esc(d.evaluationProtocol || '')}</p>
      </article>
      <article class="card card-pad"><p class="section-kicker">METHOD SELECTOR</p><h3>预测方法对比</h3>
        ${select('fcMethod', '选择方法', methods.map(m => ({ value: m.name, label: m.name })), ui.forecastMethod)}
        ${table([{ label: '方法' }, { label: 'MAE', cls: 'right' }, { label: 'RMSE', cls: 'right' }, { label: 'MAPE', cls: 'right' }],
          methods.map(m => `<tr><td>${esc(m.name)}</td><td class="right">${num(m.mae, 2)}</td><td class="right">${num(m.rmse, 2)}</td><td class="right">${pct(m.mape, 2)}</td></tr>`))}
        ${statRow([{ value: num(active.mae, 2), label: '当前 MAE' }, { value: num(active.rmse, 2), label: '当前 RMSE' }, { value: pct(active.mape, 2), label: '当前 MAPE' }])}
      </article>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">ACTUAL vs PREDICTED</p><h3>${esc(ui.forecastMethod)}</h3>
        ${lineChart([
          { name: '实际', values: arr(active.actualVsPredicted).map(p => p.actual), color: COLORS.blue },
          { name: '预测', values: arr(active.actualVsPredicted).map(p => p.predicted), color: COLORS.teal },
        ], arr(active.actualVsPredicted).map(p => String(p.hour ?? '')), { label: 'forecast comparison' })}
      </article>
      <article class="card card-pad"><p class="section-kicker">NEXT 6 HOURS</p><h3>未来客流预测</h3>
        ${table([{ label: '小时' }, { label: '预测客流', cls: 'right' }, { label: '方法' }],
          arr(d.future).map(f => `<tr><td>${esc(f.hour)}:00</td><td class="right">${num(f.predicted, 1)}</td><td>${esc(f.method || d.bestMethod)}</td></tr>`))}
        <p class="assumption">预测使用已计算方法递归外推，非实时传感数据。</p>
      </article>
    </div>${disclaimer(d.disclaimers)}`;
  renderInto('forecastDashboard', html);
  bindSelect('fcMethod', v => { ui.forecastMethod = v; renderForecast(); });
}

/* ------------------------------------------------------------------ anomaly */
function renderAnomaly() {
  const d = lab?.anomaly;
  if (!d) return renderInto('anomalyDashboard', '<p class="empty">异常检测数据未生成或加载失败。请运行 scripts/build_anomaly_detection.py 后刷新。</p>');
  const domains = arr(d.domains);
  if (!ui.anomalyDomain || !domains.some(x => x.key === ui.anomalyDomain)) ui.anomalyDomain = domains[0]?.key;
  const active = domains.find(x => x.key === ui.anomalyDomain) || {};
  const scatter = arr(active.scatter).map((p, i) => ({ x: Number(p.value), y: Number(p.score), isAnomaly: !!p.isAnomaly, tip: `${i + 1} · 值 ${num(p.value)} · 分数 ${num(p.score, 3)}${p.isAnomaly ? ' · 异常' : ''}` }));
  const html = `${hero('ANOMALY DETECTION · ISOLATION FOREST', '异常检测', '四个领域各自独立拟合 Isolation Forest：异常客流、异常通行时间、机器人运行异常、异常库存变化。', `${esc(d.method || 'IsolationForest')} · contamination ${esc(d.contamination || '')}`)}
    <div class="card card-pad" style="margin-top:12px"><div class="card-head"><div><p class="section-kicker">DOMAIN SELECTOR</p><h3>按领域独立检测</h3></div>
      ${select('anDomain', '数据领域', domains.map(x => ({ value: x.key, label: `${x.label} · ${x.key}` })), ui.anomalyDomain)}</div>
      ${statRow([{ value: num(active.total, 0), label: '样本' }, { value: num(active.anomalyCount, 0), label: '异常样本' }, { value: pct(active.anomalyCount / Math.max(1, active.total), 1), label: '异常比例' }, { value: esc(active.scoreStats?.median?.toFixed?.(3) ?? '—'), label: '分数中位数' }])}
      <p class="assumption">该领域特征：${esc(arr(active.features).join('、'))}。数据：${esc(active.source || d.source || 'SIMULATED')}</p>
    </div>
    <div class="research-grid" style="margin-top:14px">
      <article class="card card-pad"><p class="section-kicker">ANOMALY SCORE</p><h3>异常分数分布</h3>
        ${scatterChart(scatter, { xLabel: '主特征值', yLabel: 'Anomaly Score' })}
        <p class="assumption">红点=模型判定异常；分数越低越离群（Isolation Forest 约定）。</p>
      </article>
      <article class="card card-pad"><p class="section-kicker">ANOMALY RECORDS</p><h3>异常记录与原因</h3>
        ${table([{ label: 'ID' }, { label: '时间' }, { label: '位置' }, { label: '分数', cls: 'right' }, { label: '原因' }],
          arr(active.anomalies).map(a => `<tr><td class="mono">${esc(a.id)}</td><td>${esc(a.time)}</td><td>${esc(a.location)}</td><td class="right">${num(a.score, 3)}</td><td>${esc(a.reason)}</td></tr>`), { maxHeight: '360px' })}
      </article>
    </div>
    <article class="card card-pad" style="margin-top:14px"><p class="section-kicker">METHODOLOGY</p><h3>独立特征空间</h3>
      <p class="lead">${esc(d.methodNote || '')}</p>
      ${table([{ label: '领域' }, { label: '特征数', cls: 'right' }, { label: '样本', cls: 'right' }, { label: '异常', cls: 'right' }, { label: '数据来源' }],
        domains.map(x => `<tr><td>${esc(x.label)}</td><td class="right">${arr(x.features).length}</td><td class="right">${num(x.total, 0)}</td><td class="right">${num(x.anomalyCount, 0)}</td><td>${esc(x.source || 'SIMULATED')}</td></tr>`))}
    </article>${disclaimer(d.disclaimers)}`;
  renderInto('anomalyDashboard', html);
  bindSelect('anDomain', v => { ui.anomalyDomain = v; renderAnomaly(); });
}

/* --------------------------------------------------------- evaluation lab */
function experimentRecords() {
  const out = [];
  const add = (rec) => out.push(rec);
  const stamp = lab?.dataProfile?.versions?.[0]?.date || '2026-11-23';
  const a = lab?.association;
  arr(a?.sweeps).forEach((s, i) => add({
    id: `EXP-A${i + 1}`, category: 'Apriori', algorithm: 'Apriori', datasetVersion: a?.version,
    algorithmVersion: '1.0.0', parameters: { minSupportCount: s.minSupportCount, minConfidence: s.minConfidence },
    seed: a?.seed, split: `${num(a?.baskets, 0)} baskets`, metrics: { rules: s.ruleCount, maxLift: Number(s.maxLift), avgConfidence: Number(s.avgConfidence) },
    executionTime: a?.seconds, timestamp: stamp, source: 'REAL',
  }));
  const c = lab?.clustering;
  [['product', '商品聚类'], ['traffic', '客流聚类']].forEach(([key, label]) => {
    arr(c?.[key]?.kValues).forEach((k, i) => add({
      id: `EXP-C${key === 'product' ? 'P' : 'T'}${i + 1}`, category: 'K-Means', algorithm: `K-Means · ${label}`, datasetVersion: c?.version,
      algorithmVersion: '1.0.0', parameters: { k: k.k, init: 'k-means++', nInit: 5 }, seed: c?.seed,
      split: `${num(c?.[key]?.sampleSize, 0)} samples`, metrics: { inertia: Number(k.inertia), silhouette: Number(k.silhouette) },
      executionTime: c?.seconds, timestamp: stamp, source: key === 'product' ? 'REAL' : 'SIMULATED',
    }));
  });
  const r = lab?.reorder;
  Object.entries(r?.results || {}).forEach(([name, m], i) => add({
    id: `EXP-S${i + 1}`, category: '分类模型', algorithm: `复购预测 · ${name.replace('_', ' ')}`, datasetVersion: '1.0.0',
    algorithmVersion: '1.0.0', parameters: { features: r?.features?.count, cv: 5 }, seed: r?.split?.seed,
    split: `${num(r?.sampleCounts?.train, 0)}/${num(r?.sampleCounts?.test, 0)}`, metrics: { accuracy: m.accuracy, f1: m.f1, rocAuc: m.rocAuc },
    executionTime: r?.seconds, timestamp: stamp, source: 'REAL',
  }));
  const cg = lab?.congestion;
  Object.entries(cg?.models || {}).forEach(([name, m], i) => add({
    id: `EXP-G${i + 1}`, category: '分类模型', algorithm: `拥堵分类 · ${name.replace('_', ' ')}`, datasetVersion: cg?.version,
    algorithmVersion: '1.0.0', parameters: { features: arr(cg?.features).length }, seed: cg?.seed,
    split: `${num(cg?.split?.train, 0)}/${num(cg?.split?.test, 0)}`, metrics: { accuracy: m.accuracy, macroF1: Number(m.macroF1) },
    executionTime: cg?.seconds, timestamp: stamp, source: 'SIMULATED',
  }));
  const rg = lab?.regression;
  Object.entries(rg?.models || {}).forEach(([name, m], i) => add({
    id: `EXP-R${i + 1}`, category: '回归模型', algorithm: `通行时间 · ${name.replace('_', ' ')}`, datasetVersion: rg?.version,
    algorithmVersion: '1.0.0', parameters: { features: arr(rg?.features).length }, seed: rg?.seed,
    split: `${num(rg?.split?.train, 0)}/${num(rg?.split?.test, 0)}`, metrics: { mae: Number(m.mae), rmse: Number(m.rmse), r2: Number(m.r2) },
    executionTime: rg?.seconds, timestamp: stamp, source: 'SIMULATED',
  }));
  const fc = lab?.forecast;
  arr(fc?.methods).forEach((m, i) => add({
    id: `EXP-F${i + 1}`, category: '客流预测', algorithm: m.name, datasetVersion: fc?.version,
    algorithmVersion: '1.0.0', parameters: m.params || {}, seed: fc?.seed,
    split: '前18小时/后6小时', metrics: { mae: Number(m.mae), rmse: Number(m.rmse), mape: Number(m.mape) },
    executionTime: fc?.seconds, timestamp: stamp, source: 'SIMULATED',
  }));
  const an = lab?.anomaly;
  arr(an?.domains).forEach((x, i) => add({
    id: `EXP-N${i + 1}`, category: '异常检测', algorithm: `IsolationForest · ${x.label}`, datasetVersion: an?.version,
    algorithmVersion: '1.0.0', parameters: { contamination: an?.contamination, features: arr(x.features).length }, seed: an?.seed,
    split: `${num(x.total, 0)} samples`, metrics: { anomalies: x.anomalyCount, medianScore: Number(x.scoreStats?.median) },
    executionTime: an?.seconds, timestamp: stamp, source: 'SIMULATED',
  }));
  const cf = lab?.cf;
  if (cf?.evaluation) add({
    id: 'EXP-CF1', category: '推荐系统', algorithm: 'Item-based CF', datasetVersion: '1.0.0',
    algorithmVersion: '1.0.0', parameters: { pool: cf?.pool?.size, neighbors: 10 }, seed: cf?.split?.seed,
    split: `${num(cf?.split?.buildBaskets, 0)}/${num(cf?.split?.evalBaskets, 0)}`, metrics: { 'precision@5': cf.evaluation.cf?.['precision@5'], 'recall@5': cf.evaluation.cf?.['recall@5'] },
    executionTime: cf?.seconds, timestamp: stamp, source: 'REAL',
  });
  const sc = lastContext.strategyComparison;
  ['A', 'B', 'C'].forEach((key, i) => {
    const row = arr(sc?.comparison).find(x => x.strategy === key || x.key === key || x.label?.includes(key));
    const metrics = row ? { distance: Number(row.distance ?? row.pathDistance), time: Number(row.time ?? row.estimatedTime), risk: Number(row.risk ?? row.riskCost), total: Number(row.total ?? row.totalCost) } : null;
    add({
      id: `EXP-P${i + 1}`, category: '路径优化', algorithm: `Strategy ${key} · ${['距离', '距离+时间', '距离+时间+风险'][i]}`, datasetVersion: 'runtime',
      algorithmVersion: '3.0.0', parameters: { sameOrder: true, sameSnapshot: true }, seed: '—',
      split: '同一订单/同一行人快照', metrics: metrics || { note: '尚未运行；在路径优化页运行三策略对照后显示实时指标' },
      executionTime: row?.computationTime ?? null, timestamp: '运行时计算', source: 'SIMULATED',
    });
  });
  return out;
}
function renderEvaluationLab() {
  if (!lab) return renderInto('evaluationDashboard', '<p class="empty">实验数据未加载。</p>');
  const cats = [...new Set(experimentRecords().map(r => r.category))];
  const sourceOpts = [{ value: 'ALL', label: '全部来源' }, { value: 'REAL', label: '真实数据' }, { value: 'SIMULATED', label: '仿真数据' }];
  const rows = experimentRecords().filter(r =>
    (ui.evalAlgorithm === 'ALL' || r.category === ui.evalAlgorithm) &&
    (ui.evalSource === 'ALL' || r.source === ui.evalSource) &&
    (!ui.evalQuery || JSON.stringify(r).toLowerCase().includes(ui.evalQuery.toLowerCase()))
  );
  const html = `${hero('EVALUATION LAB · EXPERIMENT REGISTRY', '综合实验评价', '每次实验记录 ID、数据集版本、算法、参数、随机种子、训练/测试划分、评价指标、执行时间与时间来源，可筛选查看历史结果。', `${rows.length} 条实验记录`)}
    <div class="card card-pad" style="margin-top:12px"><div class="card-head"><div><p class="section-kicker">EXPERIMENT FILTER</p><h3>筛选实验记录</h3></div>
      <div class="btn-row">${select('evCat', '算法类别', [{ value: 'ALL', label: '全部类别' }, ...cats.map(c => ({ value: c, label: c }))], ui.evalAlgorithm)}${select('evSource', '数据来源', sourceOpts, ui.evalSource)}
      <label class="field"><span class="field-label">搜索</span><input id="evQuery" type="search" placeholder="实验 ID / 算法 / 指标" value="${esc(ui.evalQuery)}"></label></div></div>
      ${statRow([{ value: num(experimentRecords().length, 0), label: '总实验数' }, { value: num(experimentRecords().filter(r => r.source === 'REAL').length, 0), label: '真实数据实验' }, { value: num(experimentRecords().filter(r => r.source === 'SIMULATED').length, 0), label: '仿真实验' }, { value: num(cats.length, 0), label: '算法类别' }])}
    </div>
    <article class="card card-pad" style="margin-top:14px"><p class="section-kicker">EXPERIMENT HISTORY</p><h3>历史实验结果</h3>
      ${table([{ label: 'ID' }, { label: '算法' }, { label: '数据集' }, { label: '参数' }, { label: 'Seed' }, { label: '划分' }, { label: '指标' }, { label: '耗时(s)', cls: 'right' }, { label: '时间' }, { label: '来源' }],
        rows.map(r => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.algorithm)}</td><td class="mono">${esc(r.datasetVersion || '—')}</td><td>${esc(Object.entries(r.parameters || {}).map(([k, v]) => `${k}=${v}`).join(', '))}</td><td>${esc(r.seed ?? '—')}</td><td>${esc(r.split)}</td><td>${esc(Object.entries(r.metrics || {}).map(([k, v]) => `${k}=${num(v, 3)}`).join(', '))}</td><td class="right">${r.executionTime == null ? '—' : num(r.executionTime, 2)}</td><td>${esc(r.timestamp)}</td><td><span class="pill ${r.source === 'REAL' ? 'pill--ok' : 'pill--info'}">${esc(r.source)}</span></td></tr>`), { maxHeight: '520px' })}
    </article>
    <article class="card card-pad" style="margin-top:14px"><p class="section-kicker">COMPARISON MATRIX</p><h3>跨实验对比</h3>
      ${['Apriori', 'K-Means', '分类模型', '回归模型', '客流预测', '路径优化'].map(cat => {
        const group = experimentRecords().filter(r => r.category === cat);
        if (!group.length) return '';
        return `<div style="margin-bottom:14px"><h4>${esc(cat)}</h4>${bars(group.map(r => ({ label: r.id, count: Object.values(r.metrics || {}).find(v => typeof v === 'number') || 0 })), '')}</div>`;
      }).join('')}
      <p class="assumption">对比条取每个实验的第一个数值指标（不同类别指标量纲不同，仅用于横向定位，不代表统一评分）。</p>
    </article>`;
  renderInto('evaluationDashboard', html);
  bindSelect('evCat', v => { ui.evalAlgorithm = v; renderEvaluationLab(); });
  bindSelect('evSource', v => { ui.evalSource = v; renderEvaluationLab(); });
  const query = document.getElementById('evQuery');
  if (query) query.addEventListener('input', event => { ui.evalQuery = event.target.value; renderEvaluationLab(); const q = document.getElementById('evQuery'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
}

/* ------------------------------------------------------------ data sources */
function renderDataSources() {
  const s = lab?.summary;
  const p = lab?.dataProfile;
  if (!s && !p) return;
  const q = s?.quality || {};
  const html = `<article class="card card-pad" style="margin-top:14px"><p class="section-kicker">DATA SOURCES · 数据来源</p><h3>真实数据 / 仿真数据 / 计算结果</h3>
    <div class="grid grid-3">
      <div class="data-class real"><b>真实数据 · REAL DATA</b><p>Instacart 清洗数据集：${num(s?.products, 0)} 件商品、${num(s?.orders, 0)} 笔订单、${num(s?.orderProductLines, 0)} 行 train 订单商品、${num(s?.basketOrders, 0)} 个购物篮。商品名称、部门、共购关系未按研究目的改写。</p></div>
      <div class="data-class calc"><b>计算结果 · CALCULATED</b><p>Apriori support/confidence/lift、K-Means、Logistic/Decision Tree/Random Forest、Isolation Forest 均由 scripts/ 中的真实代码离线计算；Held–Karp 与 A* 在浏览器在线计算。</p></div>
      <div class="data-class sim"><b>仿真数据 · SIMULATED</b><p>货架坐标、模拟库存、行人密度、通道占用、通行时间、机器人轨迹与障碍事件由显式规则生成，已在对应页面标注“仿真”，不冒充真实监控。</p></div>
    </div>
    <p class="assumption">清洗前原始异常删除量无法从已清洗文件反推；缺失值：热量 ${num(q.missingProductFields?.calories_kcal_per_100g, 0)} 件，历史间隔 ${num(q.missingPriorOrderInterval, 0)} 条。价格/重量/热量是数据集自带估算字段，不是本演示实测。</p>
  </article>`;
  const host = document.getElementById('dataSourcesPanel');
  if (host) host.innerHTML = html;
}

/* ------------------------------------------------------------------ dispatch */
export function renderMiningViews(context = {}) {
  if (!lab) return;
  lastContext = { ...lastContext, ...context };
  renderDataExplorer();
  renderAssociation();
  renderRecommendation();
  renderClustering();
  renderCongestion();
  renderRegression();
  renderForecast();
  renderAnomaly();
  renderEvaluationLab();
  renderDataSources();
}
export function isMiningView(name) { return NEW_VIEWS.includes(name); }
