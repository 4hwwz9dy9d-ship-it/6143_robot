// NEXUS RETAIL — Instacart data adapter and premium research visualisation.
// REAL DATA: cleaned CSV → static JSON. CALCULATED: Apriori + K-means offline.
// 界面以中文为主体，英文术语作为小号辅助标签；商品原始英文名称与真实数据保持不变。
import { shelves } from './storeData.js';

const BASE = './public/data/';
const CNY_PER_USD = 7; // teaching assumption, not a live exchange rate
const shelfByDepartment = {
  frozen: 'Frozen Food', other: 'Stationery', bakery: 'Bakery', produce: 'Fresh Produce',
  alcohol: 'Beverages', international: 'Condiments', beverages: 'Beverages', pets: 'Pet Supplies',
  'dry goods pasta': 'Grains & Oils', bulk: 'Grains & Oils', 'personal care': 'Personal Care',
  'meat seafood': 'Meat', pantry: 'Condiments', breakfast: 'Grains & Oils',
  'canned goods': 'Ready Meals', 'dairy eggs': 'Dairy & Eggs', household: 'Household Essentials',
  babies: 'Baby Care', snacks: 'Snacks', deli: 'Ready Meals', missing: 'Stationery',
};
const departmentEnglish = {
  frozen: 'Frozen', other: 'Other', bakery: 'Bakery', produce: 'Produce', alcohol: 'Alcohol',
  international: 'International', beverages: 'Beverages', pets: 'Pets',
  'dry goods pasta': 'Dry Goods & Pasta', bulk: 'Bulk', 'personal care': 'Personal Care',
  'meat seafood': 'Meat & Seafood', pantry: 'Pantry', breakfast: 'Breakfast',
  'canned goods': 'Canned Goods', 'dairy eggs': 'Dairy & Eggs', household: 'Household',
  babies: 'Babies', snacks: 'Snacks', deli: 'Deli', missing: 'Uncategorised',
};
const departmentCn = {
  frozen: '冷冻食品', other: '其他', bakery: '烘焙', produce: '生鲜果蔬', alcohol: '酒水饮料',
  international: '国际食品', beverages: '饮品', pets: '宠物用品', 'dry goods pasta': '谷物与意面',
  bulk: '散装食品', 'personal care': '个人护理', 'meat seafood': '肉类与海鲜', pantry: '干货调味',
  breakfast: '早餐食品', 'canned goods': '罐头食品', 'dairy eggs': '乳制品与蛋类', household: '家庭日用',
  babies: '母婴用品', snacks: '零食小吃', deli: '熟食', missing: '未分类',
};
const zoneCn = {
  'Personal Care': '个人护理', 'Household Essentials': '家庭日用', 'Cleaning Supplies': '清洁用品',
  'Baby Care': '母婴用品', Stationery: '文具', 'Pet Supplies': '宠物用品', Beverages: '饮品',
  'Dairy & Eggs': '乳制品与蛋类', Bakery: '烘焙', Snacks: '零食小吃', 'Ready Meals': '即食餐',
  'Frozen Food': '冷冻食品', 'Fresh Produce': '生鲜果蔬', Seafood: '海鲜', Meat: '肉类',
  'Grains & Oils': '谷物与食用油', 'Soy Products': '豆制品', Condiments: '调味品',
};
export const departmentLabel = value => departmentCn[value] || departmentEnglish[value] || text(value);
export const zoneLabel = value => zoneCn[value] || text(value);
const text = value => String(value ?? '');
export const escapeHtml = value => text(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const count = value => Number(value ?? 0).toLocaleString('zh-CN');

async function loadJson(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
export async function loadResearch() {
  const [index, summary, rules, clusters, top, topReordered] = await Promise.all([
    loadJson('catalog/index.json'), loadJson('summary.json'), loadJson('rules.json'),
    loadJson('clusters.json'), loadJson('top-products.json'), loadJson('top-reordered.json'),
  ]);
  return { index, summary, rules, clusters, top, topReordered };
}
export function convertProduct(row) {
  let zone = shelfByDepartment[row.department] || 'Stationery';
  if (row.department === 'produce') zone = 'Fresh Produce';
  if (row.department === 'meat seafood') zone = /seafood|fish|shellfish/i.test(row.aisle) ? 'Seafood' : 'Meat';
  if (row.department === 'household' && /clean|laundry/i.test(row.aisle)) zone = 'Cleaning Supplies';
  if (row.department === 'pantry' && /oil|vinegar/i.test(row.aisle)) zone = 'Grains & Oils';
  const shelf = shelves.find(item => item.category === zone) || shelves[0];
  return {
    id: `I${row.id}`, sourceId: row.id, name: row.name,
    category: departmentEnglish[row.department] || row.department,
    subcategory: row.aisle, department: row.department, departmentId: row.departmentId,
    aisleId: row.aisleId, shelfId: shelf.id, point: [...shelf.point],
    price: (row.priceUsd || 0) * CNY_PER_USD, priceUsd: row.priceUsd,
    weight: (row.weightG || 0) / 1000, weightG: row.weightG, calories100g: row.calories100g,
    priceMethod: row.priceMethod, weightMethod: row.weightMethod, calorieMethod: row.calorieMethod,
    dataQuality: row.quality, frequency: row.frequency, reorderedCount: row.reorderedCount,
    reorderRate: row.reorderRate, capacity: 20, stock: 20, source: 'Instacart name · estimated attributes',
  };
}
export async function searchCatalog(index, query, departmentId, aisleId, limit = 36) {
  const search = query.trim().toLowerCase();
  if (search && !departmentId && !aisleId) {
    const first = search.match(/[a-z0-9]/)?.[0] || '_';
    if (first === '_') return [];
    const entries = await loadJson(`catalog/search-${first}.json`);
    const matching = entries.filter(([, name]) => name.toLowerCase().includes(search))
      .sort((a, b) => Number(b[1].toLowerCase().startsWith(search)) - Number(a[1].toLowerCase().startsWith(search)) || a[1].length - b[1].length)
      .slice(0, limit);
    const ids = new Set(matching.map(row => row[0]));
    const departments = [...new Set(matching.map(row => row[2]))];
    const details = [];
    for (const id of departments) {
      const rows = await loadJson(`catalog/department-${id}.json`);
      for (const row of rows) if (ids.has(row.id)) details.push(row);
    }
    const rank = new Map(matching.map((row, i) => [row[0], i]));
    return details.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  }
  const departments = departmentId ? [Number(departmentId)] : index.departments.map(item => item.id);
  const found = [];
  for (const id of departments) {
    const rows = await loadJson(`catalog/department-${id}.json`);
    for (const row of rows) {
      if (aisleId && row.aisleId !== Number(aisleId)) continue;
      if (search && !`${row.name} ${row.aisle} ${row.department}`.toLowerCase().includes(search)) continue;
      found.push(row);
      if (found.length >= limit) return found;
    }
  }
  return found;
}
export function propertyLabels(product) {
  const price = product.priceMethod === 'online_bls_staple_proxy' ? '基础商品价格代理' : '类别均价估算';
  const weight = product.weightMethod === 'category_default_after_spec_guard' ? '规格解析失败 → 类别默认值'
    : /parse|name/i.test(product.weightMethod) ? '从名称解析' : '类别默认值';
  const calorie = product.calories100g == null ? '不适用（非食品）' : '类别营养估算';
  return { price, weight, calorie };
}

/* ------------------------------------------------------- chart primitives */
function barChart(items, unit = '', color = 'bar') {
  const max = Math.max(1, ...items.map(item => item.count));
  return `<div class="chart research-bars">${items.map(item =>
    `<div class="research-bar" data-tip="${escapeHtml(`${item.range}：${count(item.count)}${unit}`)}"><span>${escapeHtml(item.range)}</span><div><i class="${color}" style="width:${Math.max(1, item.count / max * 100)}%"></i></div><b>${count(item.count)}${unit}</b></div>`).join('')}<div class="chart-hover"></div></div>`;
}
function lineChart(items, label) {
  const width = 600, height = 190, pad = 30;
  const max = Math.max(1, ...items.map(item => item.count));
  const points = items.map((item, i) => [pad + i * (width - 2 * pad) / Math.max(1, items.length - 1), height - pad - item.count / max * (height - 2 * pad)]);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)?.[0] ?? pad},${height - pad} L${pad},${height - pad} Z`;
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
    ${[0, .5, 1].map(f => `<line class="grid-line" x1="${pad}" x2="${width - pad}" y1="${height - pad - f * (height - 2 * pad)}" y2="${height - pad - f * (height - 2 * pad)}"/>`).join('')}
    <path class="series-area" d="${area}"/><path class="series-line" d="${line}"/>
    ${items.map((item, i) => `<circle class="dot-mark" cx="${points[i][0].toFixed(1)}" cy="${points[i][1].toFixed(1)}" r="4" data-tip="${escapeHtml(`${item.range}：${count(item.count)}`)}"/>`).join('')}
    ${items.map((item, i) => i % 3 === 0 ? `<text class="axis-label" x="${points[i][0].toFixed(1)}" y="${height - 9}" text-anchor="middle">${escapeHtml(item.range)}</text>` : '').join('')}
    </svg><div class="chart-hover"></div></div>`;
}
function attachChartHover(root) {
  const tooltip = root.querySelector('.chart-hover');
  if (!tooltip) return;
  root.querySelectorAll('[data-tip]').forEach(node => {
    node.addEventListener('mouseenter', () => { tooltip.textContent = node.dataset.tip; tooltip.classList.add('is-visible'); });
    node.addEventListener('mousemove', event => {
      const box = root.getBoundingClientRect();
      tooltip.style.left = `${Math.max(40, Math.min(box.width - 40, event.clientX - box.left))}px`;
      tooltip.style.top = `${Math.max(24, event.clientY - box.top)}px`;
    });
    node.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
  });
}

/* ------------------------------------------------------ research dashboard */
export function renderResearchDashboard(data) {
  const el = document.getElementById('researchDashboard');
  if (!el) return;
  const { summary: s, rules: r, clusters: c } = data;
  const q = s.quality, m = s.methods;
  el.innerHTML = `
    <div class="research-hero">
      <div><p class="section-kicker">REAL DATA · OFFLINE CALCULATION</p><h2>Instacart 订单与商品分析</h2>
        <p>商品名称、部门与共购关系来自提供的 Instacart 清洗文件；价格、重量与热量是数据集中已有的估算字段。店内客流、障碍物与机器人运动均为仿真。</p></div>
      <span class="research-badge">来源：INSTACART · 5 份清洗 CSV</span>
    </div>
    <div class="research-stats">
      <div><b>${count(s.products)}</b><span>商品数量</span></div>
      <div><b>${count(s.orders)}</b><span>订单数量</span></div>
      <div><b>${count(s.orderProductLines)}</b><span>训练订单商品行</span></div>
      <div><b>${count(s.aisles)} / ${count(s.departments)}</b><span>货区 / 部门</span></div>
      <div><b>${s.meanTrainBasketSize}</b><span>平均训练购物篮件数</span></div>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">ESTIMATED ATTRIBUTES</p><h3>商品属性分布</h3>
        <p class="lead" style="font-size:11px">估算价格（美元）</p>${barChart(s.priceDistribution, '', 'bar')}
        <p class="lead" style="font-size:11px">估算重量（克）</p>${barChart(s.weightDistribution, '', 'bar bar--blue')}
        <p class="lead" style="font-size:11px">估算热量（千卡 / 100 克，仅食品）</p>${barChart(s.calorieDistribution, '', 'bar bar--amber')}
        <p class="assumption">价格与重量是数据集中的估算字段；类别均价 ${count(m.price_method.category_average_estimate || 0)} 件，其余为基础商品价格代理。非食品不虚构热量。</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">REAL TRANSACTION TIMES</p><h3>线上订单时段分布</h3>
        <p class="lead" style="font-size:11px">这些是线上下单时段，并非店内客流。</p>
        ${lineChart(Object.entries(s.orderHour).map(([hour, value]) => ({ range: `${hour}时`, count: value })), '下单时段分布')}
        <h4 style="margin-top:14px">训练频次最高的商品</h4><ol id="topProductList" class="research-list"></ol>
        <h4>复购率最高的商品</h4><ol id="topReorderedList" class="research-list"></ol>
      </article>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">APRIORI · CALCULATED</p><h3>关联规则</h3>
        <p class="lead" style="font-size:11px">基于 ${count(r.baskets)} 个真实训练购物篮；${count(r.candidateProducts)} 件候选商品；最小共购计数 ${r.minSupportCount}；耗时 ${r.seconds} 秒，共 ${count(r.ruleCount)} 条规则。悬停柱形与节点可查看精确数值。</p>
        <div class="research-controls">
          <label>最小支持度<input id="ruleSupport" type="number" min="${r.minSupport}" max="1" step="0.0001" value="0.0003"/></label>
          <label>最小置信度<input id="ruleConfidence" type="number" min="0" max="1" step="0.01" value="0.15"/></label>
        </div>
        <p id="ruleFilterCount" class="assumption"></p>
        <div id="researchRuleTable"></div>
        <div id="ruleNetwork" class="rule-network"></div>
        <p class="assumption">${escapeHtml(r.scope)} 共购不等于因果，也不证明推荐带来增购。</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">K-MEANS · CALCULATED</p><h3>商品聚类</h3>
        <p class="lead" style="font-size:11px">样本为 ${count(c.sampleSize)} 件高频食品；特征包括估算价格 / 重量 / 热量的对数值、真实频次、复购率，以及货区 / 部门 one-hot。非食品热量不虚构。</p>
        <p class="assumption">肘部法选择 K=${c.selectedK}；轮廓系数在 ${c.silhouetteSample} 件固定样本上评价，训练耗时 ${c.seconds} 秒。</p>
        <div id="kDiagnostics"></div>
        <div id="clusterPlot" class="cluster-plot"></div>
        <div id="clusterCards"></div>
        <p class="assumption">二维视图为 PCA 投影。聚类结果不是经过验证的门店布局；冷链、食品隔离与通道宽度仍需人工复核。</p>
      </article>
    </div>
    <article class="card card-pad">
      <p class="section-kicker">DATA QUALITY</p><h3>输入审计与处理记录</h3>
      <div class="quality-grid">
        <div><b>输入检查</b><p>导入的清洗 CSV：商品 ${count(q.rawRows.products)} 行、订单 ${count(q.rawRows.orders)} 行、训练订单商品 ${count(q.rawRows.orderProductsTrain)} 行。有效输出：${count(q.cleanRows.products)} / ${count(q.cleanRows.orders)} / ${count(q.cleanRows.orderProductsTrain)}。</p></div>
        <div><b>重复与关联检查</b><p>提供文件中的重复项：商品 ${q.duplicateRowsInProvidedCleanFiles.products}、订单 ${q.duplicateRowsInProvidedCleanFiles.orders}、训练关联 ${q.duplicateRowsInProvidedCleanFiles.orderProductsTrain}；无效关联 ${count(Object.values(q.invalidLinksInProvidedCleanFiles).reduce((a, b) => a + b, 0))}。</p></div>
        <div><b>缺失与异常检查</b><p>热量缺失 ${count(q.missingProductFields.calories_kcal_per_100g || 0)}（含非食品）；上次下单间隔缺失 ${count(q.missingPriorOrderInterval)}；价格非正 ${count(q.invalidAttributeValues.nonPositivePrice || 0)}、重量非正 ${count(q.invalidAttributeValues.nonPositiveWeight || 0)}、热量为负 ${count(q.invalidAttributeValues.negativeCalories || 0)}；重量解析回退 ${count(q.correctedParsedWeights || 0)}。</p></div>
        <div><b>特征工程</b><p>ID 转为整数并解析数值字段；计算训练购物篮频次与复购比例；K-means 使用对数变换、z-score 标准化与 one-hot。原始 CSV 未被修改。</p></div>
      </div>
      <p class="assumption">${escapeHtml(q.note)} 清洗前的删除量无法从已清洗文件反推，网页不虚构该数字。</p>
      <details class="quality-steps"><summary>查看 11 步处理记录</summary><ol>
        <li>导入五份已清洗 CSV，原始文件未改动。</li>
        <li>重复检查：商品 ${q.duplicateRowsInProvidedCleanFiles.products}、订单 ${q.duplicateRowsInProvidedCleanFiles.orders}、训练关联 ${q.duplicateRowsInProvidedCleanFiles.orderProductsTrain}。</li>
        <li>缺失检查：食品热量 ${count(q.missingProductFields.calories_kcal_per_100g || 0)}；上次下单间隔 ${count(q.missingPriorOrderInterval)}。</li>
        <li>异常检查：价格非正 ${count(q.invalidAttributeValues.nonPositivePrice || 0)}、重量非正 ${count(q.invalidAttributeValues.nonPositiveWeight || 0)}、热量为负 ${count(q.invalidAttributeValues.negativeCalories || 0)}。</li>
        <li>关联检查：商品、订单、货区与部门 ID 均已验证，无效 ${count(Object.values(q.invalidLinksInProvidedCleanFiles).reduce((a, b) => a + b, 0))}。</li>
        <li>类型检查：ID 转为整数，估算数值字段完成解析，共处理 ${count(s.products)} 件商品。</li>
        <li>来源标注：保留估算方法标签，不把估算值改写为实测值。</li>
        <li>属性分组：类别均价 ${count(m.price_method.category_average_estimate || 0)}；重量回退 ${count(m.weight_method.category_default_after_spec_guard || 0)}。</li>
        <li>在 ${count(s.basketOrders)} 个购物篮上计算训练统计。</li>
        <li>K-means 特征标准化，训练样本 ${count(c.sampleSize)}。</li>
        <li>输出：商品目录分片、搜索索引、汇总、Apriori 规则、K-means 结果与高频商品列表。</li>
      </ol></details>
    </article>`;
  el.querySelectorAll('.chart').forEach(attachChartHover);
  document.getElementById('topProductList').innerHTML = data.top.slice(0, 10).map(p =>
    `<li>${escapeHtml(p.name)} · ${count(p.frequency)} 次购买 · 复购率 ${((p.reorderRate || 0) * 100).toFixed(1)}%</li>`).join('');
  document.getElementById('topReorderedList').innerHTML = data.topReordered.map(p =>
    `<li>${escapeHtml(p.name)} · ${count(p.reorderedCount)} 次复购 / ${count(p.frequency)} 次购买</li>`).join('');

  function renderFilteredRules() {
    const support = Math.max(r.minSupport, Number(document.getElementById('ruleSupport').value) || 0);
    const confidence = Math.max(0, Number(document.getElementById('ruleConfidence').value) || 0);
    const filtered = r.rules.filter(rule => rule.support >= support && rule.confidence >= confidence);
    document.getElementById('ruleFilterCount').textContent = `当前阈值下有 ${count(filtered.length)} 条规则（从挖掘出的候选集中筛选）。`;
    const rows = filtered.slice(0, 10);
    document.getElementById('researchRuleTable').innerHTML = rows.map(rule =>
      `<div class="rule-row" data-tip="支持度 ${(rule.support * 100).toFixed(4)}% · 置信度 ${(rule.confidence * 100).toFixed(2)}% · 提升度 ${rule.lift.toFixed(3)}"><b>${escapeHtml(r.products[rule.from]?.name ?? rule.from)} → ${escapeHtml(r.products[rule.to]?.name ?? rule.to)}</b><small>支持度 ${(rule.support * 100).toFixed(3)}% · 置信度 ${(rule.confidence * 100).toFixed(1)}% · 提升度 ${rule.lift.toFixed(2)}</small></div>`).join('')
      || '<p class="empty">当前阈值下没有符合条件的规则。</p>';
    const shown = filtered.slice(0, 8), ids = [...new Set(shown.flatMap(rule => [rule.from, rule.to]))];
    const positions = new Map(ids.map((id, i) => [id, [300 + 215 * Math.cos(i * 2 * Math.PI / Math.max(ids.length, 1)), 135 + 95 * Math.sin(i * 2 * Math.PI / Math.max(ids.length, 1))]]));
    document.getElementById('ruleNetwork').innerHTML = shown.length ? `<svg viewBox="0 0 600 275" role="img" aria-label="来自真实购物篮的关联网络"><defs><marker id="networkArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#7b9fa3"/></marker></defs>
      ${shown.map(rule => { const [x1, y1] = positions.get(rule.from), [x2, y2] = positions.get(rule.to);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7bbfb6" stroke-width="${Math.min(5, 1 + rule.confidence * 6)}" marker-end="url(#networkArrow)"><title>${escapeHtml(`置信度 ${(rule.confidence * 100).toFixed(1)}% · 提升度 ${rule.lift.toFixed(2)}`)}</title></line>`; }).join('')}
      ${ids.map(id => { const [x, y] = positions.get(id), name = r.products[id]?.name || String(id);
        return `<g><circle cx="${x}" cy="${y}" r="22" fill="#1a5b62"><title>${escapeHtml(name)}</title></circle><text x="${x}" y="${y + 34}" text-anchor="middle" font-size="9" fill="#35505c">${escapeHtml(name.slice(0, 17))}</text></g>`; }).join('')}</svg>` : '<p class="empty">当前阈值下没有可用的网络边。</p>';
    const ruleCard = document.getElementById('researchRuleTable').parentElement;
    attachChartHover(ruleCard);
  }
  ['ruleSupport', 'ruleConfidence'].forEach(id => document.getElementById(id).addEventListener('input', renderFilteredRules));
  renderFilteredRules();

  document.getElementById('kDiagnostics').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>K 值</th><th>惯量</th><th>轮廓系数</th></tr></thead><tbody>${c.kValues.map(x =>
    `<tr><td>${x.k}</td><td>${x.inertia.toFixed(1)}</td><td>${x.silhouette?.toFixed(3) ?? '不适用'}</td></tr>`).join('')}</tbody></table></div>` + barChart(c.kValues.map(x => ({ range: `K=${x.k}`, count: x.inertia })), '', 'bar bar--blue');
  const clusterColors = ['#20A995', '#3D7BD6', '#E8A34A', '#8E6FB0', '#D96C68', '#7A9E4B', '#5C8CA8'];
  document.getElementById('clusterPlot').innerHTML = c.points.map(([x, y, label]) =>
    `<i title="第 ${label} 类" style="left:${(x + 1) * 50}%;top:${(1 - y) * 50}%;background:${clusterColors[(label - 1) % clusterColors.length]}"></i>`).join('');
  document.getElementById('clusterCards').innerHTML = c.clusters.map(group =>
    `<div class="cluster-card"><b>第 ${group.id} 类 · ${count(group.count)} 件商品</b><small>均价 $${group.avgPriceUsd} · 平均重量 ${group.avgWeightG} g · 平均热量 ${group.avgCalories100g} 千卡 · 复购率 ${((group.avgReorderRate || 0) * 100).toFixed(1)}%</small><span>代表商品：${group.representatives.map(escapeHtml).join('、')}</span></div>`).join('');
  el.querySelectorAll('.chart:not([data-bound])').forEach(chart => { chart.dataset.bound = '1'; attachChartHover(chart); });
}
