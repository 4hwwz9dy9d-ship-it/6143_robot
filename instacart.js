// NEXUS RETAIL — Instacart data adapter and premium research visualisation.
// REAL DATA: cleaned CSV → static JSON. CALCULATED: Apriori + K-means offline.
// Chinese is used only for research explanation; business labels stay English.
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
const text = value => String(value ?? '');
export const escapeHtml = value => text(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const count = value => Number(value ?? 0).toLocaleString('en-US');

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
  const price = product.priceMethod === 'online_bls_staple_proxy' ? 'Staple price proxy' : 'Category estimate';
  const weight = product.weightMethod === 'category_default_after_spec_guard' ? 'Spec parse fallback → category default'
    : /parse|name/i.test(product.weightMethod) ? 'Parsed from name' : 'Category default';
  const calorie = product.calories100g == null ? 'N/A (non-food)' : 'Category nutrition estimate';
  return { price, weight, calorie };
}

/* ------------------------------------------------------- chart primitives */
function barChart(items, unit = '', color = 'bar') {
  const max = Math.max(1, ...items.map(item => item.count));
  return `<div class="chart research-bars">${items.map(item =>
    `<div class="research-bar" data-tip="${escapeHtml(`${item.range}: ${count(item.count)}${unit}`)}"><span>${escapeHtml(item.range)}</span><div><i class="${color}" style="width:${Math.max(1, item.count / max * 100)}%"></i></div><b>${count(item.count)}${unit}</b></div>`).join('')}<div class="chart-hover"></div></div>`;
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
    ${items.map((item, i) => `<circle class="dot-mark" cx="${points[i][0].toFixed(1)}" cy="${points[i][1].toFixed(1)}" r="4" data-tip="${escapeHtml(`${item.range}: ${count(item.count)}`)}"/>`).join('')}
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
      <div><p class="section-kicker">REAL DATA · OFFLINE CALCULATION</p><h2>Instacart Order &amp; Product Intelligence</h2>
        <p>Product names, departments and purchase links come from the supplied cleaned Instacart files. Price, weight and calorie fields are pre-existing estimates in the dataset. In-store crowd, obstacles and robot motion remain simulation.</p></div>
      <span class="research-badge">SOURCE: INSTACART · 5 CLEANED CSV</span>
    </div>
    <div class="research-stats">
      <div><b>${count(s.products)}</b><span>Products</span></div>
      <div><b>${count(s.orders)}</b><span>Orders</span></div>
      <div><b>${count(s.orderProductLines)}</b><span>Train order-product lines</span></div>
      <div><b>${count(s.aisles)} / ${count(s.departments)}</b><span>Aisles / departments</span></div>
      <div><b>${s.meanTrainBasketSize}</b><span>Mean train basket size</span></div>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">ESTIMATED ATTRIBUTES</p><h3>Product attribute distribution</h3>
        <p class="lead" style="font-size:11px">Estimated price (USD)</p>${barChart(s.priceDistribution, '', 'bar')}
        <p class="lead" style="font-size:11px">Estimated weight (g)</p>${barChart(s.weightDistribution, '', 'bar bar--blue')}
        <p class="lead" style="font-size:11px">Estimated kcal / 100 g (food only)</p>${barChart(s.calorieDistribution, '', 'bar bar--amber')}
        <p class="assumption">Chinese note: 价格与重量为数据集中的估算字段；类别均价 ${count(m.price_method.category_average_estimate || 0)} 件，其余为基础商品价格代理。非食品不填造热量。</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">REAL TRANSACTION TIMES</p><h3>Online order hours</h3>
        <p class="lead" style="font-size:11px">These are online ordering hours, NOT in-store traffic.</p>
        ${lineChart(Object.entries(s.orderHour).map(([hour, value]) => ({ range: `${hour}h`, count: value })), 'Order hour distribution')}
        <h4 style="margin-top:14px">Top products by train frequency</h4><ol id="topProductList" class="research-list"></ol>
        <h4>Top reorder-rate products</h4><ol id="topReorderedList" class="research-list"></ol>
      </article>
    </div>
    <div class="research-grid">
      <article class="card card-pad">
        <p class="section-kicker">APRIORI · CALCULATED</p><h3>Association rules</h3>
        <p class="lead" style="font-size:11px">${count(r.baskets)} real train baskets; ${count(r.candidateProducts)} candidate products; min co-purchase count ${r.minSupportCount}; ${count(r.ruleCount)} rules in ${r.seconds}s. Hover bars and nodes for exact values.</p>
        <div class="research-controls">
          <label>Min support<input id="ruleSupport" type="number" min="${r.minSupport}" max="1" step="0.0001" value="0.0003"/></label>
          <label>Min confidence<input id="ruleConfidence" type="number" min="0" max="1" step="0.01" value="0.15"/></label>
        </div>
        <p id="ruleFilterCount" class="assumption"></p>
        <div id="researchRuleTable"></div>
        <div id="ruleNetwork" class="rule-network"></div>
        <p class="assumption">Chinese note: ${escapeHtml(r.scope)} 共购不等于因果，也不证明推荐带来增购。</p>
      </article>
      <article class="card card-pad">
        <p class="section-kicker">K-MEANS · CALCULATED</p><h3>Product clusters</h3>
        <p class="lead" style="font-size:11px">Sample ${count(c.sampleSize)} high-frequency food items; features: log estimated price / weight / kcal, real frequency, reorder rate and aisle / department one-hot. Non-food calories are not invented.</p>
        <p class="assumption">肘部法选择 K=${c.selectedK}；轮廓系数在 ${c.silhouetteSample} 件固定样本上评价，训练耗时 ${c.seconds}s。</p>
        <div id="kDiagnostics"></div>
        <div id="clusterPlot" class="cluster-plot"></div>
        <div id="clusterCards"></div>
        <p class="assumption">2D view is a PCA projection. Clusters are not a validated store layout; cold-chain, food separation and aisle width need manual review.</p>
      </article>
    </div>
    <article class="card card-pad">
      <p class="section-kicker">DATA QUALITY</p><h3>Input audit and processing record</h3>
      <div class="quality-grid">
        <div><b>Input check</b><p>Imported cleaned CSV: products ${count(q.rawRows.products)} rows, orders ${count(q.rawRows.orders)}, train order-product lines ${count(q.rawRows.orderProductsTrain)}. Valid outputs: ${count(q.cleanRows.products)} / ${count(q.cleanRows.orders)} / ${count(q.cleanRows.orderProductsTrain)}.</p></div>
        <div><b>Duplicate &amp; link check</b><p>Duplicates in provided files: ${q.duplicateRowsInProvidedCleanFiles.products} products, ${q.duplicateRowsInProvidedCleanFiles.orders} orders, ${q.duplicateRowsInProvidedCleanFiles.orderProductsTrain} train lines; invalid links ${count(Object.values(q.invalidLinksInProvidedCleanFiles).reduce((a, b) => a + b, 0))}.</p></div>
        <div><b>Missing &amp; anomaly check</b><p>Missing calories ${count(q.missingProductFields.calories_kcal_per_100g || 0)} (incl. non-food); missing prior interval ${count(q.missingPriorOrderInterval)}; non-positive price ${count(q.invalidAttributeValues.nonPositivePrice || 0)}, weight ${count(q.invalidAttributeValues.nonPositiveWeight || 0)}, negative calories ${count(q.invalidAttributeValues.negativeCalories || 0)}; parsed-weight fallbacks ${count(q.correctedParsedWeights || 0)}.</p></div>
        <div><b>Feature engineering</b><p>Integer IDs and numeric fields parsed; train-basket frequency and reorder ratio computed; K-means uses log transform, z-score and one-hot. Original CSV files were not modified.</p></div>
      </div>
      <p class="assumption">${escapeHtml(q.note)} Chinese note: 清洗前删除量无法从已清洗文件反推，网页不虚构该数字。</p>
      <details class="quality-steps"><summary>Show 11-step processing record</summary><ol>
        <li>Import five already-cleaned CSV files; original files untouched.</li>
        <li>Duplicate scan: products ${q.duplicateRowsInProvidedCleanFiles.products}, orders ${q.duplicateRowsInProvidedCleanFiles.orders}, train links ${q.duplicateRowsInProvidedCleanFiles.orderProductsTrain}.</li>
        <li>Missing: food calories ${count(q.missingProductFields.calories_kcal_per_100g || 0)}; prior-order interval ${count(q.missingPriorOrderInterval)}.</li>
        <li>Anomalies: non-positive price ${count(q.invalidAttributeValues.nonPositivePrice || 0)}, weight ${count(q.invalidAttributeValues.nonPositiveWeight || 0)}, negative calories ${count(q.invalidAttributeValues.negativeCalories || 0)}.</li>
        <li>Links: product, order, aisle and department IDs validated; invalid ${count(Object.values(q.invalidLinksInProvidedCleanFiles).reduce((a, b) => a + b, 0))}.</li>
        <li>Types: IDs cast to integers; estimated numeric fields parsed; ${count(s.products)} products processed.</li>
        <li>Provenance: estimation-method labels retained; estimates are not rewritten as measurements.</li>
        <li>Attribute groups: category price ${count(m.price_method.category_average_estimate || 0)}; weight fallbacks ${count(m.weight_method.category_default_after_spec_guard || 0)}.</li>
        <li>Training-basket statistics computed on ${count(s.basketOrders)} baskets.</li>
        <li>K-means features standardised; training sample ${count(c.sampleSize)}.</li>
        <li>Outputs: catalog shards, search index, summary, Apriori rules, K-means results and top-product lists.</li>
      </ol></details>
    </article>`;
  el.querySelectorAll('.chart').forEach(attachChartHover);
  document.getElementById('topProductList').innerHTML = data.top.slice(0, 10).map(p =>
    `<li>${escapeHtml(p.name)} · ${count(p.frequency)} purchases · reorder ${((p.reorderRate || 0) * 100).toFixed(1)}%</li>`).join('');
  document.getElementById('topReorderedList').innerHTML = data.topReordered.map(p =>
    `<li>${escapeHtml(p.name)} · ${count(p.reorderedCount)} reorders / ${count(p.frequency)} purchases</li>`).join('');

  function renderFilteredRules() {
    const support = Math.max(r.minSupport, Number(document.getElementById('ruleSupport').value) || 0);
    const confidence = Math.max(0, Number(document.getElementById('ruleConfidence').value) || 0);
    const filtered = r.rules.filter(rule => rule.support >= support && rule.confidence >= confidence);
    document.getElementById('ruleFilterCount').textContent = `${count(filtered.length)} rules above the current thresholds (filtered from the mined candidate set).`;
    const rows = filtered.slice(0, 10);
    document.getElementById('researchRuleTable').innerHTML = rows.map(rule =>
      `<div class="rule-row" data-tip="Support ${(rule.support * 100).toFixed(4)}% · Confidence ${(rule.confidence * 100).toFixed(2)}% · Lift ${rule.lift.toFixed(3)}"><b>${escapeHtml(r.products[rule.from]?.name ?? rule.from)} → ${escapeHtml(r.products[rule.to]?.name ?? rule.to)}</b><small>Support ${(rule.support * 100).toFixed(3)}% · Conf ${(rule.confidence * 100).toFixed(1)}% · Lift ${rule.lift.toFixed(2)}</small></div>`).join('')
      || '<p class="empty">No rule matches the current thresholds.</p>';
    const shown = filtered.slice(0, 8), ids = [...new Set(shown.flatMap(rule => [rule.from, rule.to]))];
    const positions = new Map(ids.map((id, i) => [id, [300 + 215 * Math.cos(i * 2 * Math.PI / Math.max(ids.length, 1)), 135 + 95 * Math.sin(i * 2 * Math.PI / Math.max(ids.length, 1))]]));
    document.getElementById('ruleNetwork').innerHTML = shown.length ? `<svg viewBox="0 0 600 275" role="img" aria-label="Association network from real baskets"><defs><marker id="networkArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#7b9fa3"/></marker></defs>
      ${shown.map(rule => { const [x1, y1] = positions.get(rule.from), [x2, y2] = positions.get(rule.to);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7bbfb6" stroke-width="${Math.min(5, 1 + rule.confidence * 6)}" marker-end="url(#networkArrow)"><title>${escapeHtml(`Confidence ${(rule.confidence * 100).toFixed(1)}% · Lift ${rule.lift.toFixed(2)}`)}</title></line>`; }).join('')}
      ${ids.map(id => { const [x, y] = positions.get(id), name = r.products[id]?.name || String(id);
        return `<g><circle cx="${x}" cy="${y}" r="22" fill="#1a5b62"><title>${escapeHtml(name)}</title></circle><text x="${x}" y="${y + 34}" text-anchor="middle" font-size="9" fill="#35505c">${escapeHtml(name.slice(0, 17))}</text></g>`; }).join('')}</svg>` : '<p class="empty">No network edges at the current thresholds.</p>';
    const ruleCard = document.getElementById('researchRuleTable').parentElement;
    attachChartHover(ruleCard);
  }
  ['ruleSupport', 'ruleConfidence'].forEach(id => document.getElementById(id).addEventListener('input', renderFilteredRules));
  renderFilteredRules();

  document.getElementById('kDiagnostics').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>K</th><th>Inertia</th><th>Silhouette</th></tr></thead><tbody>${c.kValues.map(x =>
    `<tr><td>${x.k}</td><td>${x.inertia.toFixed(1)}</td><td>${x.silhouette?.toFixed(3) ?? 'n/a'}</td></tr>`).join('')}</tbody></table></div>` + barChart(c.kValues.map(x => ({ range: `K=${x.k}`, count: x.inertia })), '', 'bar bar--blue');
  const clusterColors = ['#20A995', '#3D7BD6', '#E8A34A', '#8E6FB0', '#D96C68', '#7A9E4B', '#5C8CA8'];
  document.getElementById('clusterPlot').innerHTML = c.points.map(([x, y, label]) =>
    `<i title="Cluster ${label}" style="left:${(x + 1) * 50}%;top:${(1 - y) * 50}%;background:${clusterColors[(label - 1) % clusterColors.length]}"></i>`).join('');
  document.getElementById('clusterCards').innerHTML = c.clusters.map(group =>
    `<div class="cluster-card"><b>Cluster ${group.id} · ${count(group.count)} products</b><small>Avg price $${group.avgPriceUsd} · avg weight ${group.avgWeightG} g · avg kcal ${group.avgCalories100g} · reorder ${((group.avgReorderRate || 0) * 100).toFixed(1)}%</small><span>Representatives: ${group.representatives.map(escapeHtml).join(', ')}</span></div>`).join('');
  el.querySelectorAll('.chart:not([data-bound])').forEach(chart => { chart.dataset.bound = '1'; attachChartHover(chart); });
}
