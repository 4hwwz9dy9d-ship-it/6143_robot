// NEXUS RETAIL — Instacart data adapter and premium research visualisation.
// REAL DATA: cleaned CSV → static JSON. CALCULATED: Apriori + K-means offline.
// 界面以中文为主体，英文术语作为小号辅助标签；商品原始英文名称与真实数据保持不变。
import { shelves } from './storeData.js';

const BASE = './public/data/';
// WorkBuddy 分享页的静态资源需要保留 sharecode；浏览器发出的相对路径请求不会自动带查询串，
// 因此统一在这里补回，避免「分享链接能打开、数据请求 403 / Failed to fetch」。
const SHARE_CODE = new URLSearchParams(location.search).get('sharecode');
const withShareCode = path => SHARE_CODE
  ? `${path}${path.includes('?') ? '&' : '?'}sharecode=${encodeURIComponent(SHARE_CODE)}`
  : path;
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

async function loadJson(path, retries = 1) {
  const url = withShareCode(BASE + path);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      if (attempt >= retries) {
        if (error?.name === 'AbortError') throw new Error(`${path}: 请求超时`);
        throw error;
      }
      // 瞬时网络抖动/分享页 Cookie 尚未就绪时重试一次，避免整个目录被一个请求拖死。
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
export async function loadResearch() {
  const [index, summary, rules, clusters, top, topReordered] = await Promise.all([
    loadJson('catalog/index.json'), loadJson('summary.json'), loadJson('rules.json'),
    loadJson('clusters.json'), loadJson('top-products.json'), loadJson('top-reordered.json'),
  ]);
  return { index, summary, rules, clusters, top, topReordered };
}
/** V2：监督学习 + 协同过滤 + 需求分析（独立 JSON，懒加载，失败不影响现有页面）。 */
export async function loadMl() {
  const [reorder, cf, demand] = await Promise.all([
    loadJson('ml/reorder-model.json'), loadJson('ml/cf-recommendations.json'), loadJson('ml/demand-analysis.json'),
  ]);
  return { reorder, cf, demand };
}
/** 真实部门/货道 → 店内 18 个货区。convertProduct 与「区域需求热度」共用同一套映射，
 *  保证路线优化里用到的冷/热区，和商品目录里显示的货区完全一致。 */
export function zoneOfDepartment(department, aisle = '') {
  let zone = shelfByDepartment[department] || 'Stationery';
  if (department === 'produce') zone = 'Fresh Produce';
  if (department === 'meat seafood') zone = /seafood|fish|shellfish/i.test(aisle) ? 'Seafood' : 'Meat';
  if (department === 'household' && /clean|laundry/i.test(aisle)) zone = 'Cleaning Supplies';
  if (department === 'pantry' && /oil|vinegar/i.test(aisle)) zone = 'Grains & Oils';
  return zone;
}
export function convertProduct(row) {
  const zone = zoneOfDepartment(row.department, row.aisle);
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

/* ------------------------------------------------- supervised learning (V2) */
const modelLabel = { logistic_regression: '逻辑回归 LR', random_forest: '随机森林 RF', decision_tree: '决策树 DT' };

function rocSvg(roc) {
  const w = 420, h = 300, pad = 34;
  const colors = { logistic_regression: '#3D7BD6', random_forest: '#20A995', decision_tree: '#E8A34A' };
  const x = v => pad + v * (w - 2 * pad), y = v => h - pad - v * (h - 2 * pad);
  const paths = Object.entries(roc).map(([name, r]) =>
    `<path d="${r.fpr.map((f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(r.tpr[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="${colors[name]}" stroke-width="2.5"/>`).join('');
  const legend = Object.entries(roc).map(([name, r], i) =>
    `<g transform="translate(${pad + i * 128},${h - 8})"><rect width="10" height="10" y="-8" fill="${colors[name]}"/><text x="14" y="0" font-size="10" fill="#35505c">${modelLabel[name]} AUC ${r.auc}</text></g>`).join('');
  return `<svg viewBox="0 0 ${w} ${h + 6}" role="img" aria-label="ROC 曲线">
    <line x1="${pad}" y1="${y(0)}" x2="${pad}" y2="${y(1)}" class="grid-line"/><line x1="${pad}" y1="${y(0)}" x2="${x(1)}" y2="${y(0)}" class="grid-line"/>
    <line x1="${pad}" y1="${y(1)}" x2="${x(1)}" y2="${y(0)}" stroke="#c9d6d2" stroke-dasharray="4 4"/>
    <text x="${pad - 6}" y="${y(1) + 4}" font-size="9" text-anchor="end" fill="#84919b">1.0</text>
    <text x="${pad - 6}" y="${y(0) + 4}" font-size="9" text-anchor="end" fill="#84919b">0.0</text>
    <text x="${x(1)}" y="${y(0) + 14}" font-size="9" text-anchor="middle" fill="#84919b">1.0</text>
    <text x="${x(0)}" y="${y(0) + 14}" font-size="9" text-anchor="middle" fill="#84919b">0.0</text>
    <text x="${(w - pad) / 2}" y="${y(0) + 26}" font-size="9" text-anchor="middle" fill="#84919b">假正率 FPR</text>
    <text x="12" y="${(h - 2 * pad) / 2 + pad}" font-size="9" fill="#84919b" transform="rotate(-90 12 ${((h - 2 * pad) / 2 + pad).toFixed(0)})">真正率 TPR</text>
    ${paths}${legend}</svg>`;
}

function importanceBars(items, color = 'bar') {
  const max = Math.max(1e-9, ...items.map(i => i.value));
  return items.map(i => `<div class="research-bar"><span title="${escapeHtml(i.feature)}">${escapeHtml(i.feature)}</span><div><i class="${color}" style="width:${Math.max(1, i.value / max * 100)}%"></i></div><b>${i.value.toFixed(3)}</b></div>`).join('');
}

function confusionTable(name, c) {
  const total = c.tn + c.fp + c.fn + c.tp;
  return `<table class="data-table confusion"><caption>${modelLabel[name]} · 测试集 ${count(total)} 行</caption>
    <thead><tr><th></th><th>预测：复购</th><th>预测：不复购</th></tr></thead>
    <tbody><tr><th>实际：复购</th><td class="ok">${count(c.tp)}</td><td>${count(c.fn)}</td></tr>
    <tr><th>实际：不复购</th><td>${count(c.fp)}</td><td class="ok">${count(c.tn)}</td></tr></tbody></table>`;
}

export function renderMlDashboard(ml) {
  const el = document.getElementById('mlDashboard');
  if (!el) return;
  const r = ml.reorder, cf = ml.cf, d = ml.demand;
  const posRate = ((r.sampleCounts.train + '' && 0) || 0);
  const positive = r.sampling.counts.positive, total = r.sampleCounts.total;
  const results = r.results, cv = r.crossValidation;
  const modelNames = Object.keys(results);
  const comparisonRows = modelNames.map(name => {
    const m = results[name], c = cv[name];
    return `<tr><td><b>${modelLabel[name]}</b></td><td>${c.rocAucMean} ± ${c.rocAucStd}</td><td>${m.accuracy}</td><td>${m.precision}</td><td>${m.recall}</td><td>${m.f1}</td><td><b>${m.rocAuc}</b></td></tr>`;
  }).join('');
  const majority = r.baseline.majority, popularity = r.baseline.popularity;
  const evalCf = cf.evaluation.cf, evalPop = cf.evaluation.popularityBaseline;
  const ks = [5, 10];
  el.innerHTML = `
    <div class="research-hero">
      <div><p class="section-kicker">SUPERVISED LEARNING · REAL DATA</p>
        <h2>Predicting Customer Product Reorders</h2>
        <p><b>研究问题：</b>能否基于历史购买行为与商品特征，预测用户是否会复购某件商品？使用 Instacart 数据集的真实 <code>reordered</code> 标签训练逻辑回归、随机森林与决策树，并用统一划分与指标公平比较。</p></div>
      <span class="research-badge">sklearn · 5 折交叉验证 · 固定随机种子 ${r.split.seed}</span>
    </div>
    <p class="assumption" style="margin:10px 0"><b>数据限制（如实说明）：</b>${escapeHtml(r.dataLimitation)}</p>
    <div class="research-stats">
      <div><b>${count(r.sampleCounts.train)}</b><span>训练样本行</span></div>
      <div><b>${count(r.sampleCounts.test)}</b><span>测试样本行</span></div>
      <div><b>${(positive / total * 100).toFixed(1)}%</b><span>正样本占比（复购）</span></div>
      <div><b>${r.candidatePool.size}</b><span>候选商品池（仅训练划分频次 Top）</span></div>
      <div><b>${r.features.count}</b><span>输入特征数</span></div>
      <div><b>${r.seconds}s</b><span>训练总耗时</span></div>
    </div>
    <article class="card card-pad">
      <p class="section-kicker">MODEL COMPARISON · 同一划分与同一指标</p><h3>模型对比</h3>
      <p class="lead" style="font-size:11px">交叉验证在训练集固定 ${count(cv[modelNames[0]].rows)} 行子样本上做 5 折分层采样；测试集为互不相交的 ${count(r.split.testUsers)} 名用户的订单。</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>模型</th><th>CV ROC-AUC（5 折）</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>测试 ROC-AUC</th></tr></thead><tbody>${comparisonRows}</tbody></table></div>
      <p class="assumption"><b>基线对比：</b>${escapeHtml(majority.description)} → Accuracy ${majority.accuracy}（正类占比仅 ${(majority.positiveRate * 100).toFixed(1)}%，Accuracy 高不代表模型有用）；${escapeHtml(popularity.description)} → ROC-AUC ${popularity.rocAuc}。所有模型指标均超过多数类基线； Accuracy 必须与 Precision / Recall / F1 / AUC 一起解读。</p>
      <div class="research-grid" style="margin-top:14px">
        <div><p class="lead" style="font-size:11px">ROC 曲线（测试集，虚线 = 随机猜测）</p>${rocSvg(r.roc)}</div>
        <div>${modelNames.map(name => confusionTable(name, results[name].confusion)).join('')}</div>
      </div>
    </article>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">FEATURE IMPORTANCE</p><h3>特征重要性</h3>
        <p class="lead" style="font-size:11px">随机森林不纯度重要性（Top 10）</p>
        ${importanceBars(r.importance.random_forest, 'bar')}
        <p class="lead" style="font-size:11px;margin-top:12px">逻辑回归标准化系数幅值（Top 10）</p>
        ${importanceBars(r.importance.logistic_regression, 'bar bar--blue')}
      </article>
      <article class="card card-pad">
        <p class="section-kicker">SPLIT &amp; DATA LEAKAGE CHECKS</p><h3>划分方式与防泄漏审计</h3>
        <p class="lead" style="font-size:11px">训练 / 测试划分</p>
        <p class="assumption">${escapeHtml(r.split.method)}抽样用户 ${count(r.split.sampled)} 人（训练 ${count(r.split.trainUsers)} / 测试 ${count(r.split.testUsers)}）。</p>
        <p class="lead" style="font-size:11px">样本构造</p>
        <p class="assumption">${escapeHtml(r.sampling.note)}</p>
        <p class="lead" style="font-size:11px">特征分组</p>
        <p class="assumption">${r.features.groups.map(g => escapeHtml(g)).join('；')}。</p>
        <p class="lead" style="font-size:11px">泄漏检查</p>
        <ul class="research-list">${r.leakageChecks.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
        <details class="quality-steps"><summary>查看完整特征列表（${r.features.count} 项）</summary><ol>${r.features.names.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ol></details>
      </article>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">ITEM-BASED COLLABORATIVE FILTERING · CALCULATED</p><h3>协同过滤推荐与离线评估</h3>
        <p class="lead" style="font-size:11px">${escapeHtml(cf.method)}</p>
        <p class="assumption">${escapeHtml(cf.split.method)}构建购物篮 ${count(cf.split.buildBaskets)} 个 / 评估购物篮 ${count(cf.split.evalBaskets)} 个。${escapeHtml(cf.evaluation.protocol)}</p>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>排序器</th>${ks.map(k => `<th>P@${k}</th><th>R@${k}</th><th>NDCG@${k}</th>`).join('')}</tr></thead>
          <tbody><tr><td><b>CF 相似度</b></td>${ks.map(k => `<td>${evalCf['precision@' + k]}</td><td>${evalCf['recall@' + k]}</td><td>${evalCf['ndcg@' + k]}</td>`).join('')}</tr>
          <tr><td>热门基线</td>${ks.map(k => `<td>${evalPop['precision@' + k]}</td><td>${evalPop['recall@' + k]}</td><td>${evalPop['ndcg@' + k]}</td>`).join('')}</tr></tbody></table></div>
        <p class="assumption">评估购物篮 ${count(evalCf.evaluatedBaskets)} 个（池内商品 ≥ 2 件）。${escapeHtml(cf.evaluation.note)}</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">CF QUERY · 试试看</p><h3>商品相似度查询</h3>
        <label class="field"><span class="field-label">选择一件候选池商品</span><select id="cfQuerySelect"></select></label>
        <div id="cfQueryResult" class="research-list" style="margin-top:10px"></div>
      </article>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">DEMAND REGRESSION · MAE / RMSE / R²</p><h3>需求频次回归（对照展示）</h3>
        <p class="lead" style="font-size:11px">${escapeHtml(d.target)}</p>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>模型</th><th>对数空间 R²</th><th>计数空间 MAE</th><th>计数空间 RMSE</th><th>计数空间 R²</th></tr></thead>
          <tbody>${Object.entries(d.results).map(([name, m]) => `<tr><td><b>${name === 'ridge' ? 'Ridge 回归' : '随机森林回归'}</b></td><td>${m.logSpace.r2}</td><td>${m.countSpace.mae}</td><td>${m.countSpace.rmse}</td><td>${m.countSpace.r2}</td></tr>`).join('')}
          <tr><td>中位数基线</td><td>—</td><td>${Object.values(d.results)[0].baselineMedianCount.mae}</td><td>${Object.values(d.results)[0].baselineMedianCount.rmse}</td><td>${Object.values(d.results)[0].baselineMedianCount.r2}</td></tr></tbody></table></div>
        <p class="lead" style="font-size:11px;margin-top:12px">随机森林特征重要性</p>
        ${importanceBars(d.importance.random_forest, 'bar bar--amber')}
        <p class="assumption">${escapeHtml(d.interpretation)}</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">RESTOCK PRIORITY · 真实历史信号</p><h3>补货优先级 Top 15</h3>
        <p class="lead" style="font-size:11px">${escapeHtml(d.restockPriority.method)}</p>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>商品</th><th>部门</th><th class="right">历史频次</th><th class="right">复购率</th><th class="right">优先级</th><th class="right">预测频次（对照）</th></tr></thead>
          <tbody>${d.restockPriority.top.slice(0, 15).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.department)}</td><td>${count(p.frequency)}</td><td>${(p.reorderRate * 100).toFixed(1)}%</td><td><b>${p.priority}</b></td><td>${count(p.predictedFrequency)}</td></tr>`).join('')}</tbody></table></div>
        <ul class="research-list">${d.disclaimers.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      </article>
    </div>`;
  el.querySelectorAll('.chart').forEach(attachChartHover);
  // CF 查询交互
  const select = document.getElementById('cfQuerySelect');
  const options = Object.keys(cf.neighbors).map(pid => {
    const name = cf.productNames[pid] || pid;
    return `<option value="${pid}">${escapeHtml(name)}</option>`;
  }).sort((a, b) => a.localeCompare(b));
  select.innerHTML = options.join('');
  const renderCfQuery = () => {
    const pid = select.value;
    const nns = cf.neighbors[pid] || [];
    document.getElementById('cfQueryResult').innerHTML = nns.length ? nns.map((n, i) => {
      const pct = Math.round(n.similarity * 100);
      return `<div class="research-bar"><span>${i + 1}. ${escapeHtml(n.name)}</span><div><i class="bar" style="width:${Math.max(2, pct)}%"></i></div><b>${n.similarity}</b></div>`;
    }).join('') : '<p class="empty">该商品在候选池中没有共现近邻。</p>';
  };
  select.addEventListener('change', renderCfQuery);
  renderCfQuery();
}

/** 订单页 CF 推荐面板：根据购物车内商品的 Instacart ID，并集近邻后按相似度排序。 */
export function renderCfRecommendations(cf, cartSourceIds, addLabel = '加入') {
  const el = document.getElementById('cfRecommendations');
  if (!el) return;
  const scored = new Map();
  for (const sid of cartSourceIds) {
    for (const n of cf.neighbors[sid] || []) {
      const cur = scored.get(n.id);
      if (!cur || n.similarity > cur.similarity) scored.set(n.id, n);
    }
  }
  const top = [...scored.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 4);
  el.innerHTML = top.length ? top.map(n =>
    `<div class="recommend-item"><div><b>${escapeHtml(n.name)}</b><small>与购物车商品共现相似度 ${n.similarity} · 构建集共现计算</small></div><button type="button" data-add="I${n.id}">${addLabel}</button></div>`).join('')
    : '<p class="empty">加入候选池中的高频商品（如香蕉、草莓、牛奶），即可查看基于真实共现相似度的协同过滤推荐。</p>';
}
