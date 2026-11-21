// NEXUS RETAIL — order system, algorithms, task state machine and view binding.
// REAL DATA: public/data JSON (Instacart). CALCULATED: Held-Karp, A*, Apriori, K-means.
// SIMULATED: shelves, stock, crowd, obstacles, robot motion, battery and timings.
import { createStoreScene } from './scene3d.js';
import { STORE, PHYSICS, buildNavNodes, shelves, layoutFixtures, products, timeSlots, crowdSamples, shelfCrowd, peopleForScenario } from './storeData.js';
import { PedestrianSystem, PEDESTRIAN_TYPES, PEDESTRIAN_STATES } from './pedestrian.js';
import { RobotBehavior, ROBOT_STATES, ROBOT_STATE_CN } from './robotBehavior.js';
import { loadResearch, searchCatalog, convertProduct, propertyLabels, renderResearchDashboard, escapeHtml, departmentLabel, zoneLabel } from './instacart.js';
import { getObstacleSnapshot, registerSensorProvider } from './sensorAdapter.js';

const $ = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const CAPACITY = 12, MIN_ORDER = 30;
const BASE_SPEED = PHYSICS.robot.maxSpeed / PHYSICS.metersPerUnit; // 0.78 m/s → 4.59 地图单位/秒
const MOTION_CN = { idle: '待机', moving: '行驶中', turning: '减速礼让', avoiding: '避障中', picking: '取货中', blocked: '安全停车', charging: '充电中', error: '故障', IDLE: '待机', MOVING: '行驶中', AVOIDING: '避障中', PICKING: '取货中', 'SAFE STOP': '安全停车', CHARGING: '充电中', FAULT: '故障' };
const stateCn = value => MOTION_CN[value] || value;
const key = p => p.join(',');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const money = n => `¥${n.toFixed(2)}`;
const kgText = n => `${n.toFixed(2)} kg`;
const productById = new Map(products.map(p => [p.id, p]));
const clockText = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

let research = null, rules = [], catalogResults = [], catalogRequest = 0, catalogTimer = 0, scene3d, restocks = 0;
window.INT6143_SENSOR = Object.freeze({ registerProvider: registerSensorProvider });

const substituteNames = {
  'Apple': 'Banana', 'Banana': 'Apple', 'Orange': 'Apple', 'Whole Milk': 'Low-fat Milk',
  'Low-fat Milk': 'Whole Milk', 'Rice': 'Brown Rice', 'Brown Rice': 'Rice',
  'Laundry Detergent': 'Concentrated Detergent', 'Concentrated Detergent': 'Laundry Detergent',
  'Chicken Breast': 'Pork', 'Pork': 'Chicken Breast', 'Shrimp': 'Salmon', 'Salmon': 'Shrimp',
};
const substituteFor = product => product.sourceId
  ? ([...productById.values()].find(p => p.sourceId && p.id !== product.id && p.shelfId === product.shelfId && p.stock > 0) || null)
  : products.find(p => p.name === substituteNames[product.name] && p.stock > 0) || null;

const state = {
  cart: new Map(), queue: [], completed: [], orderCounter: 0, stockoutId: '', shortage: null,
  resolutions: new Map(), assistPending: null, assistedShelves: new Set(), awaitingPickup: false,
  order: null, scenario: 'normal', slot: '09', running: false, finished: false, blocked: false,
  fault: '', stage: 0, legDistance: 0, pauseLeft: 0, slowLeft: 0, elapsed: 0, lastFrame: 0,
  bought: [], position: [...STORE.entrance], history: [[...STORE.entrance]], logs: [], detected: new Set(),
  plan: null, normalPlan: null, battery: 100, traveled: 0, events: new Set(), dynamicObstacles: [],
  closedEdges: new Set(), view: 'overview', mode: '3d', uiTick: 0,
  displayPosition: [...STORE.entrance], lateralOffset: 0, inertialVelocity: [0, 0], lastLogic: [...STORE.entrance],
  pedMode: 'shopping', pedDensity: 'low', pedSpeed: 1, pedRunning: false,
  behavior: null, pedSystem: null, robotBrain: null, safetyEvents: [], lastCollisionAt: -1,
};
const behaviorLabels = ROBOT_STATE_CN;

/* ------------------------------------------------------------------ helpers */
function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  parent?.appendChild(node); return node;
}
function clear(node) { node?.replaceChildren(); }
function pathData(points) { return points.map((p, i) => `${i ? 'L' : 'M'}${p[0] * 10},${(STORE.height - p[1]) * 10}`).join(' '); }
function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
function setWidth(id, percent) { const node = $(id); if (node) node.style.width = `${Math.max(0, Math.min(100, percent))}%`; }
function log(message, level = '') {
  state.logs.unshift({ time: state.elapsed, message, level });
  state.logs = state.logs.slice(0, 40);
  const html = state.logs.slice(0, 18).map(entry =>
    `<li class="${entry.level ? `log-${entry.level}` : ''}"><time>${clockText(entry.time)}</time><span>${escapeHtml(entry.message)}</span></li>`).join('');
  ['eventLog', 'sceneLog', 'navLogs'].forEach(id => { const node = $(id); if (node) node.innerHTML = html; });
  setText('logCount', `${state.logs.length} 条日志`);
}
function status(title, detail, motion) {
  setText('currentAction', title); setText('currentDetail', detail);
  setText('motionStatus', `状态：${stateCn(motion)}`);
}
function cartLines() { return [...state.cart].filter(([, qty]) => qty > 0).map(([id, qty]) => ({ product: productById.get(id), qty })); }
function cartWeight() { return cartLines().reduce((n, x) => n + x.product.weight * x.qty, 0); }
function cartPrice() { return cartLines().reduce((n, x) => n + x.product.price * x.qty, 0); }
function orderWeight() { return state.order?.lines.reduce((n, x) => n + x.product.weight * x.qty, 0) ?? 0; }
function pickupProfile(product) {
  const cold = product.department === 'frozen' || product.department === 'dairy eggs' || product.department === 'meat seafood'
    || ['Frozen Food', 'Dairy & Eggs', 'Seafood', 'Meat', 'Soy Products'].includes(product.category)
    || ['Seafood', 'Meat', 'Chilled Dairy'].includes(product.subcategory);
  const assist = cold || product.name === 'Beverage Pack';
  return { cold, assist, label: assist ? `员工协助取货${cold ? ' · 冷链' : ''}` : '自动取货（仿真）' };
}
function robotState() {
  const behaviourState = state.behavior?.state;
  if (behaviourState === 'EMERGENCY_STOP') return 'error';
  if (behaviourState === 'YIELD' || behaviourState === 'WAIT' || behaviourState === 'REPLANNING') return 'blocked';
  if (behaviourState === 'SLOW_DOWN' || behaviourState === 'AVOIDANCE') return 'turning';
  if (behaviourState === 'RESUME' || behaviourState === 'NORMAL_NAVIGATION') {
    if (state.fault || state.events.has('failure')) return 'error';
    if (state.blocked || state.events.has('aisle')) return 'blocked';
    if (state.shortage || state.assistPending || state.awaitingPickup || state.pauseLeft > 0) return 'picking';
    if (state.running) return 'moving';
    if (state.finished) return 'charging';
    return 'idle';
  }
  if (state.fault || state.events.has('failure')) return 'error';
  if (state.blocked || state.events.has('aisle')) return 'blocked';
  if (state.shortage || state.assistPending || state.awaitingPickup || state.pauseLeft > 0) return 'picking';
  if (state.running && state.slowLeft > 0) return 'turning';
  if (state.running) return 'moving';
  if (state.finished) return 'charging';
  return 'idle';
}
function activeOrderCount() { return (state.order ? 1 : 0) + state.queue.length; }
function alertProducts() { return [...productById.values()].filter(p => p.stock / p.capacity < .1); }

/* ----------------------------------------------------------- catalog / cart */
function changeQty(id, delta) {
  const product = productById.get(id); if (!product) return;
  const next = Math.max(0, Math.min(product.stock, (state.cart.get(id) || 0) + delta));
  if (next) state.cart.set(id, next); else state.cart.delete(id);
  renderCart(); renderRecommendations(); renderAll();
  if (state.order) setText('orderMessage', '当前为下一单的草稿购物车，已支付订单与机器人任务不受影响。');
}
function renderCatalogue() {
  $('catalogue').innerHTML = catalogResults.map(p => {
    const labels = propertyLabels(p);
    return `<article class="product-card"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(departmentLabel(p.department))} · ${escapeHtml(zoneLabel(p.category))} → ${escapeHtml(p.subcategory)} · Instacart ID ${p.sourceId}<br>货区 ${p.shelfId} · 节点 (${p.point.join(', ')}) · 仿真库存 ${p.stock}/${p.capacity}<br>估算 $${p.priceUsd?.toFixed(2) ?? '—'}（${labels.price}）；估算 ${p.weightG?.toFixed(0) ?? '—'} g（${labels.weight}）<br>训练频次 ${(p.frequency ?? 0).toLocaleString()} · 复购率 ${p.reorderRate == null ? 'n/a' : `${(p.reorderRate * 100).toFixed(1)}%`}</small></div>
      <div class="product-buy"><span>${money(p.price)} · ${kgText(p.weight)}</span><button type="button" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>${p.stock ? '加入' : '缺货'}</button></div></article>`;
  }).join('') || '<p class="empty">没有匹配的商品。请尝试英文商品名或调整筛选条件。</p>';
}
function renderCart() {
  const lines = cartLines();
  $('cartList').innerHTML = lines.length ? lines.map(({ product: p, qty }) =>
    `<div class="cart-line"><div><b>${escapeHtml(p.name)} × ${qty}</b><small>货区 ${p.shelfId} · ${money(p.price * qty)} · ${kgText(p.weight * qty)}</small></div>
     <div class="qty-controls"><button type="button" data-minus="${p.id}" aria-label="Decrease ${escapeHtml(p.name)}">−</button><button type="button" data-plus="${p.id}" aria-label="Increase ${escapeHtml(p.name)}">＋</button></div></div>`).join('')
    : '<p class="empty">购物车为空。请载入示例购物篮或搜索商品目录。</p>';
  const price = cartPrice();
  setText('cartSummary', `${lines.reduce((n, x) => n + x.qty, 0)} 件 · ${money(price)} · ${kgText(cartWeight())}`);
  setText('cartTotal', money(price));
  setText('cartCountPill', `${lines.reduce((n, x) => n + x.qty, 0)} 件`);
  const shortage = lines.some(x => x.qty > x.product.stock);
  $('submitOrderBtn').disabled = !lines.length || price < MIN_ORDER || shortage;
  setText('minimumNotice', shortage ? '请求数量超过仿真库存。请减少数量或等待补货。'
    : price < MIN_ORDER ? `距最低订单金额 ${money(MIN_ORDER)} 还差 ${money(MIN_ORDER - price)}。` : `已达到 ${money(MIN_ORDER)} 起送金额。`);
  $('minimumNotice').classList.toggle('is-error', shortage || price < MIN_ORDER);
}
function ruleMetrics(rule) { return `支持度 ${(rule.support * 100).toFixed(3)}% · 置信度 ${(rule.confidence * 100).toFixed(1)}% · 提升度 ${rule.lift.toFixed(2)}`; }
function renderRules() {
  if (!research) return;
  setText('miningMethod', `基于 ${research.rules.baskets.toLocaleString()} 个真实训练购物篮运行 Apriori；候选商品 ${research.rules.candidateProducts} 件，共 ${research.rules.ruleCount.toLocaleString()} 条规则（最小共购计数 ${research.rules.minSupportCount}）。共购不等于因果。`);
  $('ruleTable').innerHTML = rules.filter(r => r.confidence >= .15).slice(0, 5).map(r =>
    `<div class="rule-row"><b>${escapeHtml(productById.get(r.from)?.name ?? r.from)} → ${escapeHtml(productById.get(r.to)?.name ?? r.to)}</b><small>${ruleMetrics(r)}</small></div>`).join('')
    || '<p class="empty">当前置信度阈值下没有符合条件的规则。</p>';
  const seen = new Set();
  const suggestions = rules.filter(r => {
    const pair = [r.from, r.to].sort().join('|');
    if (r.lift <= 1 || r.confidence < .15 || seen.has(pair) || !productById.get(r.from) || !productById.get(r.to)) return false;
    seen.add(pair); return true;
  }).slice(0, 5).map(r => `<li>${escapeHtml(productById.get(r.from).name)} + ${escapeHtml(productById.get(r.to).name)} — 建议相邻陈列；冷链、食品与日化分区及通道宽度仍需人工复核。</li>`);
  $('shelfSuggestions').innerHTML = `<p class="assumption">共购关系来自真实购物篮；陈列建议需人工复核。</p><ul>${suggestions.join('') || '<li>当前候选集中没有符合条件的规则。</li>'}</ul>`;
}
function renderRecommendations() {
  const ids = new Set(cartLines().map(x => x.product.id));
  const found = rules.filter(r => ids.has(r.from) && !ids.has(r.to) && r.confidence >= .1 && productById.get(r.to)).slice(0, 3);
  $('recommendations').innerHTML = found.length ? found.map(r =>
    `<div class="recommend-item"><div><b>${escapeHtml(productById.get(r.to).name)}</b><small>与 ${escapeHtml(productById.get(r.from).name)} 共同购买 · ${ruleMetrics(r)}</small></div><button type="button" data-add="${r.to}">Add</button></div>`).join('')
    : '<p class="empty">加入一件高频商品，即可查看基于真实购物篮的推荐。</p>';
}
function renderCrowd() {
  const sample = crowdSamples[state.slot], total = sample.reduce((a, b) => a + b, 0);
  setText('crowdSummary', `${timeSlots.find(x => x.id === state.slot).label}：18 个区域附近共 ${total} 名仿真顾客。0–2 人为低，3–4 人为中，5 人及以上为拥堵。`);
  $('crowdTable').innerHTML = shelves.map((s, i) =>
    `<div class="crowd-cell ${sample[i] >= 5 ? 'kpi--danger' : sample[i] >= 3 ? 'kpi--warn' : ''} kpi" style="padding:9px"><div class="kpi-label">${s.id} · ${sample[i]} 人</div><div style="font-size:10px;font-weight:700;margin-top:3px">${escapeHtml(zoneLabel(s.category))}</div></div>`).join('');
  scene3d?.setScenario(state.scenario, state.slot);
}

/* ------------------------------------------------------------ inventory */
function renderInventory() {
  const alerts = alertProducts();
  $('inventoryAlerts').innerHTML = alerts.length ? alerts.map(p =>
    `<div class="alert-item ${p.stock === 0 ? 'is-out' : ''}"><div><b>${escapeHtml(p.name)}</b><p>${p.stock}/${p.capacity} 件 · ${p.stock ? '库存偏低' : '已缺货'} · 仿真库存 · 货区 ${p.shelfId}</p></div><button class="btn btn-secondary btn-sm" type="button" data-restock="${p.id}">确认补货</button></div>`).join('')
    : '<p class="empty">没有商品低于 10% 的仿真容量。</p>';
  $('inventoryTable').innerHTML = [...productById.values()].slice(0, 90).map(p => {
    const pct = p.stock / p.capacity;
    return `<tr><td><b>${escapeHtml(p.name)}</b></td><td>${escapeHtml(p.category)} · ${p.shelfId}</td><td class="right num">${p.stock}/${p.capacity}</td><td><span class="pill ${pct === 0 ? 'pill--danger' : pct < .1 ? 'pill--warn' : 'pill--ok'}">${pct === 0 ? '缺货' : pct < .1 ? '偏低' : '正常'}</span></td></tr>`;
  }).join('');
  setText('invSkus', productById.size.toLocaleString());
  setText('invLow', alerts.filter(p => p.stock > 0).length);
  setText('invOut', alerts.filter(p => p.stock === 0).length);
  setText('invRestocks', restocks);
  renderCatalogue(); renderCart();
}
function restock(id) {
  const product = productById.get(id); if (!product) return;
  product.stock = product.capacity; restocks++;
  log(`${product.name} 已由员工补货至 ${product.capacity} 件（仿真）。`);
  renderInventory(); renderLiveOps();
}

/* ------------------------------------------------- navigation graph / A* */
function edgeKey(a, b) { const ka = key(a), kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; }
const nodes = buildNavNodes();
function edgeCost(a, b, scenario, slot, mode = 'full') {
  const length = dist(a, b), center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const nearby = shelves.filter(s => dist(s.point, center) < 20).map(s => shelfCrowd(slot, s.id));
  const crowd = nearby.length ? nearby.reduce((n, x) => n + x, 0) / nearby.length : 0;
  const hot = scenario === 'peak' && a[1] === 34 && b[1] === 34 && Math.min(a[0], b[0]) >= 40 && Math.max(a[0], b[0]) <= 80;
  const congestion = state.events.has('congestion') && crowd >= 4 ? 1.4 : 1;
  const predictedTime = length * (1 + .025 * crowd * congestion + (hot ? 2.6 : 0));
  const risk = length * (.025 * crowd * congestion + (hot ? 2.8 : 0));
  const cost = mode === 'distance' ? length : mode === 'time' ? length + .45 * predictedTime : length + .45 * predictedTime + 1.3 * risk;
  return { length, predictedTime, risk, cost };
}
function astar(start, finish, scenario, slot, mode = 'full') {
  if (!nodes.has(key(start)) || !nodes.has(key(finish))) return null;
  const open = new Set([key(start)]), came = new Map(), g = new Map([[key(start), 0]]), f = new Map([[key(start), dist(start, finish)]]);
  while (open.size) {
    let current = [...open].reduce((a, b) => (f.get(a) ?? Infinity) <= (f.get(b) ?? Infinity) ? a : b);
    if (current === key(finish)) {
      const points = [nodes.get(current).point];
      while (came.has(current)) { current = came.get(current); points.unshift(nodes.get(current).point); }
      return points;
    }
    open.delete(current);
    const currentPoint = nodes.get(current).point;
    for (const neighbor of nodes.get(current).neighbors) {
      if (state.closedEdges.has(edgeKey(currentPoint, nodes.get(neighbor).point))) continue;
      const score = g.get(current) + edgeCost(currentPoint, nodes.get(neighbor).point, scenario, slot, mode).cost;
      if (score < (g.get(neighbor) ?? Infinity)) {
        came.set(neighbor, current); g.set(neighbor, score);
        f.set(neighbor, score + dist(nodes.get(neighbor).point, finish)); open.add(neighbor);
      }
    }
  }
  return null;
}
function avoidPeople(points, scenario, slot) {
  const obstacles = [...getObstacleSnapshot(scenario, slot).map(o => o.point), ...state.dynamicObstacles.map(o => o.point)];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = dist(a, b);
    const horizontal = a[1] === b[1], direction = Math.sign(horizontal ? b[0] - a[0] : b[1] - a[1]);
    const near = obstacles.map(p => ({ along: (horizontal ? p[0] - a[0] : p[1] - a[1]) * direction, side: horizontal ? p[1] - a[1] : p[0] - a[0] }))
      .filter(p => p.along > 3 && p.along < length - 3 && Math.abs(p.side) < 2.3)
      .sort((x, y) => x.along - y.along);
    let last = 0;
    for (const p of near) {
      if (p.along - 2.8 < last) continue;
      const side = p.side >= 0 ? -2 : 2;
      const pt = (d, s) => horizontal ? [a[0] + direction * d, a[1] + s] : [a[0] + s, a[1] + direction * d];
      out.push(pt(p.along - 2.8, 0), pt(p.along - 1.4, side), pt(p.along + 1.4, side), pt(p.along + 2.8, 0));
      last = p.along + 2.8;
    }
    out.push(b);
  }
  return out;
}
function planLeg(a, b, scenario, slot, mode = 'full') {
  const base = astar(a, b, scenario, slot, mode); if (!base) return null;
  const points = avoidPeople(base, scenario, slot);
  const lengths = points.slice(1).map((p, i) => dist(points[i], p));
  let cost = 0, time = 0, risk = 0;
  for (let i = 1; i < base.length; i++) {
    const c = edgeCost(base[i - 1], base[i], scenario, slot, mode);
    cost += c.cost; time += c.predictedTime; risk += c.risk;
  }
  return { points, lengths, length: lengths.reduce((a, b) => a + b, 0), cost, time, risk };
}
function uniqueStops(lines) {
  const map = new Map();
  for (const line of lines) {
    const stop = map.get(line.product.shelfId) || { shelfId: line.product.shelfId, point: line.product.point, lines: [] };
    stop.lines.push(line); map.set(stop.shelfId, stop);
  }
  return [...map.values()];
}
function buildPlan(lines, scenario, slot, mode = 'full') {
  const stops = uniqueStops(lines), n = stops.length, cache = new Map();
  const leg = (a, b) => { const k = `${key(a)}>${key(b)}`; if (!cache.has(k)) cache.set(k, planLeg(a, b, scenario, slot, mode)); return cache.get(k); };
  const finish = leg(STORE.checkout, STORE.exit); if (!finish) return null;
  const start = stops.map(s => leg(STORE.entrance, s.point));
  const checkout = stops.map(s => leg(s.point, STORE.checkout));
  const between = stops.map((a, i) => stops.map((b, j) => i === j ? null : leg(a.point, b.point)));
  const order = []; let bestCost = Infinity;
  let method = 'Held–Karp 精确访问顺序';
  if (n > 12) {
    method = '最近代价启发式（不保证全局最优）';
    const remaining = new Set(stops.map((_, i) => i)); let previous = -1;
    while (remaining.size) {
      let choice = -1, best = Infinity;
      for (const j of remaining) {
        const candidate = previous < 0 ? start[j] : between[previous][j];
        if (candidate && candidate.cost < best) { best = candidate.cost; choice = j; }
      }
      if (choice < 0) return null;
      order.push(choice); remaining.delete(choice); previous = choice;
    }
    bestCost = start[order[0]].cost + order.slice(1).reduce((sum, j, i) => sum + between[order[i]][j].cost, 0) + checkout[order.at(-1)].cost + finish.cost;
  } else {
    const states = 1 << n, all = states - 1, costs = new Float64Array(states * n), previous = new Int8Array(states * n);
    costs.fill(Infinity); previous.fill(-1);
    for (let j = 0; j < n; j++) if (start[j]) costs[(1 << j) * n + j] = start[j].cost;
    for (let mask = 1; mask < states; mask++) for (let bits = mask; bits; bits &= bits - 1) {
      const j = 31 - Math.clz32(bits & -bits), current = costs[mask * n + j];
      if (!Number.isFinite(current)) continue;
      for (let rest = all ^ mask; rest; rest &= rest - 1) {
        const k = 31 - Math.clz32(rest & -rest), step = between[j][k]; if (!step) continue;
        const index = ((mask | (1 << k)) * n + k), next = current + step.cost;
        if (next < costs[index]) { costs[index] = next; previous[index] = j; }
      }
    }
    let last = -1;
    for (let j = 0; j < n; j++) if (checkout[j]) {
      const total = costs[all * n + j] + checkout[j].cost + finish.cost;
      if (Number.isFinite(total) && total < bestCost) { bestCost = total; last = j; }
    }
    if (last < 0) return null;
    let mask = all;
    while (last >= 0) { order.unshift(last); const parent = previous[mask * n + last]; mask ^= 1 << last; last = parent; }
  }
  const legs = [start[order[0]], ...order.slice(1).map((j, i) => between[order[i]][j]), checkout[order.at(-1)], finish];
  const plan = { stops: order.map(i => stops[i]), legs, cost: bestCost, method };
  plan.points = legs.flatMap((leg, i) => i ? leg.points.slice(1) : leg.points);
  plan.length = legs.reduce((sum, leg) => sum + leg.length, 0);
  plan.time = legs.reduce((sum, leg) => sum + leg.time, 0) + n * 3 + 5;
  plan.risk = legs.reduce((sum, leg) => sum + leg.risk, 0);
  return plan;
}
function nearestNode(point) {
  return [...nodes.values()].map(n => n.point).reduce((best, p) => dist(p, point) < dist(best, point) ? p : best);
}
function replanCurrentLeg(reason) {
  if (!state.plan || state.stage > state.plan.stops.length) return false;
  const leg = state.plan.legs[state.stage]; if (!leg) return false;
  const target = leg.points.at(-1);
  const from = nearestNode(state.position);
  const fresh = planLeg(from, target, state.scenario, state.slot);
  if (!fresh) { state.running = false; status('无安全路径', '通道封闭导致当前目标不可达，机器人已安全停车。', 'SAFE STOP'); log(`${reason}：没有可行的替代路径，机器人已停车。`, 'danger'); return false; }
  leg.points = [state.position, ...fresh.points.slice(1)];
  leg.lengths = leg.points.slice(1).map((p, i) => dist(leg.points[i], p));
  leg.length = fresh.length; state.legDistance = 0;
  drawRoutes(); log(`${reason}：A* 已重新规划当前路段（${fresh.length.toFixed(1)} 地图单位）。`, 'warn');
  return true;
}

/* ------------------------------------------------------------- 2D map draw */
function drawBaseMap() {
  clear($('aisles')); clear($('fixtures')); clear($('shelves'));
  for (const x of STORE.aisleXs) svg('line', { x1: x * 10, y1: 820, x2: x * 10, y2: 80, class: 'aisle-line' }, $('aisles'));
  for (const y of STORE.crossYs) svg('line', { x1: 50, y1: (90 - y) * 10, x2: 1380, y2: (90 - y) * 10, class: 'aisle-line' }, $('aisles'));
  for (const f of layoutFixtures) {
    svg('rect', { x: (f.x - f.w / 2) * 10, y: (STORE.height - f.y - f.h / 2) * 10, width: f.w * 10, height: f.h * 10, rx: 6, class: `fixture-${f.kind}` }, $('fixtures'));
    svg('text', { x: f.x * 10, y: (STORE.height - f.y) * 10 + 4, class: 'fixture-label' }, $('fixtures')).textContent = f.label;
  }
  for (const s of shelves) {
    const left = s.xMin * 10, top = (90 - s.yMax) * 10, width = (s.xMax - s.xMin) * 10, height = (s.yMax - s.yMin) * 10;
    svg('rect', { x: left, y: top, width, height, rx: 5, class: `shelf-rect ${s.kind}` }, $('shelves'));
    svg('text', { x: left + width / 2, y: top + height / 2 - 5, class: 'shelf-caption' }, $('shelves')).textContent = zoneLabel(s.category);
    svg('text', { x: left + width / 2, y: top + height / 2 + 13, class: 'shelf-code' }, $('shelves')).textContent = `货区 ${s.id}`;
  }
}
function drawFixtures() { /* included in drawBaseMap */ }
function drawGate(point, label) {
  svg('rect', { x: point[0] * 10 - 27, y: (90 - point[1]) * 10 - 13, width: 54, height: 26, rx: 7, class: 'gate' }, $('destinations'));
  svg('text', { x: point[0] * 10, y: (90 - point[1]) * 10 + 4, class: 'gate-label' }, $('destinations')).textContent = label;
}
function drawDestinations() {
  clear($('destinations'));
  const stops = state.plan?.stops || [];
  stops.forEach((stop, i) => {
    svg('circle', { cx: stop.point[0] * 10, cy: (90 - stop.point[1]) * 10, r: 14, class: `destination-circle ${i < state.stage ? 'destination-done' : ''}` }, $('destinations'));
    svg('text', { x: stop.point[0] * 10, y: (90 - stop.point[1]) * 10 + 4, class: 'destination-label' }, $('destinations')).textContent = i < state.stage ? '✓' : String(i + 1);
  });
  drawGate(STORE.entrance, '入口'); drawGate(STORE.checkout, '结账'); drawGate(STORE.exit, '出口');
  scene3d?.setPickups(stops.map(s => s.point), Math.min(state.stage, stops.length));
}
function drawCrowd() {
  clear($('crowd'));
  const counts = crowdSamples[state.slot];
  shelves.forEach((s, i) => {
    svg('rect', { x: s.xMin * 10, y: (90 - s.yMax) * 10, width: (s.xMax - s.xMin) * 10, height: (s.yMax - s.yMin) * 10,
      fill: counts[i] >= 5 ? '#e2734b' : counts[i] >= 3 ? '#e8a34a' : '#71b887', opacity: counts[i] >= 5 ? .32 : .17, rx: 5 }, $('crowd'));
  });
  const crowd = state.pedSystem ? state.pedSystem.snapshot() : [];
  const shown = crowd.length ? crowd : [...peopleForScenario(state.scenario, state.slot), ...state.dynamicObstacles];
  for (const p of shown) {
    const point = p.point || [p.x, p.y];
    svg('circle', { cx: point[0] * 10, cy: (90 - point[1]) * 10, r: 12, class: 'crowd-halo' }, $('crowd'));
    svg('circle', { cx: point[0] * 10, cy: (90 - point[1]) * 10, r: 6, class: 'crowd-person' }, $('crowd'));
  }
  scene3d?.setScenario(state.scenario, state.slot);
  scene3d?.setPedestrians(crowd);
}
function drawRoutes() {
  clear($('comparisonRoute')); clear($('plannedRoute'));
  if (state.plan) {
    if (state.scenario === 'peak' && state.normalPlan) svg('path', { d: pathData(state.normalPlan.points), class: 'comparison-path' }, $('comparisonRoute'));
    svg('path', { d: pathData(state.plan.points), class: 'planned-path' }, $('plannedRoute'));
  }
  for (const stored of state.closedEdges) {
    const [a, b] = stored.split('|').map(s => s.split(',').map(Number));
    svg('line', { x1: a[0] * 10, y1: (90 - a[1]) * 10, x2: b[0] * 10, y2: (90 - b[1]) * 10, class: 'restricted-path' }, $('comparisonRoute'));
  }
  scene3d?.setRoutes(state.plan?.points || [], state.scenario === 'peak' ? state.normalPlan?.points : null);
  scene3d?.setRestricted([...state.closedEdges].map(stored => stored.split('|').map(s => s.split(',').map(Number))));
  drawHistory();
}
function drawHistory() {
  clear($('traveledRoute'));
  if (state.history.length > 1) svg('path', { d: pathData(state.history), class: 'traveled-path' }, $('traveledRoute'));
  scene3d?.setHistory(state.history);
}
function drawRobot() {
  clear($('robotLayer'));
  const [x, y] = state.displayPosition;
  svg('circle', { cx: x * 10, cy: (90 - y) * 10, r: (PHYSICS.robot.radius / PHYSICS.metersPerUnit) * 10, class: 'robot-body' }, $('robotLayer'));
  scene3d?.setRobot(state.displayPosition, robotState(), state.traveled / PHYSICS.metersPerUnit);
  const behaviour = state.behavior;
  scene3d?.setSafety(behaviour || {});
}

/* --------------------------------------------------------- view rendering */
function renderLiveOps() {
  const alerts = alertProducts();
  const robotLabels = { idle: '待机', moving: '行驶中', turning: '转向避障', picking: '取货中', blocked: '安全停车', charging: '充电中', error: '故障' };
  const robotLabel = robotLabels[robotState()];
  setText('opsRobot', robotLabel);
  setText('opsOrders', activeOrderCount());
  setText('opsStock', alerts.length);
  setText('opsDone', state.completed.filter(c => c.status === 'Completed').length);
  $('opsStock').className = alerts.length > 2 ? 'is-warn' : alerts.length ? '' : 'is-ok';
  $('opsRobot').className = robotLabel === '故障' || robotLabel === '安全停车' ? 'is-danger' : robotLabel === '待机' ? '' : 'is-ok';
  setText('kpiOrders', activeOrderCount());
  setText('kpiCompleted', state.completed.filter(c => c.status === 'Completed').length);
  setText('kpiStock', alerts.length);
  setText('kpiDistance', state.plan ? state.plan.length.toFixed(1) : '—');
  $('systemPill').textContent = state.fault ? '故障 · 安全停车' : state.blocked ? '通道已封闭' : '仿真就绪';
  $('systemPill').className = `pill ${state.fault || state.blocked ? 'pill--danger' : 'pill--ok'}`;
  $('systemStatusTable').innerHTML = [
    ['机器人', `AMR-01 · ${robotLabel}`, robotLabel === '故障' ? 'pill--danger' : 'pill--ok'],
    ['导航图', `${nodes.size} 个节点 · ${state.closedEdges.size} 条受限边`, state.closedEdges.size ? 'pill--warn' : 'pill--ok'],
    ['客流场景', `${state.scenario === 'peak' ? '工作日高峰' : '平常客流'} · ${timeSlots.find(t => t.id === state.slot).label}`, 'pill--info'],
    ['订单队列', `${state.queue.length} 单等待 · ${state.order ? 1 : 0} 单执行中`, state.queue.length ? 'pill--warn' : 'pill--ok'],
    ['电量（仿真）', `${state.battery.toFixed(0)}%`, state.battery < 20 ? 'pill--danger' : 'pill--ok'],
  ].map(([label, value, cls]) => `<tr><td>${label}</td><td style="text-align:right"><span class="pill ${cls}">${escapeHtml(value)}</span></td></tr>`).join('');
  const preview = [
    ['1 · 支付', state.order ? `${state.order.id} 已受理` : '等待顾客下单'],
    ['2 · 排序', state.plan ? state.plan.method : '等待订单商品'],
    ['3 · 导航', `已访问 ${state.stage} / ${state.plan?.stops.length ?? 0} 个货区`],
    ['4 · 结账与交接', state.awaitingPickup ? '在出口等待交接' : '待处理'],
  ];
  $('livePreviewList').innerHTML = preview.map(([label, value], i) =>
    `<li><span>${label}<small>${escapeHtml(value)}</small></span><span class="pill ${i < state.stage ? 'pill--ok' : 'pill--info'}">${i < state.stage ? '已完成' : '待处理'}</span></li>`).join('');
}
function renderOverviewPreview() {
  $('previewZones').innerHTML = shelves.map(s => {
    const x = s.xMin * 4.6 + 8, y = s.yMin * 4.1 + 8;
    const color = s.kind === 'cooler' ? '#3D7BD6' : s.kind === 'produce' ? '#20A995' : s.kind === 'promo' ? '#E8A34A' : '#84919B';
    return `<rect x="${x}" y="${y}" width="${(s.xMax - s.xMin) * 4.6}" height="${(s.yMax - s.yMin) * 4.1}" rx="3" fill="${color}" opacity=".28" stroke="${color}" stroke-width="1"/>`;
  }).join('');
  $('previewRoute').innerHTML = state.plan ? `<path d="${state.plan.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] * 4.6 + 8},${p[1] * 4.1 + 8}`).join(' ')}" fill="none" stroke="#20A995" stroke-width="2.4" stroke-dasharray="6 4"/>` : '';
}
function renderQueue() {
  const entries = [
    ...(state.order ? [{ order: state.order, label: state.awaitingPickup ? '等待交接' : state.running ? '执行中' : state.shortage ? '等待缺货决策' : '已分配 · 待出发' }] : []),
    ...state.queue.map((order, i) => ({ order, label: `排队第 ${i + 1} 单` })),
  ];
  $('orderQueue').innerHTML = entries.length ? entries.map(({ order, label }) =>
    `<div class="queue-item"><b>${escapeHtml(order.id)}</b><span>${order.lines.reduce((n, x) => n + x.qty, 0)} 件 · ${money(order.paid)}</span>
     <span class="pill ${label === '执行中' ? 'pill--ok' : 'pill--info'}">${label}</span>
     ${order === state.order && state.stage === 0 && !state.running && !state.elapsed ? '<button type="button" data-cancel-active="1">取消当前订单</button>' : order !== state.order ? `<button type="button" data-cancel="${escapeHtml(order.id)}">取消排队</button>` : ''}</div>`).join('')
    : '<p class="empty">队列中没有订单。</p>';
  const rows = [...(state.order ? [state.order] : []), ...state.queue, ...state.completed.slice(-3)];
  $('fulfillmentTable').innerHTML = rows.length ? rows.map(order => {
    const statusText = order.status || (order === state.order ? state.awaitingPickup ? '等待交接' : state.running ? '履约中' : '待出发' : '排队中');
    return `<tr><td class="mono">${escapeHtml(order.id)}</td><td>${order.lines?.reduce((n, x) => n + x.qty, 0) ?? '—'}</td><td>${order.paid ? money(order.paid) : '—'}</td><td>AMR-01</td><td><span class="pill ${statusText === 'Completed' || statusText === '已完成' ? 'pill--ok' : 'pill--info'}">${escapeHtml(statusText === 'Completed' ? '已完成' : statusText === 'Cancelled' ? '已取消' : statusText)}</span></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">暂无订单。</td></tr>';
}
function renderStockout() {
  const select = $('stockoutSelect'), previous = state.stockoutId;
  select.innerHTML = '<option value="">不模拟缺货</option>' + (state.order?.lines || []).map(x =>
    `<option value="${x.product.id}">${escapeHtml(x.product.name)} · 货区 ${x.product.shelfId}</option>`).join('');
  select.value = previous && state.order?.lines.some(x => x.product.id === previous) ? previous : '';
  select.disabled = !state.order || state.running || state.stage > 0 || state.awaitingPickup || !!state.shortage;
  $('stockoutPanel').hidden = !state.shortage;
  $('assistPanel').hidden = !state.assistPending;
  $('handoffPanel').hidden = !state.awaitingPickup;
  if (state.shortage) {
    const { line, alternative } = state.shortage;
    setText('stockoutDetail', `${line.product.name} × ${line.qty} 在货区 ${line.product.shelfId} 缺货。${alternative ? `${alternative.name} × ${line.qty}（${money(alternative.price * line.qty)}，${kgText(alternative.weight * line.qty)}）需要顾客确认。` : '没有预设替代品，可跳过该商品。'}仅展示差价，不执行真实扣款。`);
    $('acceptSubBtn').disabled = !alternative;
  }
  if (state.assistPending) setText('assistDetail', `货区 ${state.assistPending.stop.shelfId}：${state.assistPending.names.join('、')} 需要员工核对。网页演示没有机械臂、扫码枪或冷链设备。`);
  if (state.awaitingPickup) setText('handoffDetail', `订单 ${state.order.id}（取货码 ${state.order.id.slice(-4)}）已到出口。请核对 ${state.bought.reduce((n, x) => n + x.qty, 0)} 件已取商品，最终模拟金额 ${money(actualPrice())}。`);
}
function renderOrderState() {
  setText('orderListHeading', state.order ? `${state.order.id} · ${state.order.lines.reduce((n, x) => n + x.qty, 0)} 件` : '等待订单');
  // The sidebar heading was replaced by the control panel; keep legacy node if present.
  const legacy = $('orderListHeading'); if (legacy) legacy.textContent = state.order ? `${state.order.id} · ${state.order.lines.reduce((n, x) => n + x.qty, 0)} 件` : '等待订单';
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  setText('loadText', `${kgText(loaded)} / ${kgText(CAPACITY)}`); setWidth('loadFill', loaded / CAPACITY * 100);
  setText('loadText2', `${kgText(loaded)} / ${kgText(CAPACITY)}`); setWidth('loadFill2', loaded / CAPACITY * 100);
  renderQueue(); renderStockout();
}
function renderProgress() {
  const done = state.plan?.legs.slice(0, state.stage).reduce((n, leg) => n + leg.length, 0) || 0;
  const percent = state.awaitingPickup ? 100 : state.plan ? Math.min(100, Math.round((done + state.legDistance) / state.plan.length * 100)) : 0;
  setWidth('progressFill', percent); setText('progressPercent', `${percent}%`);
  setText('progressText', state.awaitingPickup ? '等待出口交接' : state.shortage ? '等待缺货决策' : state.running ? `前往${nextName()}` : state.order ? '就绪 / 已暂停' : '等待已支付订单');
  setText('nextTarget', nextName());
  setText('fulfillPct', `${percent}%`); setWidth('fulfillFill', percent);
}
function nextName() {
  if (state.awaitingPickup) return '出口交接';
  if (!state.plan) return '—';
  if (state.stage < state.plan.stops.length) return `货区 ${state.plan.stops[state.stage].shelfId} · ${state.plan.stops[state.stage].lines.map(x => x.product.name).join('、')}`;
  return state.stage === state.plan.stops.length ? '收银台' : '出口';
}
function renderTimeline() {
  const steps = ['读取已支付订单', '载重检查 · 进入门店', 'Held–Karp + A* 规划',
    ...(state.plan?.stops || []).map(s => `取货：货区 ${s.shelfId}`), '结账核对', '经出口离店', '顾客交接'];
  const active = Math.min(3 + state.stage, steps.length - 1);
  $('timeline').innerHTML = steps.map((step, i) => `<li class="${!state.order ? '' : i < active ? 'is-done' : i === active ? 'is-active' : ''}">${step}</li>`).join('');
}
function renderRobotCenter() {
  const labels = { idle: '待机', moving: '行驶中', turning: '转向避障', picking: '取货中', blocked: '安全停车', charging: '充电中', error: '故障' };
  const label = labels[robotState()];
  setText('robotStatusText', `${label} · 电量 ${state.battery.toFixed(0)}% · AMR-01`);
  setText('robotTaskText', state.fault ? faultAdvice[state.fault] : state.order ? `前往${nextName()} — ${state.running ? '机器人正沿 A* 路径行驶' : '仿真已暂停'}。` : '当前无任务。请在订单管理中提交订单，然后在 3D 超市页面点击播放。');
  setText('robotModeText', `模式：${state.scenario === 'peak' ? '高峰客流' : '平常客流'}`);
  setText('robotStateBadge', `状态：${label}`);
  setText('robotDestination', nextName());
  setText('robotBattery2', `${state.battery.toFixed(0)}%`); setText('batteryText2', `${state.battery.toFixed(0)}%`);
  setWidth('batteryFill2', state.battery);
  setText('robotLoad2', kgText(state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0)));
  setText('robotDistance2', state.traveled.toFixed(1));
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  $('robotTelemetryTable').innerHTML = [
    ['当前位置 (x, y)', state.position.map(n => n.toFixed(1)).join(', ')],
    ['图节点数', `${nodes.size}`],
    ['生效的受限边', `${state.closedEdges.size}`],
    ['动态障碍物', `${state.dynamicObstacles.length}`],
    ['仿真已用时', `${state.elapsed.toFixed(1)} 秒`],
    ['规划总代价', state.plan ? state.plan.cost.toFixed(1) : '—'],
    ['规划风险值', state.plan ? state.plan.risk.toFixed(1) : '—'],
    ['载重 / 容量', `${kgText(loaded)} / ${kgText(CAPACITY)}`],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="right mono">${escapeHtml(v)}</td></tr>`).join('');
  setText('destinationText', nextName());
  setText('navDistance', state.plan ? `${state.plan.length.toFixed(1)} 地图单位` : '—');
  setText('navElapsed', `${state.elapsed.toFixed(1)} 秒`);
  setText('navStops', `${Math.min(state.stage, state.plan?.stops.length ?? 0)} / ${state.plan?.stops.length ?? 0}`);
  setText('faultState', state.fault ? faultAdvice[state.fault] : '当前无故障。');
  $('suddenPersonFix')?.removeAttribute('hidden');
  $('injectFaultBtn').setAttribute('aria-pressed', String(!!state.fault));
  setText('pickupCode', state.order ? state.order.id.slice(-4) : '—');
}
function renderRouteView() {
  setText('heldKarpMethod', state.plan ? `${state.plan.method} · ${state.plan.stops.length} 个不同货区` : '等待订单。');
  const stops = state.plan?.stops || [];
  $('heldKarpFlow').innerHTML = stops.length ? [STORE.entrance, ...stops.map(s => s.point), STORE.checkout, STORE.exit]
    .map((p, i, arr) => `${i ? '<span class="route-arrow">→</span>' : ''}<span class="route-node ${i <= state.stage ? 'route-node--done' : ''}">${i === 0 ? '入口' : i === arr.length - 1 ? '出口' : i === arr.length - 2 ? '结账' : `货区${stops[i - 1].shelfId}`}</span>`).join('')
    : '<span class="muted">提交订单后计算精确访问顺序。</span>';
  $('heldKarpTable').innerHTML = stops.length ? stops.map((s, i) =>
    `<tr><td>${i + 1}</td><td><b>${escapeHtml(s.category || shelves.find(x => x.id === s.shelfId)?.category || s.shelfId)}</b></td><td class="mono">${s.point.join(', ')}</td><td>${s.lines.map(x => escapeHtml(x.product.name)).join(', ')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">尚无路径规划。</td></tr>';
  $('astarTable').innerHTML = state.plan ? state.plan.legs.map((leg, i) =>
    `<tr><td>${i === 0 ? '入口 → 货区1' : i < stops.length ? `货区${stops[i - 1].shelfId} → 货区${stops[i].shelfId}` : i === stops.length ? `货区${stops.at(-1).shelfId} → 收银台` : '收银台 → 出口'}</td><td class="right num">${leg.length.toFixed(1)}</td><td class="right num">${leg.time.toFixed(1)}</td><td class="right num">${leg.risk.toFixed(1)}</td><td class="right num">${leg.cost.toFixed(1)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">尚无路径规划。</td></tr>';
  if (!state.order) {
    $('comparisonBody').innerHTML = '<tr><td colspan="3" class="muted">提交订单后可对比方案。</td></tr>';
    setText('comparisonInsight', '两种方案均使用同一订单、同一时段与同一代价函数计算。');
    setText('routeCompareNote', '原方案 = 同一订单在平常客流下的基线结果。');
    return;
  }
  const a = scoreExistingRoute(state.normalPlan, state.scenario, state.slot), b = state.plan;
  const changed = a.points.map(key).join('|') !== b.points.map(key).join('|');
  setText('routeCompareNote', `${b.method} · 访问顺序：入口 → ${b.stops.map(s => `货区${s.shelfId}`).join(' → ')} → 收银台 → 出口。`);
  const rows = [
    ['路径长度', `${a.length.toFixed(1)} 地图单位`, `${b.length.toFixed(1)} 地图单位`],
    ['预计用时（仿真）', `${a.time.toFixed(1)} s`, `${b.time.toFixed(1)} s`],
    ['风险值', a.risk.toFixed(1), b.risk.toFixed(1)],
    ['总代价', a.cost.toFixed(1), b.cost.toFixed(1)],
    ['重新规划次数', '0', changed ? '1' : '0'],
  ];
  $('comparisonBody').innerHTML = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  setText('comparisonInsight', `同一订单、同一${timeSlots.find(t => t.id === state.slot).label}样本。代价 = 距离 + 0.45 × 时间 + 1.3 × 风险；所有时间值均为仿真假设。`);
}
function scoreExistingRoute(plan, scenario, slot) {
  if (!plan) return { cost: 0, time: 0, risk: 0, length: 0, points: [] };
  let cost = 0, time = 0, risk = 0;
  for (const leg of plan.legs) {
    const graphPoints = leg.points.filter(point => nodes.has(key(point)));
    for (let i = 1; i < graphPoints.length; i++) {
      const c = edgeCost(graphPoints[i - 1], graphPoints[i], scenario, slot);
      cost += c.cost; time += c.predictedTime; risk += c.risk;
    }
  }
  return { ...plan, cost, time: time + plan.stops.length * 3 + 5, risk };
}
function renderSimulationView() {
  const conditions = [
    ['行人横穿', state.events.has('pedestrian')],
    ['购物车阻挡', state.events.has('cart')],
    ['中央通道封闭', state.closedEdges.size > 0],
    ['超载测试', orderWeight() > CAPACITY || state.events.has('overload')],
    ['货架拥堵 / 高峰', state.scenario === 'peak' || state.events.has('congestion')],
    ['导航故障', !!state.fault || state.events.has('failure')],
  ];
  $('activeEvents').innerHTML = conditions.map(([label, active]) =>
    `<li><span>${label}</span><span class="pill ${active ? 'pill--warn' : 'pill--ok'}">${active ? '生效' : '未生效'}</span></li>`).join('')
    + '<li><span>仿真数据来源</span><span class="pill pill--info">规则驱动</span></li>';
  document.querySelectorAll('[data-event]').forEach(button => {
    const type = button.dataset.event;
    const active = type === 'aisle' ? state.closedEdges.size > 0 : type === 'overload' ? state.events.has('overload')
      : type === 'congestion' ? state.events.has('congestion') : type === 'failure' ? !!state.fault
        : state.dynamicObstacles.some(o => o.type === (type === 'pedestrian' ? 'person' : 'cart'));
    button.classList.toggle('is-active', active);
  });
  document.querySelectorAll('[data-sim-card]').forEach(card => card.classList.toggle('is-active',
    card.dataset.simCard === 'aisle' ? state.closedEdges.size > 0 : state.events.has(card.dataset.simCard)));
}
function renderPedestrianPanel() {
  const brain = state.robotBrain, ped = state.pedSystem;
  if (!brain || !ped) return;
  const result = state.behavior || { state: 'NORMAL_NAVIGATION', speedFactor: 1, ttc: Infinity, distance: Infinity, safetyStatus: '安全', targetSpeed: 0 };
  const badge = $('pedBehaviorState');
  if (badge) {
    badge.textContent = `${result.state} · ${behaviorLabels[result.state] || ''}`;
    badge.classList.toggle('is-warn', ['SLOW_DOWN', 'YIELD', 'WAIT', 'AVOIDANCE', 'REPLANNING'].includes(result.state));
    badge.classList.toggle('is-danger', result.state === 'EMERGENCY_STOP');
  }
  setText('pedSafetyStatus', result.safetyStatus || '安全');
  setText('pedSpeed', `${(result.targetSpeed || 0).toFixed(2)} m/s`);
  setText('pedDistance', Number.isFinite(result.distance) ? `${result.distance.toFixed(2)} m` : '—');
  setText('pedTtc', Number.isFinite(result.ttc) ? `${result.ttc.toFixed(2)} s` : '—');
  setText('pedDestination', nextName());
  const m = brain.metrics, pm = ped.metrics;
  const counters = $('pedCounters');
  if (counters) counters.innerHTML = [
    ['行人数量', ped.people.length], ['活动路线', new Set(ped.people.map(p => p.state)).size],
    ['Yield 次数', m.yields], ['Replan 次数', m.replannings],
    ['Near Miss', m.nearMisses], ['Collision', m.collisions + state.safetyEvents.filter(e => e.type === 'collision').length],
    ['平均等待', `${m.waitSeconds.toFixed(1)} s`], ['人工介入', m.humanInterventions],
  ].map(([label, value]) => `<span>${label}<b>${typeof value === 'number' ? value : escapeHtml(String(value))}</b></span>`).join('');
  const stateNode = $('pedBehaviorState');
  if (stateNode) stateNode.title = result.reason || '';
}
function renderPresentationHud() {
  setText('hudTask', state.running ? `前往${nextName()}` : state.order ? '已暂停 / 就绪' : '等待订单');
  setText('hudOrder', state.order ? `${state.order.id} · ${state.stage}/${state.plan?.stops.length ?? 0} 个货区` : '—');
  setText('hudRoute', state.plan ? `${state.plan.length.toFixed(1)} 单位 · 代价 ${state.plan.cost.toFixed(1)}` : '—');
  setText('hudMetrics', state.plan ? state.plan.method : 'Held–Karp + A*');
}
function renderAll() {
  renderLiveOps(); renderQueue(); renderOrderState(); renderInventory(); renderProgress();
  renderTimeline(); renderRobotCenter(); renderRouteView(); renderSimulationView(); renderPresentationHud();
  renderOverviewPreview(); renderPedestrianPanel();
  $('normalBtn')?.setAttribute('aria-pressed', String(state.scenario === 'normal'));
  $('peakBtn')?.setAttribute('aria-pressed', String(state.scenario === 'peak'));
  $('scenarioNormal').setAttribute('aria-pressed', String(state.scenario === 'normal'));
  $('scenarioPeak').setAttribute('aria-pressed', String(state.scenario === 'peak'));
  $('timeSlot').value = state.slot;
  drawCrowd(); drawRoutes(); drawDestinations(); drawRobot();
}
function renderScene() { renderAll(); }

/* ------------------------------------------------------- task state machine */
function resetPlayback(preserveSafety = false) {
  const fault = state.fault, dynamic = state.dynamicObstacles;
  state.running = false; state.finished = false; state.awaitingPickup = false;
  state.shortage = null; state.resolutions = new Map(); state.assistPending = null;
  state.assistedShelves = new Set(); state.blocked = false; state.fault = preserveSafety ? fault : '';
  state.stage = 0; state.legDistance = 0; state.pauseLeft = 0; state.slowLeft = 0;
  state.elapsed = 0; state.lastFrame = 0; state.bought = []; state.position = [...STORE.entrance];
  state.displayPosition = [...STORE.entrance]; state.lateralOffset = 0; state.inertialVelocity = [0, 0]; state.lastLogic = [...STORE.entrance];
  state.history = [[...STORE.entrance]]; state.detected = new Set(); state.traveled = 0;
  state.behavior = null; state.lastCollisionAt = -1;
  state.robotBrain?.reset();
  state.dynamicObstacles = preserveSafety ? dynamic : [];
  state.plan = state.order ? buildPlan(state.order.lines, state.scenario, state.slot) : null;
  state.normalPlan = state.order ? buildPlan(state.order.lines, 'normal', state.slot) : null;
  setText('playLabel', '开始履约'); setText('playIcon', '▶');
  status(state.order ? '已收到支付订单' : '等待订单',
    state.order ? '点击播放以检查载重并从入口出发。' : '请先选择商品并提交订单。', 'IDLE');
  if (state.fault) status('故障安全停车', faultAdvice[state.fault], 'FAULT');
  renderAll();
}
function actualPrice() { return state.bought.reduce((n, x) => n + x.product.price * x.qty, 0); }
function activateNext() {
  state.order = state.queue.shift() || null; state.stockoutId = ''; resetPlayback();
  if (state.order) {
    log(`队列推进至 ${state.order.id}：已载入支付订单。`);
    if (orderWeight() > CAPACITY) status('无法出发 · 超载', `${kgText(orderWeight())} 超过 ${kgText(CAPACITY)} 上限。`, 'FAULT');
  }
}
function submitOrder() {
  const lines = cartLines();
  if (!lines.length || cartPrice() < MIN_ORDER || lines.some(x => x.qty > x.product.stock)) return;
  const id = `NX-${String(++state.orderCounter).padStart(4, '0')}`;
  const order = { id, lines: lines.map(x => ({ product: x.product, qty: x.qty })), paid: cartPrice() };
  state.queue.push(order); state.cart.clear(); renderCart(); renderRecommendations();
  if (!state.order) activateNext(); else renderAll();
  setText('orderMessage', `${id}：模拟支付已受理（${money(order.paid)}）；${state.order === order ? '机器人已载入订单。' : `当前排队第 ${state.queue.length} 位。`}无真实交易。`);
  log(`${id} 已提交 · ${state.order === order ? '已分配给 AMR-01' : `排队第 ${state.queue.length} 位`}。`);
}
function updateScenario(source = 'manual') {
  if (state.order && !state.awaitingPickup) resetPlayback(true);
  if (source === 'manual') log(`场景已切换为${state.scenario === 'peak' ? '工作日高峰' : '平常客流'}（${state.slot}）：候选路径已重新计算。`);
  renderAll();
}
function positionOnLeg(leg, at) {
  let left = at;
  for (let i = 0; i < leg.lengths.length; i++) {
    const length = leg.lengths[i];
    if (left <= length || i === leg.lengths.length - 1) {
      const t = length ? Math.min(1, left / length) : 1, a = leg.points[i], b = leg.points[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= length;
  }
  return leg.points.at(-1);
}
function completeStop(stop) {
  for (const line of stop.lines) {
    const resolution = state.resolutions.get(line.product.id);
    if (resolution?.kind === 'skip') { log(`${line.product.name} 已跳过：顾客拒绝替代品。`); continue; }
    const actual = resolution?.kind === 'accept' ? resolution.replacement : line.product;
    actual.stock = Math.max(0, actual.stock - line.qty);
    state.bought.push({ product: actual, qty: line.qty });
    log(`货区 ${stop.shelfId}：已取 ${actual.name} × ${line.qty}${resolution ? '（已接受替代品）' : ''}。`);
  }
  state.stage++; state.pauseLeft = .6;
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  status('商品已核对', `当前载重 ${kgText(loaded)}。前往下一货区。`, 'PICKING');
  renderInventory(); renderAll();
}
function requestPickupAssist(stop, wasRunning) {
  const names = stop.lines.filter(line => state.resolutions.get(line.product.id)?.kind !== 'skip')
    .map(line => state.resolutions.get(line.product.id)?.replacement || line.product)
    .filter(p => pickupProfile(p).assist).map(p => p.name);
  if (!names.length || state.assistedShelves.has(stop.shelfId)) return false;
  state.assistPending = { stop, names, wasRunning }; state.running = false;
  status('需要员工协助', `${names.join('、')} 需要核对，机器人已停车。`, 'PICKING');
  log(`货区 ${stop.shelfId}：${names.join('、')} 需要员工协助。`, 'warn');
  renderAll(); return true;
}
function confirmPickupAssist() {
  if (!state.assistPending) return;
  const { stop, wasRunning } = state.assistPending;
  state.assistedShelves.add(stop.shelfId); state.assistPending = null;
  log(`员工已确认货区 ${stop.shelfId} 的协助取货。`);
  completeStop(stop);
  if (wasRunning && !state.fault && !state.events.has('failure')) {
    state.running = true; state.lastFrame = 0; setText('playLabel', '暂停履约'); setText('playIcon', 'Ⅱ'); requestAnimationFrame(animate);
  }
}
function arrive() {
  const index = state.stage, stops = state.plan.stops;
  state.position = [...(index < stops.length ? stops[index].point : index === stops.length ? STORE.checkout : STORE.exit)];
  state.history.push([...state.position]);
  if (index < stops.length) {
    const stop = stops[index];
    const line = stop.lines.find(x => (x.product.id === state.stockoutId || x.product.stock < x.qty) && !state.resolutions.has(x.product.id));
    if (line) {
      const candidate = substituteFor(line.product), alternative = candidate?.stock >= line.qty ? candidate : null;
      state.shortage = { line, alternative, wasRunning: state.running }; state.running = false;
      status('缺货 · 等待决策', `${line.product.name} 在货区 ${stop.shelfId} 缺货。`, 'PICKING');
      log(`${line.product.name} 缺货：机器人已停车，不会自动替换商品。`, 'warn'); renderAll(); return;
    }
    if (requestPickupAssist(stop, state.running)) return;
    completeStop(stop);
  } else if (index === stops.length) {
    log(`结账：共 ${state.bought.reduce((n, x) => n + x.qty, 0)} 件，最终模拟金额 ${money(actualPrice())}。`);
    status('结账完成', '机器人前往出口交接点。', 'PICKING');
    state.pauseLeft = .8; state.stage++; renderAll();
  } else {
    state.running = false; state.finished = true; state.awaitingPickup = true; state.stage++;
    log('机器人已到达出口，等待顾客交接。');
    status('等待出口交接', `订单 ${state.order.id} 已备好，等待取货。`, 'CHARGING');
    setText('playLabel', '等待交接'); setText('playIcon', '✓'); renderAll();
  }
  if (state.order) setText('orderMessage', `${state.order.id}：${state.awaitingPickup ? '已在出口等待交接' : '机器人履约中'}；仅为模拟支付。`);
}
function decideSubstitution(accept) {
  if (!state.shortage) return;
  const { line, alternative, wasRunning } = state.shortage;
  if (accept && !alternative) return;
  if (accept) {
    const projected = orderWeight() - line.product.weight * line.qty + alternative.weight * line.qty;
    if (projected > CAPACITY) { status('替代品导致超载', `预计载重 ${kgText(projected)} 超过上限，请拒绝该替代品。`, 'FAULT'); return; }
  }
  state.resolutions.set(line.product.id, accept ? { kind: 'accept', replacement: alternative } : { kind: 'skip' });
  log(accept ? `顾客接受 ${line.product.name} → ${alternative.name}。` : `顾客拒绝 ${line.product.name} 的替代品，已跳过该商品。`);
  state.shortage = null;
  if (requestPickupAssist(state.plan.stops[state.stage], wasRunning)) return;
  completeStop(state.plan.stops[state.stage]);
  if (wasRunning && !state.fault && !state.events.has('failure')) {
    state.running = true; state.lastFrame = 0; setText('playLabel', '暂停履约'); setText('playIcon', 'Ⅱ'); requestAnimationFrame(animate);
  }
}
function confirmHandoff() {
  if (!state.awaitingPickup) return;
  const finished = state.order;
  log(`出口交接完成：${finished.id} 已取走，最终模拟金额 ${money(actualPrice())}。`);
  state.completed.push({ id: finished.id, status: 'Completed' });
  state.order = null; state.awaitingPickup = false; state.stockoutId = '';
  activateNext();
  setText('orderMessage', state.order ? `${finished.id} 已交接，下一单 ${state.order.id} 已载入。` : `${finished.id} 已交接，队列为空。`);
}
function cancelOrder(id) {
  const index = state.queue.findIndex(order => order.id === id); if (index < 0) return;
  state.queue.splice(index, 1); state.completed.push({ id, status: 'Cancelled' }); renderAll(); log(`${id} 已从队列中取消。`);
}
function cancelActive() {
  if (!state.order || state.running || state.stage > 0 || state.elapsed > 0 || state.awaitingPickup) return;
  const id = state.order.id; state.completed.push({ id, status: 'Cancelled' }); state.order = null; activateNext();
  log(`${id} 已取消，已载入下一笔排队订单。`);
}
const faultAdvice = {
  sensor: '传感器不可用：机器人已安全停车。请检查传感器并人工清除故障。',
  localization: '定位丢失：已安全停车。恢复前请重新定位并核对货架地图。',
  network: '订单网络中断：已安全停车。恢复前请与服务端核对本地订单。',
  battery: '电量过低：已安全停车。操作员需充电或接管订单。',
  wrongItem: '商品核对不一致：已安全停车。操作员需复核名称与条码。',
};
function setFault(active) {
  state.fault = active ? $('faultSelect').value : '';
  if (!active) state.events.delete('failure');
  state.running = false; state.lastFrame = 0;
  if (active) {
    state.events.add('failure');
    status('故障安全停车', faultAdvice[state.fault], 'FAULT');
    log(`故障演练：${faultAdvice[state.fault]}`, 'danger');
  } else {
    status('故障已清除', '点击播放，从当前位置继续执行订单。', 'IDLE');
    log('操作员已清除故障，机器人等待继续指令。');
  }
  drawRobot(); renderAll();
}
function toggleSuddenPerson() {
  const active = !state.events.has('pedestrian');
  if (active) state.events.add('pedestrian'); else state.events.delete('pedestrian');
  state.running = false; state.lastFrame = 0;
  if (active) { status('行人突现 · 安全停车', '独立近场规则层阻止继续移动。', 'SAFE STOP'); log('行人突现：立即安全停车（仿真）。', 'danger'); }
  else { status('行人已离开', '点击播放可重新检查路径并继续。', 'IDLE'); log('仿真行人已离开通道。'); }
  drawRobot(); renderAll();
}

/* ------------------------------------------------------ simulation events */
function handleSimEvent(type) {
  if (type === 'pedestrian' || type === 'cart') {
    const nextPoint = state.plan?.legs[state.stage]?.points.at(-1) || [70, 45];
    const point = [Math.max(8, Math.min(132, state.position[0] + (nextPoint[0] - state.position[0]) * .55)),
      Math.max(8, Math.min(82, state.position[1] + (nextPoint[1] - state.position[1]) * .55))];
    state.dynamicObstacles = state.dynamicObstacles.filter(o => o.type !== (type === 'pedestrian' ? 'person' : 'cart'));
    state.dynamicObstacles.push({ id: `EVT-${type}`, type: type === 'pedestrian' ? 'person' : 'cart', zone: '仿真事件', point });
    state.events.add(type); state.slowLeft = type === 'cart' ? 2.4 : 1.8;
    const legNow = state.plan?.legs[state.stage];
    const direction = legNow ? legDirection(legNow, state.legDistance) : [1, 0];
    if (state.pedSystem) {
      const spawned = type === 'pedestrian'
        ? state.pedSystem.injectCrossing(state.displayPosition, direction, { type: 'regular' })
        : state.pedSystem.injectCrossing(state.displayPosition, direction, { type: 'cart', ahead: 12 });
      spawned.simulatedEvent = true;
    }
    log(`${type === 'pedestrian' ? '行人横穿' : '购物车阻挡'}仿真：自主行人 ${state.pedSystem?.people.at(-1)?.id || '—'} 已进入机器人前方，安全层正在预测碰撞时间。`, 'warn');
    status(type === 'pedestrian' ? '检测到行人' : '购物车阻挡通道', '预测性避障层：减速、礼让或重新规划。', 'AVOIDING');
    publishPedestrians();
    if (state.plan && state.running) replanCurrentLeg('障碍物事件');
    drawCrowd(); renderAll(); return;
  }
  if (type === 'aisle') {
    const edge = [[60, 34], [80, 34]], id = edgeKey(...edge);
    if (state.closedEdges.has(id)) {
      state.closedEdges.delete(id); state.events.delete('aisle');
      log('中央通道已重新开放，A* 可再次使用直达通道。');
    } else {
      state.closedEdges.add(id); state.events.add('aisle');
      log('通道封闭仿真：图中已移除中央通道边。', 'warn');
      status('通道已封闭', '受限边以红色显示，正在绕行重新规划。', 'SAFE STOP');
      if (state.running) replanCurrentLeg('通道封闭');
    }
    drawRoutes(); renderAll(); return;
  }
  if (type === 'overload') {
    const product = products.find(p => p.name === 'Beverage Pack');
    if (state.cart.has(product.id)) state.cart.delete(product.id); else state.cart.set(product.id, 3);
    state.events.add('overload');
    log(state.cart.has(product.id) ? '超载演练：已加入 3 箱 6 kg 商品，12 kg 上限将阻止出发。' : '已移除演练用载重。', 'warn');
    renderCart(); renderAll(); return;
  }
  if (type === 'congestion') {
    state.scenario = state.scenario === 'peak' ? 'normal' : 'peak';
    state.events.add('congestion');
    updateScenario(); log(`货架拥堵演练：当前场景为${state.scenario === 'peak' ? '工作日高峰' : '平常客流'}。`, 'warn');
    return;
  }
  if (type === 'failure') { setFault(!state.fault); return; }
}

/* -------------------------------------------------------------- animation */
function legDirection(leg, at) {
  let left = at;
  for (let i = 0; i < leg.lengths.length; i++) {
    if (left <= leg.lengths[i] || i === leg.lengths.length - 1) {
      const a = leg.points[i], b = leg.points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      return [dx / d, dy / d];
    }
    left -= leg.lengths[i];
  }
  return [1, 0];
}
function publishPedestrians() {
  const list = state.pedSystem?.snapshot() || [];
  scene3d?.setPedestrians(list);
  return list;
}
function recordProximity(point, snapshot) {
  const radius = PHYSICS.robot.radius;
  for (const p of snapshot) {
    const d = dist(point, [p.x, p.y]) * PHYSICS.metersPerUnit;
    const overlap = radius + (p.radius ?? .26);
    if (d < overlap && state.elapsed - state.lastCollisionAt > 1.2) {
      state.lastCollisionAt = state.elapsed;
      state.safetyEvents.push({ t: state.elapsed, type: 'collision', with: p.id, distance: d });
      if (state.safetyEvents.length > 60) state.safetyEvents.shift();
      log(`安全记录：与 ${p.id}（${p.cn || '行人'}）出现 ${d.toFixed(2)} m 距离侵入，已计入碰撞统计。`, 'danger');
      return true;
    }
  }
  return false;
}
/** 单个仿真步：行人自主运动 → 预测碰撞 → 行为状态 → 真实速度 → 路径推进。 */
function stepSimulation(dt) {
  if (!state.running) return false;
  const step = Math.min(dt, .08);
  state.elapsed += step;
  if (state.fault || state.events.has('failure')) {
    state.running = false; status('故障安全停车', faultAdvice[state.fault || 'localization'], 'FAULT'); renderAll(); return false;
  }
  if (state.blocked) { status('安全停车', '所有通道已封闭，机器人保持当前位置。', 'SAFE STOP'); return true; }
  if (state.pauseLeft > 0) { state.pauseLeft = Math.max(0, state.pauseLeft - step); return true; }
  const leg = state.plan?.legs[state.stage]; if (!leg) return false;

  const previousLogic = [...state.position];
  const direction = legDirection(leg, state.legDistance);
  state.inertialVelocity = [(previousLogic[0] - state.lastLogic[0]) / step, (previousLogic[1] - state.lastLogic[1]) / step];
  state.lastLogic = [...previousLogic];

  // 1) 行人先运动；机器人按最新的行人速度/方向做预测。
  state.pedSystem.update(step, { position: state.displayPosition, velocity: state.inertialVelocity });
  const snapshot = publishPedestrians();
  const obstacles = state.dynamicObstacles.map(o => ({ ...o, radius: o.type === 'cart' ? .38 : .3 }));

  // 2) 行为状态机输出真实速度系数（A* 仍负责全局路径）。
  const result = state.robotBrain.evaluate({
    position: state.displayPosition, velocity: state.inertialVelocity,
    direction, pedestrians: snapshot, obstacles, dt: step,
  });
  state.behavior = result;
  if (result.needsReplan) {
    state.robotBrain.acknowledgeReplan();
    if (replanCurrentLeg('行人/障碍物导致通道受阻')) log('局部避障层已请求 A* 重新规划当前路段。', 'warn');
  }
  if (result.state === 'YIELD' || result.state === 'WAIT' || result.state === 'EMERGENCY_STOP') {
    status(behaviorLabels[result.state], result.reason, result.state === 'EMERGENCY_STOP' ? 'FAULT' : 'SAFE STOP');
  } else if (['SLOW_DOWN', 'AVOIDANCE', 'RESUME'].includes(result.state)) {
    status(behaviorLabels[result.state], result.reason, 'AVOIDING');
  }

  // 3) 位移真正由行为状态决定；侧向避让仅在有净空时生效。
  const stepLength = step * BASE_SPEED * result.speedFactor;
  state.legDistance = Math.min(leg.length, state.legDistance + stepLength);
  state.position = positionOnLeg(leg, state.legDistance);
  const targetShift = ['YIELD', 'WAIT', 'EMERGENCY_STOP', 'REPLANNING'].includes(result.state) ? 0 : result.lateralShift;
  state.lateralOffset += (targetShift - state.lateralOffset) * Math.min(1, step * 3.2);
  const perpendicular = [-direction[1], direction[0]];
  state.displayPosition = [
    state.position[0] + perpendicular[0] * state.lateralOffset,
    state.position[1] + perpendicular[1] * state.lateralOffset,
  ];

  const travelled = dist(previousLogic, state.position);
  state.traveled += travelled; state.battery = Math.max(0, state.battery - travelled * .09);
  if (state.battery < 15 && !state.events.has('lowBattery')) {
    state.events.add('lowBattery'); log('仿真电量低于 15%，操作员应安排充电。', 'warn');
  }
  recordProximity(state.displayPosition, publishPedestrians());
  if (dist(state.history.at(-1), state.displayPosition) > .15) state.history.push([...state.displayPosition]);
  if (++state.uiTick % 6 === 0) drawHistory();
  drawRobot(); renderProgress();
  if (state.uiTick % 12 === 0) { renderLiveOps(); renderRobotCenter(); renderPresentationHud(); renderPedestrianPanel(); }
  if (state.legDistance >= leg.length - .001) {
    state.legDistance = 0; state.lateralOffset = 0; state.displayPosition = [...state.position];
    arrive();
  }
  return true;
}
function animate(now) {
  if (!state.running) return;
  if (!state.lastFrame) state.lastFrame = now;
  const delta = Math.min((now - state.lastFrame) / 1000, .08);
  state.lastFrame = now;
  stepSimulation(delta);
  if (state.running) requestAnimationFrame(animate);
}
function playPause() {
  if (state.shortage) { status('请先处理缺货', '请在任务面板选择接受替代品或跳过。', 'PICKING'); return; }
  if (state.assistPending) { status('请确认协助取货', '员工核对商品后机器人才能移动。', 'PICKING'); return; }
  if (state.fault || state.events.has('failure')) { status('故障安全停车', faultAdvice[state.fault || 'localization'], 'FAULT'); return; }
  if (state.awaitingPickup) { status('请确认交接', '顾客需在出口取走订单。', 'CHARGING'); return; }
  if (!state.order) { status('请先提交订单', '选择商品并模拟支付后才能启动机器人。', 'IDLE'); log('没有已支付订单，机器人停留在入口。'); return; }
  if (orderWeight() > CAPACITY) { status('无法出发 · 超载', `${kgText(orderWeight())} 超过 ${kgText(CAPACITY)}。`, 'FAULT'); log('载重检查未通过，机器人停留在入口。', 'danger'); return; }
  if (state.running) {
    state.running = false; state.lastFrame = 0; setText('playLabel', '继续履约'); setText('playIcon', '▶');
    status('仿真已暂停', '点击继续从当前位置恢复。', 'IDLE');
    renderProgress(); renderQueue(); return;
  }
  if (state.stage === 0 && state.elapsed === 0) {
    log(`载重检查通过：${kgText(orderWeight())} / ${kgText(CAPACITY)}。`);
    log(`${state.plan.method}；共 ${state.plan.stops.length} 个货区；A* 已完成逐段规划。`);
  }
  state.running = true; state.lastFrame = 0; setText('playLabel', '暂停履约'); setText('playIcon', 'Ⅱ');
  status(`前往${nextName()}`, '沿 A* 路径行驶，规则层处理行人与购物车。', 'MOVING');
  renderProgress(); renderQueue(); requestAnimationFrame(animate);
}
function toggleBlock() {
  state.blocked = !state.blocked;
  log(state.blocked ? '全部通道封闭测试：机器人已安全停车。' : '通道已重新开放，机器人可继续。');
  status(state.blocked ? '安全停车' : '路径可用', state.blocked ? '机器人保持当前位置。' : '就绪后可继续。', state.blocked ? 'SAFE STOP' : 'IDLE');
  renderAll();
}
function demoOrder() {
  if (!research) { setText('orderMessage', '真实商品目录仍在加载，请稍后重试。'); return; }
  const used = new Set();
  const examples = research.top.filter(p => {
    const item = productById.get(`I${p.id}`);
    if (!item || p.weightG <= 0 || p.weightG > 2000 || used.has(item.shelfId)) return false;
    used.add(item.shelfId); return true;
  }).slice(0, 4);
  state.cart = new Map(examples.map(p => [`I${p.id}`, 1]));
  renderCart(); renderRecommendations(); renderAll();
  setText('orderMessage', '已载入四件真实示例商品。模拟支付后，该购物篮将进入队列。');
}
function toggleOverload() {
  const product = products.find(p => p.name === 'Beverage Pack');
  changeQty(product.id, state.cart.has(product.id) ? -state.cart.get(product.id) : 3);
  setText('orderMessage', state.cart.has(product.id) ? '已加入三箱 6 kg 商品；12 kg 订单将被阻止。' : '已移除测试商品；已支付订单不受影响。');
}
function runBenchmark() {
  if (!state.order) { setText('benchmarkResult', '请先模拟支付订单，再对同一订单进行对比。'); return; }
  const modes = [['仅距离', 'distance'], ['距离 + 时间', 'time'], ['距离 + 时间 + 风险', 'full']];
  const rows = modes.map(([label, mode]) => {
    const plan = buildPlan(state.order.lines, state.scenario, state.slot, mode);
    return { label, score: plan && scoreExistingRoute(plan, state.scenario, state.slot) };
  });
  if (rows.some(row => !row.score)) { setText('benchmarkResult', '当前限制条件下没有可对比的路径。'); return; }
  const body = rows.map(({ label, score }) => `<tr><td>${label}</td><td>${score.length.toFixed(1)}</td><td>${score.time.toFixed(1)}</td><td>${score.risk.toFixed(1)}</td></tr>`).join('');
  let checked = 0, safer = 0;
  for (const scenario of ['normal', 'peak']) for (const slot of timeSlots.map(t => t.id)) {
    const savedEdges = state.closedEdges;
    state.closedEdges = new Set();
    const baseline = buildPlan(state.order.lines, scenario, slot, 'distance');
    const full = buildPlan(state.order.lines, scenario, slot, 'full');
    state.closedEdges = savedEdges;
    if (baseline && full) { checked++; if (full.risk < scoreExistingRoute(baseline, scenario, slot).risk) safer++; }
  }
  $('benchmarkResult').innerHTML = `<table class="data-table"><thead><tr><th>规划输入</th><th>长度</th><th>仿真秒数</th><th>风险</th></tr></thead><tbody>${body}</tbody></table><p>在 ${checked} 个固定教学场景中，完整代价函数有 ${safer} 次比仅距离基线得到更低风险。这不是随机对照实验。</p>`;
}
function renderDataAudit() {
  const counts = crowdSamples[state.slot], base = crowdSamples['09'];
  const changed = counts.filter((n, i) => Math.abs(n - base[i]) >= 3).length;
  setText('dataAudit', research ? `清洗文件：${research.summary.products.toLocaleString()} 件商品、${research.summary.orders.toLocaleString()} 笔订单、${research.summary.basketOrders.toLocaleString()} 个训练购物篮。清洗前的删除量无法从已清洗文件反推。` : '正在读取真实数据统计……');
  setText('driftAudit', `${timeSlots.find(t => t.id === state.slot).label} 与 09:00 教学基线相比：${changed}/${shelves.length} 个区域的仿真人数相差至少 3 人。这是重新抽样的提示，不是真实的模型漂移。`);
}
function renderPickupFeasibility() {
  const lines = state.order?.lines || ['Apple', 'Shrimp', 'Frozen Dumplings', 'Beverage Pack'].map(name => ({ product: products.find(p => p.name === name), qty: 1 }));
  $('pickupFeasibility').innerHTML = `<ul>${lines.map(({ product: p }) => `<li>${escapeHtml(p.name)}: ${pickupProfile(p).label}</li>`).join('')}</ul>`;
}

/* ------------------------------------------------------------------ binding */
function populateFilters() {
  if (research) {
    $('categoryFilter').innerHTML = '<option value="">全部部门</option>' + research.index.departments.map(x =>
      `<option value="${x.id}">${escapeHtml(x.name)} (${x.count})</option>`).join('');
    updateSubcategories();
  }
  $('timeSlot').innerHTML = timeSlots.map(x => `<option value="${x.id}">${x.label}</option>`).join('');
}
function updateSubcategories() {
  if (!research) return;
  const dept = $('categoryFilter').value;
  const aisles = research.index.aisles.filter(x => !dept || x.departmentId === Number(dept));
  $('subcategoryFilter').innerHTML = '<option value="">全部货区</option>' + aisles.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
  scheduleCatalogSearch();
}
function scheduleCatalogSearch() {
  if (!research) return;
  clearTimeout(catalogTimer);
  const request = ++catalogRequest;
  $('catalogue').innerHTML = '<p class="empty">正在搜索真实商品目录……</p>';
  catalogTimer = setTimeout(async () => {
    try {
      const query = $('productSearch').value, dept = $('categoryFilter').value, aisle = $('subcategoryFilter').value;
      const rows = !query && !dept && !aisle ? research.top.slice(0, 36) : await searchCatalog(research.index, query, dept, aisle);
      if (request !== catalogRequest) return;
      catalogResults = rows.map(row => {
        const id = `I${row.id}`; if (!productById.has(id)) productById.set(id, convertProduct(row)); return productById.get(id);
      });
      renderCatalogue();
    } catch (error) { if (request === catalogRequest) $('catalogue').textContent = `商品目录加载失败：${error.message}`; }
  }, 240);
}
function bindEvents() {
  $('benchmarkBtn').addEventListener('click', runBenchmark);
  $('injectFaultBtn').addEventListener('click', () => setFault(true));
  $('clearFaultBtn').addEventListener('click', () => setFault(false));
  $('confirmAssistBtn').addEventListener('click', confirmPickupAssist);
  $('inventoryAlerts').addEventListener('click', event => {
    const id = event.target.closest('[data-restock]')?.dataset.restock; if (id) restock(id);
  });
  $('catalogue').addEventListener('click', event => { const id = event.target.closest('[data-add]')?.dataset.add; if (id) changeQty(id, 1); });
  $('recommendations').addEventListener('click', event => { const id = event.target.closest('[data-add]')?.dataset.add; if (id) changeQty(id, 1); });
  $('cartList').addEventListener('click', event => {
    const plus = event.target.closest('[data-plus]')?.dataset.plus, minus = event.target.closest('[data-minus]')?.dataset.minus;
    if (plus) changeQty(plus, 1); if (minus) changeQty(minus, -1);
  });
  $('productSearch').addEventListener('input', scheduleCatalogSearch);
  $('categoryFilter').addEventListener('change', updateSubcategories);
  $('subcategoryFilter').addEventListener('change', scheduleCatalogSearch);
  $('demoOrderBtn').addEventListener('click', demoOrder);
  $('submitOrderBtn').addEventListener('click', submitOrder);
  $('scenarioNormal').addEventListener('click', () => { state.scenario = 'normal'; updateScenario(); });
  $('scenarioPeak').addEventListener('click', () => { state.scenario = 'peak'; updateScenario(); });
  $('timeSlot').addEventListener('change', () => { state.slot = $('timeSlot').value; renderCrowd(); updateScenario(); });
  $('playBtn').addEventListener('click', playPause);
  $('resetBtn').addEventListener('click', () => { resetPlayback(); log('当前订单已重新开始，机器人已返回入口。'); });
  $('safetyTestBtn')?.addEventListener('click', toggleBlock);
  $('cameraResetBtn').addEventListener('click', () => scene3d.resetCamera());
  $('cameraIso').addEventListener('click', () => setCamera('iso'));
  $('cameraFollow').addEventListener('click', () => setCamera('follow'));
  $('cameraClose').addEventListener('click', () => setCamera('close'));
  $('stockoutSelect').addEventListener('change', () => {
    state.stockoutId = $('stockoutSelect').value;
    log(state.stockoutId ? `已为 ${productById.get(state.stockoutId).name} 选择缺货演练。` : '已关闭缺货演练。');
  });
  $('acceptSubBtn').addEventListener('click', () => decideSubstitution(true));
  $('skipSubBtn').addEventListener('click', () => decideSubstitution(false));
  $('handoffBtn').addEventListener('click', confirmHandoff);
  $('orderQueue').addEventListener('click', event => {
    const id = event.target.closest('[data-cancel]')?.dataset.cancel;
    if (id) cancelOrder(id);
    if (event.target.closest('[data-cancel-active]')) cancelActive();
  });
  document.querySelectorAll('[data-event]').forEach(button => button.addEventListener('click', () => handleSimEvent(button.dataset.event)));
  $('pedStartBtn')?.addEventListener('click', () => { state.pedSystem.start(); state.pedRunning = true; log('行人仿真已启动。'); renderPedestrianPanel(); });
  $('pedPauseBtn')?.addEventListener('click', () => { state.pedSystem.pause(); state.pedRunning = false; log('行人仿真已暂停，行人保持当前位置。'); renderPedestrianPanel(); });
  $('pedResetBtn')?.addEventListener('click', () => applyPedPreset('normal'));
  $('pedDensitySelect')?.addEventListener('change', event => { state.pedDensity = event.target.value; state.pedSystem.setDensity(state.pedDensity); renderPedestrianPanel(); });
  $('pedWalkSpeedSelect')?.addEventListener('change', event => { state.pedSpeed = Number(event.target.value); state.pedSystem.setSpeedFactor(state.pedSpeed); renderPedestrianPanel(); });
  $('pedModeSelect')?.addEventListener('change', event => { state.pedMode = event.target.value; state.pedSystem.setMode(state.pedMode); renderPedestrianPanel(); });
  document.querySelectorAll('[data-ped-scenario]').forEach(button => button.addEventListener('click', () => applyPedPreset(button.dataset.pedScenario)));
  window.addEventListener('nexus:viewchange', event => {
    state.view = event.detail.name;
    scene3d.setActive(state.view === 'supermarket' && state.mode === '3d');
    if (state.view === 'supermarket') { scene3d.resize(); renderAll(); }
  });
  window.addEventListener('nexus:viewmode', event => {
    state.mode = event.detail.mode;
    $('mapFrame').classList.toggle('mode-2d', state.mode === '2d');
    $('storeMap').setAttribute('aria-hidden', String(state.mode !== '2d'));
    scene3d.setActive(state.view === 'supermarket' && state.mode === '3d');
    scene3d.resize();
  });
  window.addEventListener('nexus:presentation', event => scene3d.setPresentation(event.detail.active));
}
function applyPedPreset(name) {
  if (!state.pedSystem) return;
  const leg = state.plan?.legs[state.stage];
  const direction = leg ? legDirection(leg, state.legDistance) : [1, 0];
  state.pedSystem.applyPreset(name, state.displayPosition, direction);
  state.pedRunning = true;
  state.pedMode = state.pedSystem.mode;
  state.pedDensity = state.pedSystem.density;
  const selects = [['pedDensitySelect', state.pedDensity], ['pedModeSelect', state.pedMode]];
  for (const [id, value] of selects) { const node = $(id); if (node) node.value = value; }
  document.querySelectorAll('[data-ped-scenario]').forEach(b => b.classList.toggle('is-active', b.dataset.pedScenario === name));
  publishPedestrians();
  log(`行人预设场景已切换为${({ normal: '正常购物', crossing: '行人横穿', narrow: '窄道会车', peak: '高峰拥堵' })[name] || name}（规则驱动仿真）。`);
  renderPedestrianPanel();
}
function setCamera(mode) {
  scene3d.setCameraMode(mode);
  ['cameraIso', 'cameraFollow', 'cameraClose'].forEach((id, i) =>
    $(id).setAttribute('aria-pressed', String(['iso', 'follow', 'close'][i] === mode)));
}

/* 自动化回归测试钩子：所有数值直接来自运行中的仿真状态，不另造指标。 */
window.__NEXUS = Object.freeze({
  state,
  applyPedPreset,
  setPedDensity: value => state.pedSystem?.setDensity(value),
  setPedMode: value => state.pedSystem?.setMode(value),
  injectCrossing: (direction, options) => state.pedSystem?.injectCrossing(state.displayPosition, direction || [1, 0], options),
  injectHeadOn: (direction, options) => state.pedSystem?.injectHeadOn(state.displayPosition, direction || [1, 0], options),
  step: dt => stepSimulation(dt),
  advance(seconds, hz = 60) {
    const steps = Math.min(6000, Math.ceil(seconds * hz));
    for (let i = 0; i < steps && state.running; i++) stepSimulation(1 / hz);
    return this.metrics();
  },
  forceAdvance(seconds, hz = 60) {
    const wasRunning = state.running; state.running = true;
    const result = this.advance(seconds, hz);
    if (!wasRunning) state.running = false;
    return result;
  },
  metrics() {
    const brain = state.robotBrain, ped = state.pedSystem;
    return {
      stage: state.stage, elapsed: state.elapsed, order: state.order?.id || null,
      position: [...state.position], displayPosition: [...state.displayPosition],
      behavior: state.behavior?.state || null, speedFactor: state.behavior?.speedFactor ?? 1,
      ttc: state.behavior?.ttc ?? Infinity, nearestDistance: state.behavior?.distance ?? Infinity,
      pedestrianCount: ped?.people.length || 0,
      pedestrianStates: ped?.people.map(p => p.state) || [],
      collisions: (brain?.metrics.collisions || 0) + state.safetyEvents.filter(e => e.type === 'collision').length,
      nearMisses: brain?.metrics.nearMisses || 0, yields: brain?.metrics.yields || 0,
      replannings: brain?.metrics.replannings || 0, waitSeconds: brain?.metrics.waitSeconds || 0,
      humanInterventions: brain?.metrics.humanInterventions || 0,
      minDistance: brain?.metrics.minDistance ?? Infinity,
      safetyEvents: [...state.safetyEvents],
      transitions: brain?.transitions.slice(-30) || [],
      fps: scene3d.getFps?.() || 0,
    };
  },
  reset() { resetPlayback(); },
});

/* --------------------------------------------------------------------- init */
scene3d = createStoreScene($('scene3d'), $('storeMap'));
state.robotBrain = new RobotBehavior();
state.pedSystem = new PedestrianSystem({ nodes });
scene3d.setPickHandler(info => {
  const node = $('sceneInspect'); if (!node) return;
  if (info.kind === 'robot') node.innerHTML = `<b>AMR-01 · 自主移动机器人</b>状态：${state.behavior ? behaviorLabels[state.behavior.state] : '待机'}<br>速度：${(state.behavior?.targetSpeed || 0).toFixed(2)} m/s<br>车身：${PHYSICS.robot.width} × ${PHYSICS.robot.length} m（仿真）`;
  else if (info.kind === 'pedestrian') {
    const p = state.pedSystem?.snapshot().find(x => x.id === info.id);
    node.innerHTML = `<b>${p ? p.typeName : 'Pedestrian'}</b>${info.id} · ${info.state || 'WALKING'}<br>类型：${p ? p.cn : '仿真行人'}<br>速度：${p ? p.speed.toFixed(2) : '0.00'} m/s`;
  } else if (info.kind === 'shelf') node.innerHTML = `<b>货区 ${info.id} · ${zoneLabel(info.category)}</b>分类键：${info.category}<br>商品映射与导航坐标来自 storeData.js`;
  node.hidden = false;
  clearTimeout(scene3d._inspectTimer);
  scene3d._inspectTimer = setTimeout(() => { node.hidden = true; }, 4200);
});
state.pedSystem.applyPreset('normal');
publishPedestrians();
scene3d.setScenario(state.scenario, state.slot);
drawBaseMap(); drawFixtures(); populateFilters(); renderCatalogue(); renderCart();
renderInventory(); renderRecommendations(); renderCrowd(); resetPlayback(); bindEvents();
scene3d.setActive(false);
log('NEXUS RETAIL 仿真已初始化，正在加载真实商品目录……');

loadResearch().then(data => {
  research = data;
  for (const row of [...data.top, ...Object.values(data.rules.products)]) {
    const id = `I${row.id}`; if (!productById.has(id)) productById.set(id, convertProduct(row));
  }
  rules = data.rules.rules.map(rule => ({ ...rule, from: `I${rule.from}`, to: `I${rule.to}` }));
  populateFilters(); scheduleCatalogSearch(); renderRules(); renderRecommendations();
  renderResearchDashboard(data); renderDataAudit(); renderPickupFeasibility(); renderInventory();
  log(`真实商品目录已加载：${data.summary.products.toLocaleString()} 件商品，${data.rules.ruleCount.toLocaleString()} 条 Apriori 规则。`);
}).catch(error => {
  $('catalogue').textContent = `真实数据加载失败：${error.message}`;
  setText('miningMethod', '真实分析数据不可用，请检查 public/data 目录。');
  console.error(error);
});
