// NEXUS RETAIL — order system, algorithms, task state machine and view binding.
// REAL DATA: public/data JSON (Instacart). CALCULATED: Held-Karp, A*, Apriori, K-means.
// SIMULATED: shelves, stock, crowd, obstacles, robot motion, battery and timings.
import { createStoreScene } from './scene3d.js';
import { STORE, PHYSICS, buildNavNodes, shelves, layoutFixtures, products, timeSlots, crowdSamples, shelfCrowd, peopleForScenario } from './storeData.js';
import { PedestrianSystem, PEDESTRIAN_TYPES, PEDESTRIAN_STATES } from './pedestrian.js';
import { RobotBehavior, ROBOT_STATES, ROBOT_STATE_CN } from './robotBehavior.js';
import { loadResearch, searchCatalog, convertProduct, propertyLabels, renderResearchDashboard, escapeHtml, departmentLabel, zoneLabel } from './instacart.js';
import { getObstacleSnapshot, registerSensorProvider } from './sensorAdapter.js';
import { hydrateInventory, saveInventory, nextOrderId, saveOrder, patchOrder, listOrders, getOrderRecord, hydrateOrder, addRestock, listRestocks, persistenceStatus, getRobotCount, setSetting } from './systemCore.js';
import { BRAND_ASSETS, applyBrandAssets, updateBrandRobotImage } from './branding.js';

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

let research = null, rules = [], catalogResults = [], catalogRequest = 0, catalogTimer = 0, scene3d, restocks = listRestocks().length;
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
  // V2.1：默认一台，后台可配置最多两台；每台独立泊位，互不重叠。
  fleet: STORE.robotWaitSlots.slice(0, getRobotCount()).map((slot, i) => ({ id: `AMR-${String(i + 1).padStart(2, '0')}`,
    position: [...slot], waitSlot: [...slot], status: 'IDLE', battery: 100, distance: 0, orderId: null })),
  activeRobotId: 'AMR-01', returnLeg: null, returnReason: '', historyFilter: 'ALL', historySort: 'desc',
  simSpeed: 1, // 仿真倍速 1/2/3/5：只缩放仿真时间，规则、检查与决策全部保持逐帧执行
  nextAvailable: false, // 队列中有待处理订单且机器人已归位：显示「继续下一单」手动入口
  // V2.4 只读回放：历史订单沿已记录 path 回放，不改写订单状态、不与仿真共用状态机。
  replay: null, origHistory: null, // replay = {id,record,path,robotId,progress,playing,duration}
  // V2.4 充电：{active, robotId, rate}；机器人在充电桩补电，电量按仿真时间恢复。
  charging: null,
  miningEnabled: false, // V2.4：路径优化是否启用 Apriori 实验关联加权
};
const behaviorLabels = ROBOT_STATE_CN;
const PED_STATE_CN = { ENTER_STORE: '进店', WALK_TO_SECTION: '前往货架', WALKING: '行走中', BROWSING: '选购停留',
  STOPPING: '减速停留', TURNING: '转向', QUEUEING: '收银排队', GOING_TO_CHECKOUT: '前往收银', EXITING: '离店' };

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
  // V2.2：机器人已配备机械臂，常规取货（含冷链）由机械臂自动完成，无需员工介入；
  // 只有「补货」属于员工协助作业，在库存管理页由人工确认执行。
  return { cold, assist: false, label: cold ? '机械臂自动取货 · 冷链（仿真）' : '机械臂自动取货（仿真）' };
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
const activeRobot = () => state.fleet.find(r => r.id === state.activeRobotId) || state.fleet[0];
const robotById = id => state.fleet.find(r => r.id === id) || null;
function syncRobotPose(position, status, orderId) {
  const robot = activeRobot();
  robot.position = [...position];
  if (status) robot.status = status;
  if (orderId !== undefined) robot.orderId = orderId;
}
function robotFleetSnapshot() {
  return state.fleet.map(robot => ({ id: robot.id, position: [...robot.position], state: robot.status,
    distance: robot.distance, battery: robot.battery, orderId: robot.orderId }));
}
function syncShelfStock() {
  if (!scene3d?.setShelfStock) return;
  for (const shelf of shelves) {
    const items = [...productById.values()].filter(p => p.shelfId === shelf.id);
    const ratio = items.length ? items.reduce((n, p) => n + p.stock / p.capacity, 0) / items.length : 1;
    scene3d.setShelfStock(shelf.id, ratio);
  }
}
function persistOrder(patch = {}) {
  if (!state.order) return;
  Object.assign(state.order, patch);
  saveOrder(state.order);
}
function orderStatusCn(status) {
  return ({ Pending: '待处理', Unassigned: '待分配', Delivering: '配送中', Completed: '已完成',
    Cancelled: '已取消', Exception: '异常', Returning: '返航中' })[status] || status || '待处理';
}

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
function applyRestock(product, quantity, shelfId, priority, mode) {
  if (!product || !(quantity > 0)) return null;
  const before = product.stock;
  const shelf = shelves.find(s => s.id === shelfId) || shelves.find(s => s.id === product.shelfId);
  if (shelf && shelf.id !== product.shelfId) { product.shelfId = shelf.id; product.point = [...shelf.point]; }
  product.stock = Math.max(0, Math.min(product.capacity, before + Math.floor(quantity)));
  restocks++;
  saveInventory([...productById.values()]);
  syncShelfStock();
  const record = addRestock({ productId: product.id, name: product.name, quantity: Math.floor(quantity),
    before, after: product.stock, shelfId: shelf?.id || product.shelfId, mode, priority, status: '完成', time: new Date().toISOString() });
  log(`${product.name} 已${mode === '自动' ? '自动' : '手动'}补货 ${Math.floor(quantity)} 件（${before} → ${product.stock}），货区 ${record.shelfId}，3D 货架已同步。`);
  renderInventory(); renderLiveOps(); renderRestocks(); renderCatalogue(); renderCart();
  return record;
}

function restock(id) {
  const product = productById.get(id); if (!product) return;
  applyRestock(product, product.capacity - product.stock, product.shelfId, 'normal', '手动');
}

function autoRestock() {
  const low = [...productById.values()].filter(p => p.stock / p.capacity < .2);
  if (!low.length) { setText('restockMessage', '当前没有低于 20% 阈值的商品。'); return; }
  low.forEach(p => applyRestock(p, p.capacity - p.stock, p.shelfId, p.stock === 0 ? 'high' : 'normal', '自动'));
  setText('restockMessage', `已自动补货 ${low.length} 件商品；基于当前库存阈值与容量，记录已写入补货历史。`);
}

function renderRestocks() {
  $('restockTable').innerHTML = listRestocks().slice(0, 40).map(r =>
    `<tr><td><b>${escapeHtml(r.name)}</b></td><td class="right num">+${r.quantity}</td><td class="right num">${r.before} → ${r.after}</td><td>${escapeHtml(r.shelfId)}</td><td>${escapeHtml(r.mode)}</td><td>${new Date(r.time).toLocaleString('zh-CN', { hour12: false })}</td><td>${escapeHtml(r.status)}</td></tr>`).join('')
    || '<tr><td colspan="7" class="muted">暂无补货记录。</td></tr>';
  setText('invRestocks', restocks);
}

function initRestockControls() {
  const category = $('restockCategory'), product = $('restockProduct'), shelf = $('restockShelf');
  if (!category || !product || !shelf) return;
  const prevCategory = category.value, prevProduct = product.value;
  const categories = [...new Set([...productById.values()].map(p => p.category))].sort();
  category.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(zoneLabel(c))}</option>`).join('');
  if (prevCategory && categories.includes(prevCategory)) category.value = prevCategory;
  shelf.innerHTML = shelves.map(s => `<option value="${s.id}">货区 ${s.id} · ${escapeHtml(zoneLabel(s.category))}</option>`).join('');
  const updateProducts = () => {
    const list = [...productById.values()].filter(p => p.category === category.value);
    product.innerHTML = list.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (prevProduct && list.some(p => p.id === prevProduct)) product.value = prevProduct;
    updateCurrent();
  };
  const updateCurrent = () => {
    const p = productById.get(product.value); if (!p) return;
    $('restockCurrent').value = p.stock;
    shelf.value = p.shelfId;
  };
  category.onchange = () => { category._userChanged = true; updateProducts(); };
  product.onchange = updateCurrent;
  updateProducts();
}

/* ------------------------------------------------- navigation graph / A* */
function edgeKey(a, b) { const ka = key(a), kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; }
const nodes = buildNavNodes();
function edgeCost(a, b, scenario, slot, mode = 'full') {
  const length = dist(a, b), center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const nearby = shelves.filter(s => dist(s.point, center) < 20).map(s => shelfCrowd(slot, s.id));
  const crowd = nearby.length ? nearby.reduce((n, x) => n + x, 0) / nearby.length : 0;
  const hot = scenario === 'peak' && a[1] === STORE.hotCorridor.y && b[1] === STORE.hotCorridor.y && Math.min(a[0], b[0]) >= STORE.hotCorridor.xMin && Math.max(a[0], b[0]) <= STORE.hotCorridor.xMax;
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
/** V2.4 实验关联：基于 Apriori 真实购物篮规则，计算两个货区之间的共购关联强度。
 *  返回 0~1 的奖励权重：订单中同时买了 A、B 两货区商品的规则置信度/提升度越高，权重越大。
 *  路径优化据此把"实验证实常一起购买"的货区在访问顺序上排得更近，让实验数据真正影响规划。 */
const shelfRuleCache = new Map();
function shelfProductIds(shelfId) {
  if (!shelfRuleCache.has(shelfId)) {
    const ids = new Set([...productById.values()].filter(p => p.shelfId === shelfId).map(p => p.id));
    shelfRuleCache.set(shelfId, ids);
  }
  return shelfRuleCache.get(shelfId);
}
function associationWeight(shelfA, shelfB, lines) {
  if (!rules.length || shelfA === shelfB) return 0;
  const bought = new Set((lines || []).map(l => l.product.id));
  const a = shelfProductIds(shelfA), b = shelfProductIds(shelfB);
  let best = 0;
  for (const rule of rules) {
    if (rule.confidence < .15 || rule.lift <= 1) continue;
    const pairA = a.has(rule.from) && b.has(rule.to);
    const pairB = b.has(rule.from) && a.has(rule.to);
    if (!pairA && !pairB) continue;
    // 只有当前订单确实买了规则涉及的商品，才算"本次实验命中"，避免空泛关联。
    const relevant = bought.has(rule.from) || bought.has(rule.to);
    const w = Math.min(1, rule.confidence * .6 + Math.min(rule.lift, 4) / 4 * .4) * (relevant ? 1 : .35);
    if (w > best) best = w;
  }
  return best;
}
/** 返回本次订单命中的关联规则（用于路径优化页展示实验依据）。 */
function matchedAssociations(lines) {
  if (!rules.length) return [];
  const shelfOf = id => productById.get(id)?.shelfId;
  const inOrder = new Set((lines || []).map(l => l.product.id));
  const out = [];
  for (const rule of rules) {
    if (rule.confidence < .15 || rule.lift <= 1) continue;
    if (!inOrder.has(rule.from) && !inOrder.has(rule.to)) continue;
    const sa = shelfOf(rule.from), sb = shelfOf(rule.to);
    if (!sa || !sb || sa === sb) continue;
    out.push({ from: rule.from, to: rule.to, fromShelf: sa, toShelf: sb,
      confidence: rule.confidence, lift: rule.lift, support: rule.support });
  }
  return out.sort((x, y) => (y.lift * y.confidence) - (x.lift * x.confidence)).slice(0, 6);
}
function buildPlan(lines, scenario, slot, mode = 'full', startPoint = activeRobot().waitSlot) {
  const stops = uniqueStops(lines), n = stops.length, cache = new Map();
  const leg = (a, b) => { const k = `${key(a)}>${key(b)}`; if (!cache.has(k)) cache.set(k, planLeg(a, b, scenario, slot, mode)); return cache.get(k); };
  const finish = leg(STORE.checkout, STORE.handoff); if (!finish) return null;
  const start = stops.map(s => leg(startPoint, s.point));
  const checkout = stops.map(s => leg(s.point, STORE.checkout));
  const between = stops.map((a, i) => stops.map((b, j) => i === j ? null : leg(a.point, b.point)));
  // V2.4 实验驱动：模式 'mining' 时对段代价施加 Apriori 共购奖励——实验证实常一起购买的
  // 两货区之间代价降低，Held–Karp 因而倾向于把它们排得更近（真实实验数据改变访问顺序）。
  const mining = mode === 'mining';
  const matches = mining ? matchedAssociations(lines) : [];
  const adjustedCost = (i, j, base) => {
    if (!mining || !base) return base?.cost ?? Infinity;
    const w = associationWeight(stops[i].shelfId, stops[j].shelfId, lines);
    return Math.max(base.cost * .25, base.cost - w * base.cost * .45); // 最多降 45% 代价
  };
  const order = []; let bestCost = Infinity;
  let method = mining ? 'Held–Karp 精确 · 实验关联加权' : 'Held–Karp 精确访问顺序';
  if (n > 12) {
    method = '最近代价启发式（不保证全局最优）';
    const remaining = new Set(stops.map((_, i) => i)); let previous = -1;
    while (remaining.size) {
      let choice = -1, best = Infinity;
      for (const j of remaining) {
        const candidate = previous < 0 ? start[j] : between[previous][j];
        const candCost = (previous < 0 ? candidate?.cost : adjustedCost(previous, j, candidate)) ?? Infinity;
        if (candidate && candCost < best) { best = candCost; choice = j; }
      }
      if (choice < 0) return null;
      order.push(choice); remaining.delete(choice); previous = choice;
    }
    bestCost = (start[order[0]]?.cost ?? 0) + order.slice(1).reduce((sum, j, i) => sum + adjustedCost(order[i], j, between[order[i]][j]), 0) + checkout[order.at(-1)].cost + finish.cost;
  } else {
    const states = 1 << n, all = states - 1, costs = new Float64Array(states * n), previous = new Int8Array(states * n);
    costs.fill(Infinity); previous.fill(-1);
    for (let j = 0; j < n; j++) if (start[j]) costs[(1 << j) * n + j] = start[j].cost;
    for (let mask = 1; mask < states; mask++) for (let bits = mask; bits; bits &= bits - 1) {
      const j = 31 - Math.clz32(bits & -bits), current = costs[mask * n + j];
      if (!Number.isFinite(current)) continue;
      for (let rest = all ^ mask; rest; rest &= rest - 1) {
        const k = 31 - Math.clz32(rest & -rest), step = between[j][k]; if (!step) continue;
        const index = ((mask | (1 << k)) * n + k), next = current + adjustedCost(j, k, step);
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
  const plan = { stops: order.map(i => stops[i]), legs, cost: bestCost, method, startPoint: [...startPoint] };
  if (mining) { plan.mining = true; plan.matchedRules = matches; plan.associationSavings =
    (between.length ? order.slice(1).reduce((s, j, i) => s + (between[order[i]][j]?.cost ?? 0) - adjustedCost(order[i], j, between[order[i]][j]), 0) : 0); }
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
  for (const x of STORE.aisleXs) svg('line', { x1: x * 10, y1: (STORE.height - 8) * 10, x2: x * 10, y2: 80, class: 'aisle-line' }, $('aisles'));
  for (const y of STORE.crossYs) svg('line', { x1: 50, y1: (STORE.height - y) * 10, x2: (STORE.width - 2) * 10, y2: (STORE.height - y) * 10, class: 'aisle-line' }, $('aisles'));
  for (const f of layoutFixtures) {
    svg('rect', { x: (f.x - f.w / 2) * 10, y: (STORE.height - f.y - f.h / 2) * 10, width: f.w * 10, height: f.h * 10, rx: 6, class: `fixture-${f.kind}` }, $('fixtures'));
    // 机器人泊位标签上移，避免被停在泊位上的机器人圆点盖住。
    const labelY = (STORE.height - f.y) * 10 + (f.kind === 'robotwait' ? -24 : 4);
    svg('text', { x: f.x * 10, y: labelY, class: 'fixture-label' }, $('fixtures')).textContent = f.label;
  }
  for (const s of shelves) {
    const left = s.xMin * 10, top = (STORE.height - s.yMax) * 10, width = (s.xMax - s.xMin) * 10, height = (s.yMax - s.yMin) * 10;
    svg('rect', { x: left, y: top, width, height, rx: 5, class: `shelf-rect ${s.kind}` }, $('shelves'));
    svg('text', { x: left + width / 2, y: top + height / 2 - 5, class: 'shelf-caption' }, $('shelves')).textContent = zoneLabel(s.category);
    svg('text', { x: left + width / 2, y: top + height / 2 + 13, class: 'shelf-code' }, $('shelves')).textContent = `货区 ${s.id}`;
  }
}
function drawFixtures() { /* included in drawBaseMap */ }
function drawGate(point, label) {
  svg('rect', { x: point[0] * 10 - 27, y: (STORE.height - point[1]) * 10 - 13, width: 54, height: 26, rx: 7, class: 'gate' }, $('destinations'));
  svg('text', { x: point[0] * 10, y: (STORE.height - point[1]) * 10 + 4, class: 'gate-label' }, $('destinations')).textContent = label;
}
function drawDestinations() {
  clear($('destinations'));
  const stops = state.plan?.stops || [];
  stops.forEach((stop, i) => {
    svg('circle', { cx: stop.point[0] * 10, cy: (STORE.height - stop.point[1]) * 10, r: 14, class: `destination-circle ${i < state.stage ? 'destination-done' : ''}` }, $('destinations'));
    svg('text', { x: stop.point[0] * 10, y: (STORE.height - stop.point[1]) * 10 + 4, class: 'destination-label' }, $('destinations')).textContent = i < state.stage ? '✓' : String(i + 1);
  });
  drawGate(STORE.entrance, '入口'); drawGate(STORE.checkout, '结账'); drawGate(STORE.exit, '出口');
  drawGate(STORE.handoff, '交接区');
  scene3d?.setPickups(stops.map(s => s.point), Math.min(state.stage, stops.length));
}
function drawCrowd() {
  clear($('crowd')); clear($('heatLayer')); clear($('pedDirectionLayer'));
  const crowd = state.pedSystem ? state.pedSystem.snapshot() : [];
  // 人流热力：按真实行人位置统计各货区附近人数，与 3D 共用同一快照。
  const liveCounts = shelves.map(s => crowd.filter(p => Math.hypot(p.x - s.point[0], p.y - s.point[1]) < 16).length);
  shelves.forEach((s, i) => {
    const n = liveCounts[i];
    const color = n >= 5 ? '#e2734b' : n >= 3 ? '#e8a34a' : n > 0 ? '#71b887' : '#9db3ad';
    svg('rect', { x: s.xMin * 10, y: (STORE.height - s.yMax) * 10, width: (s.xMax - s.xMin) * 10, height: (s.yMax - s.yMin) * 10,
      fill: color, opacity: Math.min(.42, .08 + n * .05), rx: 5 }, $('heatLayer'));
  });
  const shown = crowd.length ? crowd : [...peopleForScenario(state.scenario, state.slot), ...state.dynamicObstacles];
  for (const p of shown) {
    const point = p.point || [p.x, p.y];
    if (p.x !== undefined) {
      const heading = p.faceHeading ?? p.heading ?? 0;
      const speed = Math.hypot(p.vx || 0, p.vy || 0);
      const length = 12 + Math.min(22, speed * 18);
      const dx = Math.sin(heading) * length, dy = -Math.cos(heading) * length;
      svg('line', { x1: point[0] * 10, y1: (STORE.height - point[1]) * 10,
        x2: point[0] * 10 + dx, y2: (STORE.height - point[1]) * 10 + dy,
        class: `ped-direction ${p.state === 'BROWSING' ? 'is-browsing' : ''}` }, $('pedDirectionLayer'));
    }
    svg('circle', { cx: point[0] * 10, cy: (STORE.height - point[1]) * 10, r: 12, class: 'crowd-halo' }, $('crowd'));
    svg('circle', { cx: point[0] * 10, cy: (STORE.height - point[1]) * 10, r: 6, class: 'crowd-person' }, $('crowd'));
  }
  const gateLayer = $('gateStatusLayer');
  if (gateLayer) {
    clear(gateLayer);
    const entries = crowd.filter(p => p.state === 'ENTER_STORE').length;
    const exits = crowd.filter(p => p.state === 'EXITING').length;
    svg('rect', { x: 8 * 10 - 30, y: (STORE.height - 26) * 10 - 54, width: 120, height: 22, rx: 8, class: 'gate-status' }, gateLayer);
    svg('text', { x: 8 * 10 + 28, y: (STORE.height - 26) * 10 - 38, class: 'gate-status-text' }, gateLayer).textContent = `入口 · 进店 ${entries}`;
    svg('rect', { x: 170 * 10 - 90, y: (STORE.height - 26) * 10 - 54, width: 120, height: 22, rx: 8, class: 'gate-status' }, gateLayer);
    svg('text', { x: 170 * 10 - 28, y: (STORE.height - 26) * 10 - 38, class: 'gate-status-text' }, gateLayer).textContent = `出口 · 离店 ${exits}`;
  }
  // 收银台实时排队徽标：n/4 表示该通道正在排队的人数（满员转红），地图上一眼看出高峰排队。
  if (state.pedSystem) {
    for (const q of state.pedSystem.queueStatus()) {
      const lane = STORE.checkoutLanes.find(l => l.id === q.id);
      if (!lane) continue;
      const color = q.size >= q.capacity ? '#e2734b' : q.size > 0 ? '#e8a34a' : '#9db3ad';
      // 4 号通道紧挨出口标识，徽标向左错开一格，避免与「出口」标牌重叠。
      const bx = Math.abs(lane.x - STORE.exit[0]) < 6 ? lane.x - 6 : lane.x;
      svg('rect', { x: bx * 10 - 21, y: (STORE.height - 23.2) * 10 - 16, width: 42, height: 16, rx: 5,
        fill: '#ffffff', 'fill-opacity': .94, stroke: color, 'stroke-width': 1.3 }, $('crowd'));
      svg('text', { x: bx * 10, y: (STORE.height - 23.2) * 10 - 4.5, 'text-anchor': 'middle',
        'font-size': 9, 'font-weight': 700, fill: color }, $('crowd')).textContent = `${q.size}/${q.capacity}`;
    }
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
    svg('line', { x1: a[0] * 10, y1: (STORE.height - a[1]) * 10, x2: b[0] * 10, y2: (STORE.height - b[1]) * 10, class: 'restricted-path' }, $('comparisonRoute'));
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
  clear($('robotRouteLayer'));
  // 所有在役机器人位置来自同一舰队状态；当前执行任务者用高亮描边区分。
  for (const robot of state.fleet) {
    const active = robot.id === state.activeRobotId;
    const [x, y] = active ? state.displayPosition : robot.position;
    const radius = (PHYSICS.robot.radius / PHYSICS.metersPerUnit) * 10;
    svg('circle', { cx: x * 10, cy: (STORE.height - y) * 10, r: radius, class: active ? 'robot-body' : 'robot-body robot-body--idle' }, $('robotLayer'));
    svg('text', { x: x * 10, y: (STORE.height - y) * 10 - radius - 6, class: 'robot-map-label' }, $('robotLayer')).textContent = robot.id;
  }
  if (state.returnLeg && state.returnLeg.points.length > 1) {
    svg('path', { d: pathData(state.returnLeg.points), class: 'return-path' }, $('robotRouteLayer'));
  }
  scene3d?.setRobots(robotFleetSnapshot());
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
  setText('opsDone', state.completed.filter(c => c.status === '已完成' || c.status === 'Completed').length);
  $('opsStock').className = alerts.length > 2 ? 'is-warn' : alerts.length ? '' : 'is-ok';
  $('opsRobot').className = robotLabel === '故障' || robotLabel === '安全停车' ? 'is-danger' : robotLabel === '待机' ? '' : 'is-ok';
  setText('kpiOrders', activeOrderCount());
  setText('kpiCompleted', state.completed.filter(c => c.status === '已完成' || c.status === 'Completed').length);
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
    ['4 · 结账与交接', state.awaitingPickup ? '在交接区等待取货' : '待处理'],
  ];
  $('livePreviewList').innerHTML = preview.map(([label, value], i) =>
    `<li><span>${label}<small>${escapeHtml(value)}</small></span><span class="pill ${i < state.stage ? 'pill--ok' : 'pill--info'}">${i < state.stage ? '已完成' : '待处理'}</span></li>`).join('');
}
let twinStaticBuilt = false;
function renderOverviewPreview() {
  const W = STORE.width, H = STORE.height, SX = 644 / W, SY = 364 / H;
  const tx = x => x * SX + 8, ty = y => y * SY + 8;
  // —— 静态底图（通道/装置/货架/门）只构建一次 ——
  if (!twinStaticBuilt && $('twinAisles')) {
    twinStaticBuilt = true;
    $('twinAisles').innerHTML = [
      ...STORE.aisleXs.map(x => `<line x1="${tx(x)}" y1="${ty(6)}" x2="${tx(x)}" y2="${ty(H - 6)}" stroke="#dbe8e1" stroke-width="1.4"/>`),
      ...STORE.crossYs.map(y => `<line x1="${tx(6)}" y1="${ty(y)}" x2="${tx(W - 4)}" y2="${ty(y)}" stroke="#dbe8e1" stroke-width="1.4"/>`),
    ].join('');
    $('twinFixtures').innerHTML = layoutFixtures.map(f => {
      const color = f.kind === 'promo' ? '#E8A34A' : f.kind === 'kiosk' ? '#20A995' : f.kind === 'checkout' ? '#7b93a8' : f.kind === 'queue' ? '#c4d2dc' : f.kind === 'robotwait' ? '#bfe3d6' : f.kind === 'handoff' ? '#c9a8e8' : f.kind === 'cart' ? '#9fb8c4' : '#aab8bf';
      return `<rect x="${tx(f.x - f.w / 2)}" y="${ty(f.y - f.h / 2)}" width="${f.w * SX}" height="${f.h * SY}" rx="2" fill="${color}" opacity=".45"/>`;
    }).join('');
    $('twinShelves').innerHTML = shelves.map(s => {
      const color = s.kind === 'cooler' ? '#3D7BD6' : s.kind === 'produce' ? '#20A995' : s.kind === 'bulk' ? '#E8A34A' : '#84919B';
      return `<rect x="${tx(s.xMin)}" y="${ty(s.yMin)}" width="${(s.xMax - s.xMin) * SX}" height="${(s.yMax - s.yMin) * SY}" rx="2" fill="${color}" opacity=".32" stroke="${color}" stroke-width=".8"/>`;
    }).join('');
    $('twinGates').innerHTML = [
      [STORE.entrance, '入口', '#20A995'], [STORE.checkout, '收银', '#7b93a8'], [STORE.exit, '出口', '#E8A34A'],
      [STORE.handoff, '交接', '#9a6fc4'],
    ].map(([p, label, c]) => `<g><rect x="${tx(p[0]) - 13}" y="${ty(p[1]) - 7}" width="26" height="14" rx="4" fill="#fff" stroke="${c}" stroke-width="1.2"/><text x="${tx(p[0])}" y="${ty(p[1]) + 3}" font-size="8" text-anchor="middle" fill="${c}">${label}</text></g>`).join('');
  }
  if (!$('twinRobot')) return;
  // —— 动态层：路径 / 人流热力 / 行人 / 机器人，全部读取与 3D 同源的 state ——
  const route = (state.plan?.points || []).map((p, i) => `${i ? 'L' : 'M'}${tx(p[0])},${ty(p[1])}`).join(' ');
  const traveled = state.history.length > 1 ? state.history.map((p, i) => `${i ? 'L' : 'M'}${tx(p[0])},${ty(p[1])}`).join(' ') : '';
  $('previewRoute').innerHTML = (route ? `<path d="${route}" fill="none" stroke="#20A995" stroke-width="2" stroke-dasharray="5 3" opacity=".85"/>` : '')
    + (traveled ? `<path d="${traveled}" fill="none" stroke="#159e86" stroke-width="2.6" opacity=".9"/>` : '');
  const people = state.pedSystem?.snapshot() || [];
  $('twinHeat').innerHTML = people.map(p => `<circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="9" fill="#ffb347" opacity=".10"/>`).join('');
  $('twinCrowd').innerHTML = people.map(p => {
    // 结账中=青色、排队中=红橙，其余按是否推车着色：高峰排队在总览图上也能一眼看到。
    const fill = p.serving ? '#20A995' : p.state === 'QUEUEING' ? '#e2734b' : p.cart ? '#E8A34A' : '#5b7f92';
    return `<circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="${p.serving ? 2.8 : 2.2}" fill="${fill}" opacity=".92"/>`;
  }).join('');
  $('twinRobot').innerHTML = state.fleet.map(robot => {
    const pos = robot.id === state.activeRobotId ? state.displayPosition : robot.position;
    const c = state.charging?.active ? '#E8A34A' : state.replay ? '#7b6cf0' : '#0f6f5e';
    return `<g><circle cx="${tx(pos[0])}" cy="${ty(pos[1])}" r="5.4" fill="#fff" stroke="${c}" stroke-width="1.6"/><circle cx="${tx(pos[0])}" cy="${ty(pos[1])}" r="2.6" fill="${c}"/></g>`;
  }).join('');
  const live = $('twinLive');
  if (live) { live.textContent = state.replay ? '● 回放' : state.charging?.active ? '● 充电' : '● 实时'; live.setAttribute('fill', state.replay ? '#7b6cf0' : state.charging?.active ? '#E8A34A' : '#20A995'); }
}
function renderQueue() {
  const entries = [
    ...(state.order ? [{ order: state.order, label: state.awaitingPickup ? '等待交接' : state.running ? '配送中' : state.shortage ? '等待缺货决策' : '已分配 · 待出发' }] : []),
    ...state.queue.map((order, i) => ({ order, label: `排队第 ${i + 1} 单` })),
  ];
  const waiting = state.queue.length;
  const nextBar = waiting > 0
    ? `<div class="queue-next" data-queue-next>
         <div><b>还有 ${waiting} 单等待处理</b><span>${state.order ? '当前订单执行完毕后，可手动开启下一单。' : '机器人已归位，可立即开启下一单。'}</span></div>
         <div class="btn-row">
           <button type="button" class="btn btn-teal btn-sm" data-next-order>继续下一单 →</button>
           <button type="button" class="btn btn-ghost btn-sm" data-goto-3d>前往 3D 超市</button>
         </div>
       </div>`
    : '';
  $('orderQueue').innerHTML = nextBar + (entries.length ? entries.map(({ order, label }) =>
    `<div class="queue-item"><b>${escapeHtml(order.id)}</b><span>${order.lines.reduce((n, x) => n + x.qty, 0)} 件 · ${money(order.paid)} · ${escapeHtml(order.robotId || '待分配')}</span>
     <span class="pill ${label === '配送中' ? 'pill--ok' : 'pill--info'}">${label}</span>
     <button type="button" data-demo="${escapeHtml(order.id)}">查看配送演示</button>
     ${order === state.order ? '<button type="button" data-cancel-active="1">取消订单</button>' : `<button type="button" data-cancel="${escapeHtml(order.id)}">取消排队</button>`}</div>`).join('')
    : '<p class="empty">队列中没有订单。提交订单后，这里会出现配送演示入口。</p>');
  const rows = [...(state.order ? [state.order] : []), ...state.queue, ...listOrders().slice(0, 4)];
  const seen = new Set();
  $('fulfillmentTable').innerHTML = rows.length ? rows.filter(order => !seen.has(order.id) && seen.add(order.id)).map(order => {
    const statusText = order.status || (order === state.order ? state.running ? '配送中' : '待出发' : '排队中');
    return `<tr><td class="mono">${escapeHtml(order.id)}</td><td>${order.lines?.reduce((n, x) => n + x.qty, 0) ?? '—'}</td><td>${order.paid ? money(order.paid) : '—'}</td><td>${escapeHtml(order.robotId || order.robotName || '待分配')}</td><td><span class="pill ${['已完成', 'Completed'].includes(statusText) ? 'pill--ok' : statusText === '已取消' ? 'pill--danger' : 'pill--info'}">${escapeHtml(orderStatusCn(statusText))}</span></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">暂无订单。</td></tr>';
  // 3D 页「继续下一单」按钮：队列有待处理订单且当前无执行中任务时显示，需手动点击。
  const nextBtn = $('nextOrderBtn');
  if (nextBtn) {
    nextBtn.hidden = !(state.queue.length > 0 && (!state.order || state.finished || !state.running));
    nextBtn.textContent = `继续下一单（${state.queue.length}）→`;
  }
}

function renderHistory() {
  const status = state.historyFilter, sortAsc = state.historySort === 'asc';
  const records = listOrders().filter(record => status === 'ALL' || record.status === status)
    .sort((a, b) => sortAsc ? (a.createdAt || '').localeCompare(b.createdAt || '') : (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('historyTable').innerHTML = records.length ? records.map(record => {
    const items = (record.lines || []).map(l => `${escapeHtml(l.name || l.product?.name || l.productId)} × ${l.qty}`).join('、');
    const time = record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—';
    const route = `${(record.start || []).map(n => Number(n).toFixed(0)).join(',')} → ${(record.end || []).map(n => Number(n).toFixed(0)).join(',')}`;
    return `<tr><td class="mono">${escapeHtml(record.id)}</td><td>${items}</td><td class="right">${money(record.paid || 0)}</td><td>${time}</td><td>${escapeHtml(record.robotId || '待分配')}</td><td class="mono">${route}</td>
      <td><span class="pill ${record.status === '已完成' ? 'pill--ok' : record.status === '已取消' ? 'pill--danger' : 'pill--info'}">${escapeHtml(orderStatusCn(record.status))}</span></td>
      <td><button type="button" data-history-detail="${escapeHtml(record.id)}">详情</button> <button type="button" data-history-demo="${escapeHtml(record.id)}">3D 回放</button></td></tr>`;
  }).join('') : '<tr><td colspan="8" class="muted">没有符合条件的订单。</td></tr>';
  setText('historyStoreBadge', persistenceStatus() === 'localStorage' ? '本地持久化' : '内存临时');
}

function showOrderDetail(id) {
  const record = getOrderRecord(id); if (!record) return;
  const live = state.order?.id === id ? state.order : null;
  $('orderDetailTitle').textContent = `${record.id} · ${orderStatusCn(live?.status || record.status)}`;
  const lines = (record.lines || []).map(l => `<li>${escapeHtml(l.name || l.product?.name || l.productId)} × ${l.qty} · ${escapeHtml(l.shelfId || '')} · ${money((l.price || 0) * l.qty)}</li>`).join('');
  const path = (live?.history || record.path || []);
  const rows = [
    ['订单金额', money(record.paid || 0)], ['下单时间', record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
    ['分配机器人', record.robotId || '待分配'], ['配送起点', (record.start || []).join(', ')], ['配送终点', (record.end || []).join(', ')],
    ['开始配送', record.startedAt ? new Date(record.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
    ['完成时间', record.completedAt ? new Date(record.completedAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
    ['取消时间', record.cancelledAt ? new Date(record.cancelledAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
    ['配送耗时', record.deliverSeconds != null ? `${Number(record.deliverSeconds).toFixed(1)} 秒` : (live?.elapsed != null ? `${live.elapsed.toFixed(1)} 秒` : '—')],
    ['取消前进度', record.cancelProgress != null ? `${(Number(record.cancelProgress) * 100).toFixed(0)}%` : '—'],
    ['已记录路径点', path.length],
  ];
  $('orderDetail').innerHTML = `<div class="grid grid-2"><ul>${lines || '<li>无商品明细</li>'}</ul><table class="data-table"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td class="right mono">${escapeHtml(String(v))}</td></tr>`).join('')}</tbody></table></div>
    <div class="btn-row" style="margin-top:12px"><button id="detailDemoBtn" class="btn btn-teal btn-sm" type="button">查看 3D 配送</button>${record.status !== '已完成' && record.status !== '已取消' ? '<button id="detailCancelBtn" class="btn btn-secondary btn-sm" type="button">取消该订单</button>' : ''}</div>`;
  $('detailDemoBtn').onclick = () => viewOrderDemo(id);
  const cancel = $('detailCancelBtn'); if (cancel) cancel.onclick = () => cancelOrderById(id, '用户在订单历史中取消');
}
/** 判断订单记录是否已终结（已完成/已取消）——终结订单只能只读回放，不得重新履约改写状态。 */
function orderFinal(record) { return record?.status === '已完成' || record?.status === '已取消'; }

/** 从持久化记录还原订单并载入 3D 配送演示：定位到对应机器人与任务，无需手动重找。
 *  V2.4：已终结订单走「只读轨迹回放」，绝不改写其状态；进行中订单仍是重新载入任务。 */
function viewOrderDemo(id) {
  const record = getOrderRecord(id);
  if (!record) { setText('orderMessage', `订单 ${id} 不存在，无法打开演示。`); return; }
  exitReplay(false); // 先清理可能存在的旧回放
  if (orderFinal(record)) {
    startReplay(record);
    return;
  }
  // 若目标订单就是当前执行/排队中的订单，直接进入 3D 页面并定位到它的机器人。
  if (state.order?.id === id) {
    const robot = robotById(state.order.robotId) || activeRobot();
    state.activeRobotId = robot.id; state.position = [...robot.position]; state.displayPosition = [...robot.position];
  } else {
    const order = hydrateOrder(record, productById);
    if (!order.lines.length) { setText('orderMessage', `订单 ${id} 的商品已不在当前目录中，无法重建 3D 演示。`); return; }
    state.queue = state.queue.filter(o => o.id !== id);
    const robot = robotById(record.robotId) || assignRobot(order.lines) || activeRobot();
    order.robotId = robot.id; order.robotName = robot.id;
    state.activeRobotId = robot.id; state.order = order;
    state.scenario = record.scenario || state.scenario; state.slot = record.slot || state.slot;
    resetPlayback();
    log(`已从历史记录载入 ${id}，定位到 ${robot.id}，路径与订单任务已重建。`);
  }
  NEXUS_UI?.showView('supermarket');
  scene3d?.setActive(true); scene3d?.resize();
  setText('orderMessage', `${id} 已载入 3D 配送演示：${state.order?.robotId || '机器人'}，点击播放可查看沿真实 A* 路径的取货与配送。`);
  renderAll();
}

/** V2.4 只读回放：沿 record.path 逐帧插值驱动机器人；不触碰 state.order / patchOrder，状态永不被改写。 */
function startReplay(record) {
  const path = (record.path?.length > 1 ? record.path : (record.cancelPosition ? [record.start, record.cancelPosition] : []))
    .map(p => [...p]);
  if (path.length < 2) { setText('orderMessage', `订单 ${record.id} 没有可回放的轨迹数据。`); return; }
  const robotId = record.robotId && robotById(record.robotId) ? record.robotId : activeRobot().id;
  const robot = robotById(robotId);
  state.activeRobotId = robotId;
  // 计算回放时长：按记录中的实际用时，缺省按轨迹点密度估算，限制在 4~30 秒，避免过长/过短。
  const duration = Math.max(4, Math.min(30, (record.deliverSeconds && record.deliverSeconds > 0)
    ? record.deliverSeconds : path.length * .12));
  state.replay = { id: record.id, record, path, robotId, progress: 0, playing: false, duration,
    lastFrame: 0, label: record.status === '已完成' ? '已完成 · 回放' : '已取消 · 回放' };
  state.running = false; state.finished = false;
  state.origHistory = state.history;
  state.history = [[...path[0]]];
  state.position = [...path[0]]; state.displayPosition = [...path[0]]; state.inertialVelocity = [0, 0];
  if (robot) { robot.position = [...path[0]]; robot.status = 'IDLE'; }
  syncRobotPose(state.displayPosition, 'IDLE', null);
  scene3d?.setHistory(state.history);
  scene3d?.setRobots(robotFleetSnapshot());
  NEXUS_UI?.showView('supermarket');
  scene3d?.setActive(true); scene3d?.resize();
  setText('playLabel', '播放回放'); setText('playIcon', '▶');
  status('配送回放', `${record.id} · ${state.replay.label}，共 ${path.length} 个轨迹点。`, 'CHARGING');
  log(`进入只读回放：${record.id}（${state.replay.label}），订单状态不会被修改。`);
  setText('orderMessage', `${record.id} 已进入只读回放（${state.replay.label}），点击「播放回放」观看沿真实记录轨迹的移动。`);
  renderAll();
}

/** 退出回放并恢复进入前的历史轨迹；silent=true 时不清空订单消息（供 viewOrderDemo 前置清理调用）。 */
function exitReplay(silent = true) {
  if (!state.replay) return false;
  state.replay.playing = false; state.running = false;
  state.replay = null;
  if (state.origHistory) { state.history = state.origHistory; state.origHistory = null; }
  const robot = activeRobot();
  if (robot) { robot.position = [...robot.waitSlot]; robot.status = 'IDLE'; }
  state.position = [...(robot?.waitSlot || STORE.entrance)]; state.displayPosition = [...state.position];
  syncRobotPose(state.displayPosition, 'IDLE', null);
  scene3d?.setHistory(state.history); scene3d?.setRobots(robotFleetSnapshot());
  setText('playLabel', '开始履约'); setText('playIcon', '▶');
  if (!silent) setText('orderMessage', '已退出回放，机器人归位待命。');
  return true;
}

/** 回放心跳：与仿真主循环解耦，按仿真倍速推进，走到终点自动停止（状态不变）。 */
function replayLoop(now) {
  const r = state.replay;
  if (!r || !r.playing) return;
  if (!r.lastFrame) r.lastFrame = now;
  const dt = Math.min((now - r.lastFrame) / 1000, .05) * state.simSpeed;
  r.lastFrame = now;
  r.progress = Math.min(1, r.progress + dt / r.duration);
  const d = r.progress * (r.path.length - 1);
  const i = Math.min(r.path.length - 2, Math.floor(d));
  const t = d - i;
  const a = r.path[i], b = r.path[i + 1];
  const pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  state.position = pos; state.displayPosition = [...pos];
  state.history = [...r.path.slice(0, i + 1), [...pos]];
  const robot = robotById(r.robotId);
  if (robot) { robot.position = [...pos]; robot.distance = d * .17; }
  syncRobotPose(state.displayPosition, 'RETURNING', r.id);
  scene3d?.setHistory(state.history);
  scene3d?.setRobots(robotFleetSnapshot());
  renderProgress();
  if (r.progress >= 1) {
    r.playing = false; state.running = false;
    setText('playLabel', '重新播放'); setText('playIcon', '▶');
    status('回放结束', `${r.id} 回放完成 · 订单状态未改变。`, 'CHARGING');
    renderAll(); return;
  }
  requestAnimationFrame(replayLoop);
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
  if (state.assistPending) setText('assistDetail', `货区 ${state.assistPending.stop.shelfId}：${state.assistPending.names.join('、')} 需要员工核对。`);
  if (state.awaitingPickup) setText('handoffDetail', `订单 ${state.order.id}（取货码 ${state.order.id.slice(-4)}）已在收银台完成结账，平台已收到「结账完成」消息。请核对 ${state.bought.reduce((n, x) => n + x.qty, 0)} 件商品、最终模拟金额 ${money(actualPrice())}，然后点击「确认取货」——机器人随即返回充电桩补电，下一单从充电桩出发。`);
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
  if (state.replay) {
    const pct = Math.round(state.replay.progress * 100);
    setWidth('progressFill', pct); setText('progressPercent', `${pct}%`);
    setText('progressText', `${state.replay.id} · ${state.replay.label} · ${pct}%`);
    setWidth('fulfillFill', pct); setText('fulfillPct', `${pct}%`);
    setText('nextTarget', '只读回放');
    return;
  }
  const done = state.plan?.legs.slice(0, state.stage).reduce((n, leg) => n + leg.length, 0) || 0;
  const percent = state.awaitingPickup ? 100 : state.plan ? Math.min(100, Math.round((done + state.legDistance) / state.plan.length * 100)) : 0;
  setWidth('progressFill', percent); setText('progressPercent', `${percent}%`);
  setText('progressText', state.awaitingPickup ? '等待交接区取货' : state.shortage ? '等待缺货决策' : state.running ? `前往${nextName()}` : state.order ? '就绪 / 已暂停' : '等待已支付订单');
  setText('nextTarget', nextName());
  setText('fulfillPct', `${percent}%`); setWidth('fulfillFill', percent);
}
function nextName() {
  if (state.awaitingPickup) return '交接区取货';
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
  setText('batteryText', `${state.battery.toFixed(0)}%`); setWidth('batteryFill', state.battery); // 3D 页任务面板电量条
  const chargeBtn = $('chargeBtn');
  if (chargeBtn) chargeBtn.textContent = state.charging?.active ? 'Ⅱ 暂停充电' : '⚡ 回坞充电';
  if (state.charging?.active) setText('robotStatusText', `充电中 · 电量 ${state.battery.toFixed(0)}% · ${activeRobot().id}`);
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
  $('heldKarpFlow').innerHTML = stops.length ? [STORE.entrance, ...stops.map(s => s.point), STORE.checkout, STORE.handoff]
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
  renderMiningPanel();
}
/** V2.4：展示 Apriori 实验规则如何真实改变访问顺序（常规 vs 实验驱动两方案对比）。 */
function renderMiningPanel() {
  const box = $('miningResult'); if (!box) return;
  const toggle = $('miningToggleBtn');
  if (toggle) { toggle.textContent = state.miningEnabled ? '✓ 实验驱动已启用（点击关闭）' : '启用实验驱动规划'; toggle.setAttribute('aria-pressed', String(state.miningEnabled)); }
  if (!state.order) { box.innerHTML = '提交订单后可查看本次命中的关联规则与优化收益。'; return; }
  const regular = buildPlan(state.order.lines, state.scenario, state.slot, 'full');
  const mining = buildPlan(state.order.lines, state.scenario, state.slot, 'mining');
  const matched = matchedAssociations(state.order.lines);
  if (!regular || !mining) { box.innerHTML = '当前订单无法计算对比路径。'; return; }
  if (!matched.length) {
    box.innerHTML = `<p class="assumption">本次订单未命中置信度≥15% 且提升度>1 的共购规则，实验驱动规划与常规规划一致（避免无依据的强制关联）。当前顺序：入口 → ${regular.stops.map(s => `货区${s.shelfId}`).join(' → ')} → 出口。</p>`;
    return;
  }
  const ruleRows = matched.slice(0, 5).map(r => `<li>${escapeHtml(productById.get(r.from)?.name || r.from)} + ${escapeHtml(productById.get(r.to)?.name || r.to)} · 货区 ${r.fromShelf}/${r.toShelf} · 支持度 ${(r.support * 100).toFixed(3)}% · 置信度 ${(r.confidence * 100).toFixed(1)}% · 提升度 ${r.lift.toFixed(2)}</li>`).join('');
  const sameOrder = regular.stops.map(s => s.shelfId).join(',') === mining.stops.map(s => s.shelfId).join(',');
  const savings = Math.max(0, regular.length - mining.length);
  box.innerHTML = `<p class="assumption">本单命中 <b>${matched.length}</b> 条真实购物篮共购规则（来自 <b>${research ? research.rules.baskets.toLocaleString() : '—'}</b> 个训练篮的 Apriori 挖掘）。这些实验结论被写入 Held–Karp 的段代价：共购货区之间的转移代价最多降低 45%，从而让访问顺序更贴合真实购买行为。</p>
    <ul style="margin:8px 0">${ruleRows}</ul>
    <div class="grid grid-2" style="margin-top:8px">
      <div><b>常规规划</b><div class="muted">入口 → ${regular.stops.map(s => `货区${s.shelfId}`).join(' → ')} → 出口</div><div>里程 ${regular.length.toFixed(1)} · 用时 ${regular.time.toFixed(1)}s · 代价 ${regular.cost.toFixed(1)}</div></div>
      <div><b>实验驱动规划${state.miningEnabled ? '（当前采用）' : ''}</b><div class="muted">入口 → ${mining.stops.map(s => `货区${s.shelfId}`).join(' → ')} → 出口</div><div>里程 ${mining.length.toFixed(1)} · 用时 ${mining.time.toFixed(1)}s · 代价 ${mining.cost.toFixed(1)}</div></div>
    </div>
    <p class="assumption" style="margin-top:8px">${sameOrder ? '本单两方案访问顺序相同，但实验权重已参与代价评估；' : `实验关联改变了访问顺序（${regular.stops.map(s=>s.shelfId).join('→')} → ${mining.stops.map(s=>s.shelfId).join('→')}），`}${savings > .05 ? `物理里程减少 ${savings.toFixed(1)} 地图单位。` : '里程相近，收益主要体现在减少跨区折返与贴合真实购买行为。'}</p>`;
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
  // 所有显示值来自运行中的行人对象与行为状态机；暂停时保持上次计算结果。
  const people = ped.snapshot();
  // 展开行人字段并附带 d，后续 nearest.speed / nearest.x 等才能取到真实仿真值。
  const nearest = people.reduce((best, p) => {
    const d = dist([p.x, p.y], state.displayPosition);
    const current = { ...p, d };
    return !best || d < best.d ? current : best;
  }, null);
  setText('pedSafetyStatus', result.safetyStatus || '安全');
  setText('pedLiveCount', people.length);
  setText('pedLiveSpeed', nearest ? `${nearest.speed.toFixed(2)} m/s` : '0.00 m/s');
  setText('pedLivePosition', nearest ? `${nearest.x.toFixed(0)}, ${nearest.y.toFixed(0)}` : '—');
  setText('pedLiveState', nearest ? (PED_STATE_CN[nearest.state] || nearest.state) : '—');
  const destination = nearest?.destinationShelf ? `货区 ${nearest.destinationShelf}` : nearest?.destination ? nearest.destination.map(n => n.toFixed(0)).join(', ') : '—';
  setText('pedLiveDestination', destination);
  setText('pedLiveAvoid', nearest ? (nearest.avoiding || nearest.blocked ? '是' : '否') : '否');
  setText('pedSpeed', `${(result.targetSpeed || 0).toFixed(2)} m/s`);
  setText('pedDistance', Number.isFinite(result.distance) ? `${result.distance.toFixed(2)} m` : '—');
  setText('pedTtc', Number.isFinite(result.ttc) ? `${result.ttc.toFixed(2)} s` : '—');
  setText('pedDestination', nextName());
  const m = brain.metrics, pm = ped.metrics;
  const checkout = ped.checkoutSummary ? ped.checkoutSummary() : null;
  const counters = $('pedCounters');
  if (counters) counters.innerHTML = [
    ['行人数量', ped.people.length], ['活动路线', new Set(ped.people.map(p => p.state)).size],
    ['Yield 次数', m.yields], ['Replan 次数', m.replannings],
    ['Near Miss', m.nearMisses], ['Collision', m.collisions + state.safetyEvents.filter(e => e.type === 'collision').length],
    ['平均等待', `${m.waitSeconds.toFixed(1)} s`], ['人工介入', m.humanInterventions],
    ['结账完成', pm.checkoutServed ?? 0], ['平均排队', checkout ? `${checkout.avgWait} s` : '—'],
  ].map(([label, value]) => `<span>${label}<b>${typeof value === 'number' ? value : escapeHtml(String(value))}</b></span>`).join('');
  const queues = $('pedQueues');
  if (queues) {
    // 每条收银通道：排队人数/容量 + 队首正在结账的剩余时间 + 本通道平均等待，全部来自真实队列状态。
    queues.innerHTML = ped.queueStatus().map(q => {
      const label = q.id.replace('LANE-', '收银台 ');
      const lead = q.serving ? `结账中 ${q.serveLeft}s` : `已结 ${q.served}`;
      const tip = q.serving ? `顾客 ${q.serving} 正在结账，剩余 ${q.serveLeft}s`
        : q.size ? '队首顾客走向扫码台' : '空闲';
      return `<span title="${tip}${q.wait ? ` · 平均排队 ${q.wait}s` : ''}">${label} · ${lead}<b>${q.size}/${q.capacity}</b></span>`;
    }).join('') + (checkout
      ? `<span style="grid-column:1/-1">合计 · 已结账 ${checkout.served} 人<b>排队 ${checkout.queued} 人</b></span>`
      : '');
    scene3d?.setCheckoutStatus?.(ped.queueStatus());
  }
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
  renderOverviewPreview(); renderPedestrianPanel(); renderHistory(); renderRestocks();
  const replay = !!state.replay;
  const exitBtn = $('exitReplayBtn'); if (exitBtn) exitBtn.hidden = !replay;
  const resetBtn = $('resetBtn'); if (resetBtn) resetBtn.textContent = replay ? '↺ 回到初始' : '↺ 重新开始';
  const nextBtn = $('nextOrderBtn'); if (nextBtn && replay) nextBtn.hidden = true;
  $('normalBtn')?.setAttribute('aria-pressed', String(state.scenario === 'normal'));
  $('peakBtn')?.setAttribute('aria-pressed', String(state.scenario === 'peak'));
  $('scenarioNormal').setAttribute('aria-pressed', String(state.scenario === 'normal'));
  $('scenarioPeak').setAttribute('aria-pressed', String(state.scenario === 'peak'));
  $('timeSlot').value = state.slot;
  drawCrowd(); drawRoutes(); drawDestinations(); drawRobot();
}
function renderScene() { renderAll(); }

/* ------------------------------------------- 返航 / 取消 / 订单状态持久化 */
function orderProgress() {
  if (!state.plan) return 0;
  const done = state.plan.legs.slice(0, state.stage).reduce((n, leg) => n + leg.length, 0);
  return Math.min(1, (done + state.legDistance) / Math.max(.001, state.plan.length));
}
function sampledPath() { return state.history.filter((_, i) => i % 6 === 0 || i === state.history.length - 1).slice(-400).map(p => [...p]); }

/**
 * 返航/回坞：沿真实 A* 路径驶向目标点（默认为机器人的充电桩对接位）。
 * options.target 可指定其它合法站点；options.purpose === 'charge' 时
 * 抵达后直接对接充电，而不是进入待命。
 */
const dockSlotPoint = () => {
  const dock = STORE.chargingDocks?.[0];
  return dock ? [...(dock.dockSlot || dock.position)] : [...STORE.robotWait];
};
function beginReturn(reason, from = state.displayPosition, viaExit = false, options = {}) {
  const robot = activeRobot();
  const target = options.target || robot.waitSlot;
  const purpose = options.purpose || 'park';
  const start = nearestNode(from);
  const fresh = planLeg(start, target, state.scenario, state.slot);
  if (!fresh) { log(`${reason}：无法计算返回充电桩的可行路径，机器人保持当前位置并请求人工介入。`, 'danger'); return false; }
  let points = [from, ...fresh.points.slice(1)];
  // V2.2：完成交接后先驶出右出口，在店外整备 3 秒，再经外侧通道从入口回归（V2.7 终点为充电桩对接位）。
  const o = STORE.outsideReturn;
  const toGate = viaExit ? planLeg(nearestNode(from), STORE.exit, state.scenario, state.slot) : null;
  const toBay = viaExit ? planLeg(STORE.entrance, target, state.scenario, state.slot) : null;
  if (viaExit) {
    if (toGate && toBay) {
      // V2.5：交接点已移到店内 [153,44]，出门后沿外墙南下 → 前墙外侧中央 staging 停 3 秒
      // → 继续西行 → 左入口回归。出口周边(门内/门外、行人出店 y=26)没有任何机器人停留点。
      points = [from, ...toGate.points.slice(1), o.exitOuter, o.rightSouth, o.staging, o.frontSouth,
        o.entranceOuter, STORE.entrance, ...toBay.points.slice(1)];
    } else log('外侧返回通道规划失败：改用店内 A* 路径返回充电桩。', 'warn');
  }
  const lengths = points.slice(1).map((p, i) => dist(points[i], p));
  // waitAt 为到达整备点 staging 的累计里程；到达后进入 3 秒等待，再继续外侧服务通道 → 入口 → 充电桩。
  let waitAt = 0;
  if (toGate && toBay) {
    const stagingIndex = points.findIndex(p => p[0] === o.staging[0] && p[1] === o.staging[1]);
    if (stagingIndex > 0) waitAt = lengths.slice(0, stagingIndex).reduce((a, b) => a + b, 0);
  }
  const wasRunning = state.running;
  state.returnLeg = { points, lengths, length: lengths.reduce((a, b) => a + b, 0), distance: 0,
    waitAt, waited: false, waitLeft: 0, target: [...target], purpose };
  state.returnReason = reason;
  state.running = true; state.lastFrame = 0; state.pauseLeft = 0;
  syncRobotPose(from, 'RETURNING', null);
  if (purpose === 'charge') {
    status('回坞充电', `${reason}：沿 A* 路径驶向 ${STORE.chargingDocks[0]?.id || '充电桩'}。`, 'MOVING');
    log(`${reason}：机器人从 (${from.map(n => n.toFixed(1)).join(', ')}) 沿导航图驶向充电桩对接位 (${target.map(n => n.toFixed(0)).join(', ')})，抵达后开始补电。`);
  } else {
    status('返回充电桩', `${reason}：沿 A* 路径返回充电桩待命位 ${target.map(n => n.toFixed(0)).join(', ')}。`, 'MOVING');
    log(`${reason}：机器人从 (${from.map(n => n.toFixed(1)).join(', ')}) ${viaExit ? '经右出口与外侧通道' : '沿店内真实路径'}返回充电桩待命位。`);
  }
  scene3d?.setRobots(robotFleetSnapshot());
  // 从空闲状态发起回坞时没有正在运行的动画循环，需要自己启动一次（配送中则由原循环接管）。
  if (!wasRunning) requestAnimationFrame(animate);
  renderAll(); return true;
}

/** 返航专用心跳：与订单配送共用行人、行为状态与真实路径，不瞬移。 */
function stepReturn(dt) {
  const step = Math.min(dt, .08);
  if (!state.returnLeg) return false;
  const leg = state.returnLeg, robot = activeRobot();
  state.pedSystem?.update(step, { position: state.displayPosition, velocity: state.inertialVelocity });
  const snapshot = publishPedestrians();
  const direction = legDirection(leg, leg.distance);
  const previous = [...state.displayPosition];
  const result = state.robotBrain.evaluate({ position: state.displayPosition, velocity: state.inertialVelocity,
    direction, pedestrians: snapshot, obstacles: state.dynamicObstacles, dt: step });
  state.behavior = result;
  // 店外整备：到达 staging（远离出口的前墙外侧服务通道中央）后停 3 秒（仿真时间，倍速下同步缩短），展示机器人离店且不挡出口。
  if (leg.waitAt > 0 && !leg.waited && leg.distance >= leg.waitAt - .01) {
    leg.waited = true; leg.waitLeft = 3;
    status('离店整备', '机器人已驶出出口并让开门口，在外侧整备 3 秒后从入口返回充电桩。', 'CHARGING');
    log('机器人已驶出右出口，在外侧远离出口处整备 3 秒（不再堵住出店口，随后从入口方向返回充电桩）。');
  }
  if (leg.waitLeft > 0) {
    leg.waitLeft = Math.max(0, leg.waitLeft - step);
    syncRobotPose(state.displayPosition, 'RETURNING', null);
    if (leg.waitLeft === 0) log('店外整备完成：机器人沿外侧通道从入口方向返回充电桩。');
    return true;
  }
  const travelledStep = step * BASE_SPEED * (result.speedFactor ?? 1);
  leg.distance = Math.min(leg.length, leg.distance + travelledStep);
  state.position = positionOnLeg(leg, leg.distance);
  state.displayPosition = [...state.position];
  state.inertialVelocity = [(state.position[0] - previous[0]) / step, (state.position[1] - previous[1]) / step];
  robot.distance += dist(previous, state.position);
  syncRobotPose(state.displayPosition, 'RETURNING', null);
  scene3d?.setRobots(robotFleetSnapshot());
  if (++state.uiTick % 6 === 0) { drawHistory(); renderPedestrianPanel(); }
  if (leg.distance >= leg.length - .001) {
    const target = leg.target || robot.waitSlot;
    state.displayPosition = [...target]; state.position = [...target];
    syncRobotPose(target, 'IDLE', null);
    state.returnLeg = null; state.running = false; state.finished = false;
    state.history = [[...target]]; state.legDistance = 0; state.behavior = null;
    scene3d?.setRobots(robotFleetSnapshot());
    if (leg.purpose === 'charge') {
      log(`${robot.id} 已抵达充电桩对接位，开始补电。`);
      attachCharger();
      return false;
    }
    log(`${robot.id} 已回到充电桩待命位，恢复待命状态。`);
    // V2.2：返航后不自动开始下一单，交由用户在订单页/3D 页手动点击「继续下一单」。
    state.nextAvailable = state.queue.length > 0;
    if (state.nextAvailable) status('等待下一订单', `${robot.id} 在充电桩待命，还有 ${state.queue.length} 单等待处理，请点击「继续下一单」。`, 'IDLE');
    else status('归位待命', `${robot.id} 已回到充电桩待命，暂无待处理订单。`, 'IDLE');
    renderAll();
    return false;
  }
  renderProgress(); renderRobotCenter();
  return true;
}

function cancelOrderById(id, reason = '用户取消订单') {
  const index = state.queue.findIndex(order => order.id === id);
  if (index >= 0) {
    const [order] = state.queue.splice(index, 1);
    order.status = '已取消'; order.cancelledAt = new Date().toISOString(); order.cancelProgress = 0;
    saveOrder(order); state.completed.push({ id, status: '已取消' });
    log(`${id} 已在队列中取消，数据已更新。`); renderAll(); return true;
  }
  if (!state.order || state.order.id !== id) return false;
  const order = state.order, progress = orderProgress();
  const cancelTime = new Date().toISOString();
  patchOrder(id, { status: '已取消', cancelledAt: cancelTime, cancelProgress: progress,
    cancelStage: state.stage, cancelPosition: [...state.displayPosition], path: sampledPath(), robotId: activeRobot().id });
  state.completed.push({ id, status: '已取消' });
  state.order = null; state.shortage = null; state.assistPending = null; state.awaitingPickup = false;
  state.bought = []; state.finished = false; state.stage = 0; state.legDistance = 0;
  log(`${id} 已取消：记录取消时间 ${new Date(cancelTime).toLocaleTimeString('zh-CN')}、取消前进度 ${(progress * 100).toFixed(0)}%。`);
  beginReturn(reason, state.displayPosition);
  renderAll(); return true;
}

/* ------------------------------------------------------- task state machine */
function resetPlayback(preserveSafety = false) {
  const fault = state.fault, dynamic = state.dynamicObstacles;
  state.running = false; state.finished = false; state.awaitingPickup = false;
  state.shortage = null; state.resolutions = new Map(); state.assistPending = null;
  state.assistedShelves = new Set(); state.blocked = false; state.fault = preserveSafety ? fault : '';
  state.stage = 0; state.legDistance = 0; state.pauseLeft = 0; state.slowLeft = 0;
  const waitSlot = activeRobot().waitSlot;
  state.elapsed = 0; state.lastFrame = 0; state.bought = [];
  state.position = [...waitSlot]; state.displayPosition = [...waitSlot];
  state.lateralOffset = 0; state.inertialVelocity = [0, 0]; state.lastLogic = [...waitSlot];
  state.history = [[...waitSlot]]; state.detected = new Set(); state.traveled = 0;
  state.returnLeg = null; state.returnReason = '';
  state.behavior = null; state.lastCollisionAt = -1;
  state.robotBrain?.reset();
  syncRobotPose(waitSlot, state.order ? 'ASSIGNED' : 'IDLE', state.order?.id || null);
  state.dynamicObstacles = preserveSafety ? dynamic : [];
  state.plan = state.order ? buildPlan(state.order.lines, state.scenario, state.slot, state.miningEnabled ? 'mining' : 'full') : null;
  state.normalPlan = state.order ? buildPlan(state.order.lines, 'normal', state.slot) : null;
  setText('playLabel', '开始履约'); setText('playIcon', '▶');
  status(state.order ? '已收到支付订单' : '等待订单',
    state.order ? '点击播放以检查载重并从充电桩出发。' : '请先选择商品并提交订单。', 'IDLE');
  if (state.fault) status('故障安全停车', faultAdvice[state.fault], 'FAULT');
  renderAll();
}
function actualPrice() { return state.bought.reduce((n, x) => n + x.product.price * x.qty, 0); }
/** V2.2：手动开启下一单。无排队订单时机器人保持归位休息，不发生任何跳转。 */
function startNextOrder() {
  if (!state.queue.length) {
    status('归位待命', '没有待处理的下一单，机器人在充电桩待命。', 'IDLE');
    log('点击了「继续下一单」，但队列为空，机器人继续在充电桩待命。');
    renderAll(); return false;
  }
  if (state.running) {
    status('配送进行中', '当前订单尚未完成，无法切换下一单。', 'MOVING');
    return false;
  }
  activateNext();
  state.nextAvailable = false;
  log(`已手动开启下一单 ${state.order?.id || '—'}，机器人开始新任务。`);
  NEXUS_UI?.showView('supermarket');
  scene3d?.setActive(true); scene3d?.resize();
  renderAll(); return true;
}
function activateNext() {
  const next = state.queue.shift() || null;
  if (next) {
    const robot = robotById(next.robotId) || assignRobot(next.lines);
    if (robot) {
      next.robotId = robot.id; robot.status = 'ASSIGNED'; state.activeRobotId = robot.id;
      next.robotName = robot.id; saveOrder(next);
    }
  }
  state.order = next; state.stockoutId = ''; resetPlayback();
  if (state.order) {
    log(`队列推进至 ${state.order.id}：已分配给 ${state.order.robotId || '待定机器人'}。`);
    if (orderWeight() > CAPACITY) status('无法出发 · 超载', `${kgText(orderWeight())} 超过 ${kgText(CAPACITY)} 上限。`, 'FAULT');
  }
}
/** 依据机器人等待区到首个货区的真实 A* 距离分配空闲机器人。 */
function assignRobot(lines) {
  const stops = uniqueStops(lines);
  // V2.7：停在充电桩上补电的机器人同样可以派单（充满后就在桩上待命，是默认空闲状态）。
  const candidates = state.fleet.filter(r => ['IDLE', 'ASSIGNED', 'CHARGING'].includes(r.status));
  if (!candidates.length) return null;
  let best = null, bestScore = Infinity;
  for (const robot of candidates) {
    const leg = stops.length ? planLeg(robot.waitSlot, stops[0].point, state.scenario, state.slot) : null;
    const score = (leg?.length ?? dist(robot.waitSlot, stops[0]?.point || STORE.exit)) + (robot.battery < 20 ? 400 : 0);
    if (score < bestScore) { bestScore = score; best = robot; }
  }
  best.status = 'ASSIGNED'; best.orderId = null;
  state.activeRobotId = best.id;
  return best;
}

function submitOrder() {
  const lines = cartLines();
  if (!lines.length || cartPrice() < MIN_ORDER || lines.some(x => x.qty > x.product.stock)) return;
  const id = nextOrderId(); state.orderCounter = Number(id.slice(3));
  const now = new Date().toISOString();
  const robot = assignRobot(lines);
  const order = {
    id, lines: lines.map(x => ({ product: x.product, qty: x.qty })), paid: cartPrice(),
    status: robot ? '待分配' : '待处理', createdAt: now, assignedAt: robot ? now : null,
    robotId: robot?.id || null, robotName: robot?.id || '待分配',
    start: [...(robot?.waitSlot || STORE.entrance)], end: [...STORE.handoff],
    path: [], startedAt: null, completedAt: null, cancelledAt: null,
    progress: 0, deliverSeconds: null, cancelProgress: null,
    scenario: state.scenario, slot: state.slot, // V2.4：回放保真——记录当时客流场景/时段
  };
  state.queue.push(order); state.cart.clear(); renderCart(); renderRecommendations();
  if (!state.order && robot) activateNext();
  else { state.nextAvailable = state.queue.length > 0; renderAll(); }
  saveOrder(state.order || order);
  const target = state.order === order ? order : null;
  const node = $('orderMessage');
  if (node) {
    node.innerHTML = `<b>${id} 创建成功</b> · ${money(order.paid)} · ${robot ? `已分配 ${robot.id}` : '等待空闲机器人'}<br>
      <button type="button" class="btn btn-teal btn-sm" data-view-demo="${id}">▶ 查看配送演示</button>`;
  }
  log(`${id} 已创建（${money(order.paid)}），${robot ? `已分配给 ${robot.id}` : `排队第 ${state.queue.length} 位`}；数据已持久化。`);
}
/**
 * 「平常客流 / 工作日高峰」不只改路径代价，还同步驱动行人密度：
 * 高峰 30 人 + 小篮快买（结账队列会真的排长），平常低密度 7 人。
 * 只调整密度与行为模式，不重置队伍，避免正在结账的顾客凭空消失。
 */
function syncCrowdToScenario() {
  const ped = state.pedSystem;
  if (!ped) return { peak: false, count: 0 };
  const peak = state.scenario === 'peak';
  ped.configure({ density: peak ? 'high' : 'low', mode: peak ? 'crowded' : 'shopping', running: true });
  state.pedRunning = true;
  state.pedDensity = ped.density;
  state.pedMode = ped.mode;
  const density = $('pedDensitySelect'); if (density) density.value = state.pedDensity;
  const mode = $('pedModeSelect'); if (mode) mode.value = state.pedMode;
  document.querySelectorAll('[data-ped-scenario]')
    .forEach(b => b.classList.toggle('is-active', b.dataset.pedScenario === (peak ? 'peak' : 'normal')));
  publishPedestrians();
  const queue = ped.queueStatus();
  return { peak, count: ped.people.length, queued: queue.size };
}
function updateScenario(source = 'manual') {
  if (state.order && !state.awaitingPickup) resetPlayback(true);
  const crowd = syncCrowdToScenario();
  scene3d.setScenario?.(state.scenario, state.slot);
  if (source === 'manual') {
    const label = state.scenario === 'peak' ? '工作日高峰' : '平常客流';
    const flow = crowd.peak ? `门店人流已加密至 ${crowd.count} 位顾客，收银台按先进先出排队结账。` : '门店恢复低密度客流，队列逐步缩短。';
    log(`场景已切换为${label}（${state.slot}）：候选路径已重新计算；${flow}`);
  }
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
  saveInventory([...productById.values()]); syncShelfStock();
  if (state.order) patchOrder(state.order.id, { progress: orderProgress(), stage: state.stage, path: sampledPath() });
  renderInventory(); renderAll();
}
function requestPickupAssist(stop, wasRunning) {
  // V2.2：所有商品由机械臂自动取货，配送途中不再打断用户请求协助。
  // 员工协助仅发生在「补货」作业（库存管理页的人工确认），与订单配送解耦。
  return false;
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
  state.position = [...(index < stops.length ? stops[index].point : index === stops.length ? STORE.checkout : STORE.handoff)];
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
    status('结账完成', '机器人前往店内取货交接区（出口通道保持畅通）。', 'PICKING');
    state.pauseLeft = .8; state.stage++; renderAll();
  } else {
    state.running = false; state.finished = true; state.awaitingPickup = true; state.stage++;
    log('机器人已在收银台完成结账并驶入店内取货交接区；平台已收到「结账完成」消息，等待操作员点击「确认取货」。');
    status('等待确认取货', `订单 ${state.order.id} 已结账并备好，点击「确认取货」后机器人返回充电桩补电。`, 'CHARGING');
    setText('playLabel', '等待交接'); setText('playIcon', '✓'); renderAll();
  }
  if (state.order) setText('orderMessage', `${state.order.id}：${state.awaitingPickup
    ? '平台已收到结账完成消息，等待你点击「确认取货」→ 机器人返回充电桩补电。' : '机器人履约中'}；仅为模拟支付。`);
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
  log(`取货交接完成：${finished.id} 已取走，最终模拟金额 ${money(actualPrice())}。`);
  patchOrder(finished.id, { status: '已完成', completedAt: new Date().toISOString(),
    deliverSeconds: state.elapsed, path: sampledPath(), progress: 1, robotId: activeRobot().id });
  state.completed.push({ id: finished.id, status: '已完成' });
  state.order = null; state.awaitingPickup = false; state.stockoutId = '';
  syncRobotPose(state.displayPosition, 'RETURNING', null);
  setText('orderMessage', `${finished.id} 已确认取货，机器人正在返回充电桩并补电。`);
  // V2.7：确认后不再停在收银区/泊位，直接回充电桩对接位，抵达后自动补电。
  beginReturn('配送完成', state.displayPosition, true, { target: dockSlotPoint(), purpose: 'charge' });
  renderAll();
}
function cancelOrder(id) {
  const index = state.queue.findIndex(order => order.id === id); if (index < 0) return;
  state.queue.splice(index, 1); state.completed.push({ id, status: 'Cancelled' }); renderAll(); log(`${id} 已从队列中取消。`);
}
function cancelActive() {
  if (!state.order) return;
  cancelOrderById(state.order.id, '用户取消配送任务');
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
      Math.max(8, Math.min(STORE.height - 8, state.position[1] + (nextPoint[1] - state.position[1]) * .55))];
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
    const edge = [[STORE.hotCorridor.xMin + 15, STORE.hotCorridor.y], [STORE.hotCorridor.xMin + 35, STORE.hotCorridor.y]], id = edgeKey(...edge);
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
  if (state.returnLeg) return stepReturn(dt);
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

  // 1) 机器人播放时由此推进行人（未播放时由 pedestrianLoop 推进），两者互斥。
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
  // 3D 模型、跟随相机与舰队面板都读取舰队位姿；配送中必须逐帧同步，否则只有路径在动、机器人停在泊位。
  const active = activeRobot();
  // V2.4：把全局仿真电量同步到当前机器人，使舰队面板/调度打分/3D 显示都反映真实电量。
  active.battery = state.battery;
  active.distance += travelled;
  syncRobotPose(state.displayPosition, robotState(), state.order?.id);
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
/** 时间缩放核心：倍速只增加每个真实帧内的仿真子步数量，物理步长始终 ≤ 1/60 s。
 *  因此高速下导航、避障、TTC、碰撞检测、状态机与库存规则全部按同一仿真时间逐帧执行。 */
function scaledSubsteps(realDelta) {
  const total = Math.min(realDelta, .05) * state.simSpeed;
  const sub = 1 / 60;
  return { count: Math.max(1, Math.ceil(total / sub)), step: Math.min(sub, total || sub) };
}
function animate(now) {
  if (!state.running || state.replay) return; // 回放由 replayLoop 独立驱动，主仿真心跳不介入
  if (!state.lastFrame) state.lastFrame = now;
  const delta = (now - state.lastFrame) / 1000;
  state.lastFrame = now;
  const { count, step } = scaledSubsteps(delta);
  for (let i = 0; i < count && state.running; i++) stepSimulation(step);
  if (state.running) requestAnimationFrame(animate);
}

/* 行人自主循环：与机器人订单播放解耦。机器人未播放时由本循环独立推进行人；
   机器人播放（含 advance 快进测试）时由 stepSimulation 推进，避免重复更新。 */
let pedLastFrame = 0, pedLoopTick = 0;
function pedestrianLoop(now) {
  requestAnimationFrame(pedestrianLoop);
  const ped = state.pedSystem;
  if (!ped || !ped.running || document.hidden || state.running) { pedLastFrame = 0; return; }
  if (!pedLastFrame) { pedLastFrame = now; return; }
  const dt = Math.min((now - pedLastFrame) / 1000, .05);
  pedLastFrame = now;
  const { count, step } = scaledSubsteps(dt);
  for (let i = 0; i < count; i++) ped.update(step, { position: state.displayPosition, velocity: [0, 0] });
  publishPedestrians();
  if (++pedLoopTick % 6 === 0) renderPedestrianPanel();
  // 数字孪生平面图 / 2D 导航地图保持「实时」：行人走动、排队人数变化时同步刷新（约 5 Hz）。
  if (pedLoopTick % 12 === 0) { renderOverviewPreview(); drawCrowd(); }
}
function startPedestrianLoop() { requestAnimationFrame(pedestrianLoop); }
function playPause() {
  // V2.4 只读回放：独立播放/暂停，不进入订单状态机，绝不 patchOrder。
  // V2.7：回放优先于「暂停充电」——看历史回放不应被桩上的充电状态挡住。
  if (state.replay) {
    const r = state.replay;
    if (r.playing) {
      r.playing = false; state.running = false; r.lastFrame = 0;
      setText('playLabel', '继续回放'); setText('playIcon', '▶');
      status('回放暂停', `${r.id} 停在 ${(r.progress * 100).toFixed(0)}%。`, 'CHARGING');
    } else {
      if (r.progress >= 1) { r.progress = 0; r.lastFrame = 0; }
      r.playing = true; state.running = true; r.lastFrame = 0;
      setText('playLabel', '暂停回放'); setText('playIcon', 'Ⅱ');
      status('配送回放', `${r.id} 正在沿记录轨迹回放。`, 'RETURNING');
      requestAnimationFrame(replayLoop);
    }
    return;
  }
  // V2.7 充电中：若已有待执行订单，这一次点击就直接「结束充电 + 从充电桩出发」；
  // 没有订单时仍作为「暂停充电」。下一单因此永远从充电桩起步，无需再回泊位。
  if (state.charging?.active) {
    const hasOrder = !!state.order && !state.awaitingPickup;
    stopCharging(hasOrder ? '接单出发' : '已暂停');
    if (!hasOrder || state.returnLeg) return;
  }
  if (state.shortage) { status('请先处理缺货', '请在任务面板选择接受替代品或跳过。', 'PICKING'); return; }
  if (state.assistPending) { status('请确认协助取货', '员工核对商品后机器人才能移动。', 'PICKING'); return; }
  if (state.fault || state.events.has('failure')) { status('故障安全停车', faultAdvice[state.fault || 'localization'], 'FAULT'); return; }
  if (state.awaitingPickup) { status('请确认取货', '平台已收到结账完成消息，请点击「确认取货」，机器人随后返回充电桩。', 'CHARGING'); return; }
  if (!state.order) { status('请先提交订单', '选择商品并模拟支付后才能启动机器人。', 'IDLE'); log('没有已支付订单，机器人停留在充电桩待命。'); return; }
  if (orderWeight() > CAPACITY) { status('无法出发 · 超载', `${kgText(orderWeight())} 超过 ${kgText(CAPACITY)}。`, 'FAULT'); log('载重检查未通过，机器人停留在充电桩。', 'danger'); return; }
  if (state.running) {
    state.running = false; state.lastFrame = 0; setText('playLabel', '继续履约'); setText('playIcon', '▶');
    status('仿真已暂停', '点击继续从当前位置恢复。', 'IDLE');
    renderProgress(); renderQueue(); return;
  }
  // V2.7：接单出发 —— 充电已在 playPause 入口处结束，此处只记录从充电桩起步。
  if (state.stage === 0 && state.elapsed === 0) log(`从充电桩对接位 ${state.displayPosition.map(n => n.toFixed(0)).join(', ')} 出发。`);
  if (state.stage === 0 && state.elapsed === 0) {
    log(`载重检查通过：${kgText(orderWeight())} / ${kgText(CAPACITY)}。`);
    log(`${state.plan.method}；共 ${state.plan.stops.length} 个货区；A* 已完成逐段规划。`);
    patchOrder(state.order.id, { status: '配送中', startedAt: new Date().toISOString(), robotId: activeRobot().id });
    syncRobotPose(state.position, 'BUSY', state.order.id);
    state.order.status = '配送中';
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
  $('resetBtn').addEventListener('click', () => {
    if (exitReplay()) { log('已退出回放，机器人归位待命。'); return; }
    resetPlayback(); log('当前订单已重新开始，机器人已返回入口。');
  });
  $('exitReplayBtn')?.addEventListener('click', () => { if (exitReplay()) log('已退出回放，订单状态保持不变。'); });
  $('safetyTestBtn')?.addEventListener('click', toggleBlock);
  $('cameraResetBtn').addEventListener('click', () => setCamera('full'));
  $('cameraFull')?.addEventListener('click', () => setCamera('full'));
  $('cameraIso')?.addEventListener('click', () => setCamera('iso'));
  $('cameraTop')?.addEventListener('click', () => setCamera('top'));
  $('cameraFollow')?.addEventListener('click', () => setCamera('follow'));
  $('cameraClose')?.addEventListener('click', () => setCamera('close'));
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
    const demoId = event.target.closest('[data-demo]')?.dataset.demo;
    if (demoId) viewOrderDemo(demoId);
    if (event.target.closest('[data-next-order]')) startNextOrder();
    if (event.target.closest('[data-goto-3d]')) { NEXUS_UI?.showView('supermarket'); scene3d?.setActive(true); scene3d?.resize(); }
  });
  $('nextOrderBtn')?.addEventListener('click', startNextOrder);
  $('gotoOrderBtn')?.addEventListener('click', () => NEXUS_UI?.showView('order'));
  $('chargeBtn')?.addEventListener('click', () => { if (state.charging?.active) stopCharging('已暂停'); else startCharging(); });
  $('miningToggleBtn')?.addEventListener('click', () => {
    state.miningEnabled = !state.miningEnabled;
    if (state.order) resetPlayback();
    log(state.miningEnabled ? '已启用实验驱动规划：Apriori 共购规则参与 Held–Karp 访问顺序决策。' : '已关闭实验驱动规划，恢复常规几何代价。');
    renderMiningPanel();
  });
  $('orderMessage')?.addEventListener('click', event => {
    const demoId = event.target.closest('[data-view-demo]')?.dataset.viewDemo;
    if (demoId) viewOrderDemo(demoId);
  });
  // 订单历史：筛选、排序、详情、3D 回放。
  $('historyStatusFilter')?.addEventListener('change', event => { state.historyFilter = event.target.value; renderHistory(); });
  $('historySort')?.addEventListener('change', event => { state.historySort = event.target.value; renderHistory(); });
  $('historyTable')?.addEventListener('click', event => {
    const detailId = event.target.closest('[data-history-detail]')?.dataset.historyDetail;
    if (detailId) showOrderDetail(detailId);
    const demoId = event.target.closest('[data-history-demo]')?.dataset.historyDemo;
    if (demoId) viewOrderDemo(demoId);
  });
  // 手动 / 自动补货。
  $('manualRestockBtn')?.addEventListener('click', () => {
    const product = productById.get($('restockProduct')?.value);
    const qty = Math.max(0, Math.floor(Number($('restockQty')?.value) || 0));
    if (!product || !qty) { setText('restockMessage', '请选择商品并输入大于 0 的补货数量。'); return; }
    const shelfId = $('restockShelf')?.value || product.shelfId;
    const priority = $('restockPriority')?.value || 'normal';
    const record = applyRestock(product, qty, shelfId, priority, '手动');
    setText('restockMessage', record ? `${product.name} 已手动补货 ${record.quantity} 件（${record.before} → ${record.after}），3D 货架已同步。` : '补货失败，请重试。');
  });
  $('autoRestockBtn')?.addEventListener('click', autoRestock);
  document.querySelectorAll('[data-event]').forEach(button => button.addEventListener('click', () => handleSimEvent(button.dataset.event)));
  $('pedStartBtn')?.addEventListener('click', () => { state.pedSystem.start(); state.pedRunning = true; log('行人仿真已启动。'); renderPedestrianPanel(); });
  $('pedPauseBtn')?.addEventListener('click', () => { state.pedSystem.pause(); state.pedRunning = false; log('行人仿真已暂停，行人保持当前位置。'); renderPedestrianPanel(); });
  $('pedResetBtn')?.addEventListener('click', () => applyPedPreset('normal'));
  $('pedDensitySelect')?.addEventListener('change', event => { state.pedDensity = event.target.value; state.pedSystem.setDensity(state.pedDensity); renderPedestrianPanel(); });
  document.querySelectorAll('[data-sim-speed]').forEach(btn =>
    btn.addEventListener('click', () => setSimSpeed(btn.dataset.simSpeed)));
  $('robotCountSelect')?.addEventListener('change', event => setRobotCount(event.target.value));
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
function setSimSpeed(value) {
  const speed = [1, 2, 3, 5].includes(Number(value)) ? Number(value) : 1;
  state.simSpeed = speed;
  setText('simSpeedBadge', `${speed}×`);
  document.querySelectorAll('[data-sim-speed]').forEach(btn =>
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.simSpeed) === speed)));
  log(`演示速度已设为 ${speed}×：仅缩放仿真时间，路径规划/避障/TTC/订单与库存规则不变。`);
}

/* -------------------------------------------------- V2.4 机器人充电闭环 */
/** 仿真电量是单一真源；把当前值同步到舰队中指定机器人，供面板/调度/3D 使用。 */
function syncBattery(robot) {
  const target = robot || activeRobot();
  if (target) target.battery = state.battery;
  scene3d?.setRobots(robotFleetSnapshot());
}
/** 对接充电桩：机器人停在桩体正前方的对接位（不与桩体穿模）后开始补电。 */
function attachCharger() {
  const robot = activeRobot();
  const dock = STORE.chargingDocks[0];
  if (!dock) return false;
  // V2.7：对接位与桩体中心错开 5.4 单位，车体与桩体底座之间保留约 1.0 单位净空，
  // 因此这里落位用的是 dockSlot 而不是桩体坐标（旧版本直接落在桩体上会穿模）。
  const slot = dock.dockSlot || dock.position;
  robot.position = [...slot]; state.position = [...slot]; state.displayPosition = [...slot];
  state.inertialVelocity = [0, 0];
  syncRobotPose(state.displayPosition, 'CHARGING', null);
  state.running = false;
  state.charging = { active: true, robotId: robot.id, lastFrame: 0, rate: 6 }; // 每秒 +6%（仿真时间）
  scene3d?.setCharging?.(true);
  setText('playLabel', '暂停充电'); setText('playIcon', 'Ⅱ');
  status('充电中', `${robot.id} 已在 ${dock.id} 对接补电：${state.battery.toFixed(0)}% → 100%，充满后继续在桩上待命。`, 'CHARGING');
  log(`${robot.id} 已对接 ${dock.id}（对接位 ${slot.map(n => n.toFixed(0)).join(', ')}，与桩体保持净空），开始补电（当前 ${state.battery.toFixed(0)}%）。`, 'ok');
  requestAnimationFrame(chargeLoop);
  renderAll();
  return true;
}

/** 开始充电：机器人先沿 A* 导航图真实行驶到充电桩对接位，再对接补电（不瞬移）。 */
function startCharging() {
  if (state.replay) { status('回放中不可充电', '请先退出回放。', 'CHARGING'); return false; }
  if (state.running) { status('请先暂停履约', '机器人配送途中无法回坞，请先暂停或等待配送完成。', 'FAULT'); return false; }
  const robot = activeRobot();
  const dock = STORE.chargingDocks[0];
  if (!dock) { log('未配置充电桩，无法充电。', 'warn'); return false; }
  if (state.battery >= 99.5) { status('电量已充满', `当前电量 ${state.battery.toFixed(0)}%，无需充电。`, 'IDLE'); return false; }
  const slot = dock.dockSlot || dock.position;
  if (dist(state.displayPosition, slot) < 2.6) return attachCharger();
  log(`${robot.id} 从 ${state.displayPosition.map(n => n.toFixed(0)).join(', ')} 回坞充电，沿导航图驶向 ${dock.id}。`);
  return beginReturn('回坞充电', state.displayPosition, false, { target: slot, purpose: 'charge' });
}
function stopCharging(reason = '手动停止') {
  if (!state.charging) return;
  state.charging.active = false; state.charging = null;
  scene3d?.setCharging?.(false);
  setText('playLabel', '开始履约'); setText('playIcon', '▶');
  status('充电结束', `${reason}，当前电量 ${state.battery.toFixed(0)}%，机器人留在充电桩待命。`, 'IDLE');
  log(`充电结束（${reason}），电量 ${state.battery.toFixed(0)}%；机器人停在充电桩待命，下一单从这里出发。`, 'ok');
  syncBattery();
  // V2.7：充电桩对接位就是机器人的常驻待命位，充电结束后不再挪回其它泊位。
  const robot = activeRobot(), slot = STORE.chargingDocks[0]?.dockSlot || robot.waitSlot;
  if (dist(state.displayPosition, slot) > 2.6) {
    beginReturn('充电结束', state.displayPosition, false, { target: slot, purpose: 'park' });
    return;
  }
  renderAll();
}
function chargeLoop(now) {
  const c = state.charging;
  if (!c || !c.active) return;
  if (!c.lastFrame) c.lastFrame = now;
  const dt = Math.min((now - c.lastFrame) / 1000, .05) * state.simSpeed;
  c.lastFrame = now;
  state.battery = Math.min(100, state.battery + c.rate * dt);
  syncBattery();
  renderRobotCenter(); renderLiveOps(); renderProgress();
  if (state.battery >= 100) { stopCharging('已充满'); return; }
  requestAnimationFrame(chargeLoop);
}
function setRobotCount(value) {
  const count = Math.max(1, Math.min(2, Number(value) || 1));
  if (state.running || state.returnLeg) { setText('robotCountStatus', '请先暂停当前履约再修改机器人数量'); return; }
  setSetting('robotCount', count);
  state.fleet = STORE.robotWaitSlots.slice(0, count).map((slot, i) => ({ id: `AMR-${String(i + 1).padStart(2, '0')}`,
    position: [...slot], waitSlot: [...slot], status: 'IDLE', battery: 100, distance: 0, orderId: null }));
  state.activeRobotId = state.fleet[0].id;
  scene3d?.setFleetCount(count);
  const select = $('robotCountSelect'); if (select) select.value = String(count);
  setText('robotCountStatus', `配置已持久化 · 当前 ${count} 台`);
  setText('fleetBadge', `仿真 ${state.fleet.map(r => r.id).join(' / ')} · ${count} 台`);
  updateBrandRobotImage(document, 0);
  resetPlayback();
  log(`机器人数量已配置为 ${count} 台，泊位互不重叠；刷新页面后仍保留。`);
}
function setCamera(mode) {
  scene3d.setCameraMode(mode);
  const views = ['full', 'iso', 'top', 'follow', 'close'];
  views.forEach(v => $(`camera${v[0].toUpperCase()}${v.slice(1)}`)?.setAttribute('aria-pressed', String(v === mode)));
}

/* 自动化回归测试钩子：所有数值直接来自运行中的仿真状态，不另造指标。 */
window.__NEXUS = Object.freeze({
  state, STORE,
  applyPedPreset,
  setScenario: value => { state.scenario = value === 'peak' ? 'peak' : 'normal'; updateScenario('test'); return syncCrowdToScenario(); },
  setSimSpeed, setRobotCount, startNextOrder, activateNext,
  viewOrderDemo, exitReplay, startReplay,
  startCharging, stopCharging, associationWeight, matchedAssociations,
  replayTick: dt => { // 测试用：同步推进回放 dt 秒（不依赖 rAF 时钟）
    const r = state.replay; if (!r || !r.playing) return null;
    r.progress = Math.min(1, r.progress + dt / r.duration);
    const d = r.progress * (r.path.length - 1), i = Math.min(r.path.length - 2, Math.floor(d)), t = d - i;
    const a = r.path[i], b = r.path[i + 1], pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    state.displayPosition = [...pos];
    const robot = robotById(r.robotId); if (robot) robot.position = [...pos];
    syncRobotPose(state.displayPosition, 'RETURNING', r.id);
    return { progress: r.progress, position: pos };
  },
  armInfo: id => scene3d?.getRobotArmInfo?.(id),
  debugFaceCamera: () => scene3d?.debugFaceCamera?.(),
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
      pedestrianYields: ped?.metrics.pedestrianYields || 0,
      detours: ped?.metrics.detours || 0,
      bypasses: brain?.metrics.bypasses || 0,
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
applyBrandAssets(document);
scene3d = createStoreScene($('scene3d'), $('storeMap'));
scene3d.setFleetCount(state.fleet.length);
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
startPedestrianLoop();
scene3d.setScenario(state.scenario, state.slot);
// 恢复统一数据层的持久化库存与历史/补货记录，避免刷新后丢失。
hydrateInventory([...productById.values()]);
if ($('historyStatusFilter')) $('historyStatusFilter').value = state.historyFilter;
if ($('historySort')) $('historySort').value = state.historySort;
drawBaseMap(); drawFixtures(); populateFilters(); renderCatalogue(); renderCart();
renderInventory(); renderRecommendations(); renderCrowd(); resetPlayback(); bindEvents();
initRestockControls(); renderHistory(); renderRestocks();
if ($('robotCountSelect')) $('robotCountSelect').value = String(state.fleet.length);
setText('robotCountStatus', `配置已持久化 · 当前 ${state.fleet.length} 台`);
setText('fleetBadge', `仿真 ${state.fleet.map(r => r.id).join(' / ')} · ${state.fleet.length} 台`);
setSimSpeed(1);
applyBrandAssets(document);
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
  initRestockControls();
  log(`真实商品目录已加载：${data.summary.products.toLocaleString()} 件商品，${data.rules.ruleCount.toLocaleString()} 条 Apriori 规则。`);
}).catch(error => {
  $('catalogue').textContent = `真实数据加载失败：${error.message}`;
  setText('miningMethod', '真实分析数据不可用，请检查 public/data 目录。');
  console.error(error);
});
