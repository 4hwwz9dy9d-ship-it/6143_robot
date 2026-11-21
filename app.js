// NEXUS RETAIL — order system, algorithms, task state machine and view binding.
// REAL DATA: public/data JSON (Instacart). CALCULATED: Held-Karp, A*, Apriori, K-means.
// SIMULATED: shelves, stock, crowd, obstacles, robot motion, battery and timings.
import { createStoreScene } from './scene3d.js';
import { STORE, shelves, layoutFixtures, products, timeSlots, crowdSamples, shelfCrowd, peopleForScenario } from './storeData.js';
import { loadResearch, searchCatalog, convertProduct, propertyLabels, renderResearchDashboard, escapeHtml } from './instacart.js';
import { getObstacleSnapshot, registerSensorProvider } from './sensorAdapter.js';

const $ = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const CAPACITY = 12, MIN_ORDER = 30;
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
};

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
  setText('logCount', `${state.logs.length} entries`);
}
function status(title, detail, motion) {
  setText('currentAction', title); setText('currentDetail', detail);
  setText('motionStatus', `STATE: ${motion}`);
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
  return { cold, assist, label: assist ? `Employee assisted${cold ? ' · cold chain' : ''}` : 'Automatic pick (simulated)' };
}
function robotState() {
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
  if (state.order) setText('orderMessage', 'Draft cart for the next order. The paid order and robot task are unchanged.');
}
function renderCatalogue() {
  $('catalogue').innerHTML = catalogResults.map(p => {
    const labels = propertyLabels(p);
    return `<article class="product-card"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.category)} → ${escapeHtml(p.subcategory)} · Instacart ID ${p.sourceId}<br>Zone ${p.shelfId} · node (${p.point.join(', ')}) · simulated stock ${p.stock}/${p.capacity}<br>Est. $${p.priceUsd?.toFixed(2) ?? '—'} (${labels.price}); est. ${p.weightG?.toFixed(0) ?? '—'} g (${labels.weight})<br>Train frequency ${(p.frequency ?? 0).toLocaleString()} · reorder ${p.reorderRate == null ? 'n/a' : `${(p.reorderRate * 100).toFixed(1)}%`}</small></div>
      <div class="product-buy"><span>${money(p.price)} · ${kgText(p.weight)}</span><button type="button" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add' : 'Out of stock'}</button></div></article>`;
  }).join('') || '<p class="empty">No product matched. Try an English product name or change the filters.</p>';
}
function renderCart() {
  const lines = cartLines();
  $('cartList').innerHTML = lines.length ? lines.map(({ product: p, qty }) =>
    `<div class="cart-line"><div><b>${escapeHtml(p.name)} × ${qty}</b><small>Zone ${p.shelfId} · ${money(p.price * qty)} · ${kgText(p.weight * qty)}</small></div>
     <div class="qty-controls"><button type="button" data-minus="${p.id}" aria-label="Decrease ${escapeHtml(p.name)}">−</button><button type="button" data-plus="${p.id}" aria-label="Increase ${escapeHtml(p.name)}">＋</button></div></div>`).join('')
    : '<p class="empty">Cart is empty. Load the sample basket or search the catalog.</p>';
  const price = cartPrice();
  setText('cartSummary', `${lines.reduce((n, x) => n + x.qty, 0)} items · ${money(price)} · ${kgText(cartWeight())}`);
  setText('cartTotal', money(price));
  setText('cartCountPill', `${lines.reduce((n, x) => n + x.qty, 0)} ITEMS`);
  const shortage = lines.some(x => x.qty > x.product.stock);
  $('submitOrderBtn').disabled = !lines.length || price < MIN_ORDER || shortage;
  setText('minimumNotice', shortage ? 'Requested quantity exceeds simulated stock. Reduce the quantity or wait for restock.'
    : price < MIN_ORDER ? `${money(MIN_ORDER - price)} below the ${money(MIN_ORDER)} minimum order.` : `${money(MIN_ORDER)} minimum reached.`);
  $('minimumNotice').classList.toggle('is-error', shortage || price < MIN_ORDER);
}
function ruleMetrics(rule) { return `Support ${(rule.support * 100).toFixed(3)}% · Confidence ${(rule.confidence * 100).toFixed(1)}% · Lift ${rule.lift.toFixed(2)}`; }
function renderRules() {
  if (!research) return;
  setText('miningMethod', `Apriori on ${research.rules.baskets.toLocaleString()} real train baskets; ${research.rules.ruleCount.toLocaleString()} rules over ${research.rules.candidateProducts} candidate products (min support count ${research.rules.minSupportCount}). Co-purchase is not causation.`);
  $('ruleTable').innerHTML = rules.filter(r => r.confidence >= .15).slice(0, 5).map(r =>
    `<div class="rule-row"><b>${escapeHtml(productById.get(r.from)?.name ?? r.from)} → ${escapeHtml(productById.get(r.to)?.name ?? r.to)}</b><small>${ruleMetrics(r)}</small></div>`).join('')
    || '<p class="empty">No rule above the current confidence threshold.</p>';
  const seen = new Set();
  const suggestions = rules.filter(r => {
    const pair = [r.from, r.to].sort().join('|');
    if (r.lift <= 1 || r.confidence < .15 || seen.has(pair) || !productById.get(r.from) || !productById.get(r.to)) return false;
    seen.add(pair); return true;
  }).slice(0, 5).map(r => `<li>${escapeHtml(productById.get(r.from).name)} + ${escapeHtml(productById.get(r.to).name)} — consider adjacent display; manual review of cold/food/household separation and aisle width still required.</li>`);
  $('shelfSuggestions').innerHTML = `<p class="assumption">Real co-purchase results; layout advice requires human review.</p><ul>${suggestions.join('') || '<li>No qualifying rule in the current candidate set.</li>'}</ul>`;
}
function renderRecommendations() {
  const ids = new Set(cartLines().map(x => x.product.id));
  const found = rules.filter(r => ids.has(r.from) && !ids.has(r.to) && r.confidence >= .1 && productById.get(r.to)).slice(0, 3);
  $('recommendations').innerHTML = found.length ? found.map(r =>
    `<div class="recommend-item"><div><b>${escapeHtml(productById.get(r.to).name)}</b><small>Bought with ${escapeHtml(productById.get(r.from).name)} · ${ruleMetrics(r)}</small></div><button type="button" data-add="${r.to}">Add</button></div>`).join('')
    : '<p class="empty">Add a high-frequency product to see real basket-based recommendations.</p>';
}
function renderCrowd() {
  const sample = crowdSamples[state.slot], total = sample.reduce((a, b) => a + b, 0);
  setText('crowdSummary', `${timeSlots.find(x => x.id === state.slot).label}: ${total} simulated people near 18 zones. 0–2 low, 3–4 medium, 5+ congested.`);
  $('crowdTable').innerHTML = shelves.map((s, i) =>
    `<div class="crowd-cell ${sample[i] >= 5 ? 'kpi--danger' : sample[i] >= 3 ? 'kpi--warn' : ''} kpi" style="padding:9px"><div class="kpi-label">${s.id} · ${sample[i]} ppl</div><div style="font-size:10px;font-weight:700;margin-top:3px">${escapeHtml(s.category)}</div></div>`).join('');
  scene3d?.setScenario(state.scenario, state.slot);
}

/* ------------------------------------------------------------ inventory */
function renderInventory() {
  const alerts = alertProducts();
  $('inventoryAlerts').innerHTML = alerts.length ? alerts.map(p =>
    `<div class="alert-item ${p.stock === 0 ? 'is-out' : ''}"><div><b>${escapeHtml(p.name)}</b><p>${p.stock}/${p.capacity} units · ${p.stock ? 'Low stock' : 'Out of stock'} · simulated inventory · zone ${p.shelfId}</p></div><button class="btn btn-secondary btn-sm" type="button" data-restock="${p.id}">Confirm restock</button></div>`).join('')
    : '<p class="empty">No product is below 10% simulated capacity.</p>';
  $('inventoryTable').innerHTML = [...productById.values()].slice(0, 90).map(p => {
    const pct = p.stock / p.capacity;
    return `<tr><td><b>${escapeHtml(p.name)}</b></td><td>${escapeHtml(p.category)} · ${p.shelfId}</td><td class="right num">${p.stock}/${p.capacity}</td><td><span class="pill ${pct === 0 ? 'pill--danger' : pct < .1 ? 'pill--warn' : 'pill--ok'}">${pct === 0 ? 'OUT' : pct < .1 ? 'LOW' : 'OK'}</span></td></tr>`;
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
  log(`${product.name} restocked to ${product.capacity} units by employee (simulation).`);
  renderInventory(); renderLiveOps();
}

/* ------------------------------------------------- navigation graph / A* */
function edgeKey(a, b) { const ka = key(a), kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; }
function graph() {
  const nodes = new Map();
  function edge(a, b) {
    for (const p of [a, b]) if (!nodes.has(key(p))) nodes.set(key(p), { point: p, neighbors: [] });
    nodes.get(key(a)).neighbors.push(key(b)); nodes.get(key(b)).neighbors.push(key(a));
  }
  const bottom = [STORE.entrance[0], ...STORE.aisleXs, STORE.checkout[0], STORE.exit[0]];
  for (let i = 1; i < bottom.length; i++) edge([bottom[i - 1], 8], [bottom[i], 8]);
  for (const y of STORE.crossYs.slice(1)) for (let i = 1; i < STORE.aisleXs.length; i++) edge([STORE.aisleXs[i - 1], y], [STORE.aisleXs[i], y]);
  for (const x of STORE.aisleXs) for (let i = 1; i < STORE.verticalYs.length; i++) edge([x, STORE.verticalYs[i - 1]], [x, STORE.verticalYs[i]]);
  return nodes;
}
const nodes = graph();
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
  let method = 'Held–Karp exact visit order';
  if (n > 12) {
    method = 'Nearest-cost heuristic (NOT globally optimal)';
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
  if (!fresh) { state.running = false; status('No safe route', 'The aisle closure disconnected the current target. Robot safe-stopped.', 'SAFE STOP'); log(`${reason}: no safe alternative route; robot stopped.`, 'danger'); return false; }
  leg.points = [state.position, ...fresh.points.slice(1)];
  leg.lengths = leg.points.slice(1).map((p, i) => dist(leg.points[i], p));
  leg.length = fresh.length; state.legDistance = 0;
  drawRoutes(); log(`${reason}: A* replanned the active leg (${fresh.length.toFixed(1)} map units).`, 'warn');
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
    svg('text', { x: left + width / 2, y: top + height / 2 - 5, class: 'shelf-caption' }, $('shelves')).textContent = s.category;
    svg('text', { x: left + width / 2, y: top + height / 2 + 13, class: 'shelf-code' }, $('shelves')).textContent = `ZONE ${s.id}`;
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
  drawGate(STORE.entrance, 'IN'); drawGate(STORE.checkout, 'PAY'); drawGate(STORE.exit, 'OUT');
  scene3d?.setPickups(stops.map(s => s.point), Math.min(state.stage, stops.length));
}
function drawCrowd() {
  clear($('crowd'));
  const counts = crowdSamples[state.slot];
  shelves.forEach((s, i) => {
    svg('rect', { x: s.xMin * 10, y: (90 - s.yMax) * 10, width: (s.xMax - s.xMin) * 10, height: (s.yMax - s.yMin) * 10,
      fill: counts[i] >= 5 ? '#e2734b' : counts[i] >= 3 ? '#e8a34a' : '#71b887', opacity: counts[i] >= 5 ? .32 : .17, rx: 5 }, $('crowd'));
  });
  for (const p of [...peopleForScenario(state.scenario, state.slot), ...state.dynamicObstacles]) {
    svg('circle', { cx: p.point[0] * 10, cy: (90 - p.point[1]) * 10, r: 12, class: 'crowd-halo' }, $('crowd'));
    svg('circle', { cx: p.point[0] * 10, cy: (90 - p.point[1]) * 10, r: 6, class: 'crowd-person' }, $('crowd'));
  }
  scene3d?.setScenario(state.scenario, state.slot);
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
  const [x, y] = state.position;
  svg('circle', { cx: x * 10, cy: (90 - y) * 10, r: 21, class: 'robot-body' }, $('robotLayer'));
  scene3d?.setRobot(state.position, robotState());
}

/* --------------------------------------------------------- view rendering */
function renderLiveOps() {
  const alerts = alertProducts();
  const robotLabels = { idle: 'IDLE', moving: 'MOVING', turning: 'AVOIDING', picking: 'PICKING', blocked: 'SAFE STOP', charging: 'CHARGING', error: 'FAULT' };
  const robotLabel = robotLabels[robotState()];
  setText('opsRobot', robotLabel);
  setText('opsOrders', activeOrderCount());
  setText('opsStock', alerts.length);
  setText('opsDone', state.completed.filter(c => c.status === 'Completed').length);
  $('opsStock').className = alerts.length > 2 ? 'is-warn' : alerts.length ? '' : 'is-ok';
  $('opsRobot').className = robotLabel === 'FAULT' || robotLabel === 'SAFE STOP' ? 'is-danger' : robotLabel === 'IDLE' ? '' : 'is-ok';
  setText('kpiOrders', activeOrderCount());
  setText('kpiCompleted', state.completed.filter(c => c.status === 'Completed').length);
  setText('kpiStock', alerts.length);
  setText('kpiDistance', state.plan ? state.plan.length.toFixed(1) : '—');
  $('systemPill').textContent = state.fault ? 'FAULT · SAFE STOP' : state.blocked ? 'AISLE CLOSED' : 'SIMULATION READY';
  $('systemPill').className = `pill ${state.fault || state.blocked ? 'pill--danger' : 'pill--ok'}`;
  $('systemStatusTable').innerHTML = [
    ['Robot', `AMR-01 · ${robotLabel}`, robotLabel === 'FAULT' ? 'pill--danger' : 'pill--ok'],
    ['Navigation graph', `${nodes.size} nodes · ${state.closedEdges.size} restricted edge(s)`, state.closedEdges.size ? 'pill--warn' : 'pill--ok'],
    ['Crowd scenario', `${state.scenario === 'peak' ? 'Weekday peak' : 'Normal flow'} · ${timeSlots.find(t => t.id === state.slot).label}`, 'pill--info'],
    ['Order queue', `${state.queue.length} waiting · ${state.order ? 1 : 0} active`, state.queue.length ? 'pill--warn' : 'pill--ok'],
    ['Battery (simulated)', `${state.battery.toFixed(0)}%`, state.battery < 20 ? 'pill--danger' : 'pill--ok'],
  ].map(([label, value, cls]) => `<tr><td>${label}</td><td style="text-align:right"><span class="pill ${cls}">${escapeHtml(value)}</span></td></tr>`).join('');
  const preview = [
    ['1 · Payment', state.order ? `${state.order.id} accepted` : 'Waiting for customer'],
    ['2 · Sequencing', state.plan ? state.plan.method : 'Awaiting order lines'],
    ['3 · Navigation', `${state.stage} / ${state.plan?.stops.length ?? 0} zones visited`],
    ['4 · Checkout & handover', state.awaitingPickup ? 'Waiting at exit' : 'Pending'],
  ];
  $('livePreviewList').innerHTML = preview.map(([label, value], i) =>
    `<li><span>${label}<small>${escapeHtml(value)}</small></span><span class="pill ${i < state.stage ? 'pill--ok' : 'pill--info'}">${i < state.stage ? 'DONE' : 'PENDING'}</span></li>`).join('');
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
    ...(state.order ? [{ order: state.order, label: state.awaitingPickup ? 'Awaiting handover' : state.running ? 'In progress' : state.shortage ? 'Shortage decision' : 'Assigned · ready' }] : []),
    ...state.queue.map((order, i) => ({ order, label: `Queued #${i + 1}` })),
  ];
  $('orderQueue').innerHTML = entries.length ? entries.map(({ order, label }) =>
    `<div class="queue-item"><b>${escapeHtml(order.id)}</b><span>${order.lines.reduce((n, x) => n + x.qty, 0)} items · ${money(order.paid)}</span>
     <span class="pill ${label === 'In progress' ? 'pill--ok' : 'pill--info'}">${label}</span>
     ${order === state.order && state.stage === 0 && !state.running && !state.elapsed ? '<button type="button" data-cancel-active="1">Cancel active order</button>' : order !== state.order ? `<button type="button" data-cancel="${escapeHtml(order.id)}">Cancel queued</button>` : ''}</div>`).join('')
    : '<p class="empty">No orders in the queue.</p>';
  const rows = [...(state.order ? [state.order] : []), ...state.queue, ...state.completed.slice(-3)];
  $('fulfillmentTable').innerHTML = rows.length ? rows.map(order => {
    const statusText = order.status || (order === state.order ? state.awaitingPickup ? 'Waiting handover' : state.running ? 'Fulfilling' : 'Ready' : 'Queued');
    return `<tr><td class="mono">${escapeHtml(order.id)}</td><td>${order.lines?.reduce((n, x) => n + x.qty, 0) ?? '—'}</td><td>${order.paid ? money(order.paid) : '—'}</td><td>AMR-01</td><td><span class="pill ${statusText === 'Completed' ? 'pill--ok' : 'pill--info'}">${escapeHtml(statusText)}</span></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">No orders yet.</td></tr>';
}
function renderStockout() {
  const select = $('stockoutSelect'), previous = state.stockoutId;
  select.innerHTML = '<option value="">No simulated shortage</option>' + (state.order?.lines || []).map(x =>
    `<option value="${x.product.id}">${escapeHtml(x.product.name)} · zone ${x.product.shelfId}</option>`).join('');
  select.value = previous && state.order?.lines.some(x => x.product.id === previous) ? previous : '';
  select.disabled = !state.order || state.running || state.stage > 0 || state.awaitingPickup || !!state.shortage;
  $('stockoutPanel').hidden = !state.shortage;
  $('assistPanel').hidden = !state.assistPending;
  $('handoffPanel').hidden = !state.awaitingPickup;
  if (state.shortage) {
    const { line, alternative } = state.shortage;
    setText('stockoutDetail', `${line.product.name} × ${line.qty} is out of stock at zone ${line.product.shelfId}. ${alternative ? `${alternative.name} × ${line.qty} (${money(alternative.price * line.qty)}, ${kgText(alternative.weight * line.qty)}) requires customer confirmation.` : 'No preconfigured substitute; the item can be skipped.'} Price difference is displayed only.`);
    $('acceptSubBtn').disabled = !alternative;
  }
  if (state.assistPending) setText('assistDetail', `Zone ${state.assistPending.stop.shelfId}: ${state.assistPending.names.join(', ')} requires employee verification. The web demo has no gripper, scanner or cold-chain equipment.`);
  if (state.awaitingPickup) setText('handoffDetail', `Order ${state.order.id} (demo code ${state.order.id.slice(-4)}) is at the exit. Confirm ${state.bought.reduce((n, x) => n + x.qty, 0)} picked items; final simulated amount ${money(actualPrice())}.`);
}
function renderOrderState() {
  setText('orderListHeading', state.order ? `${state.order.id} · ${state.order.lines.reduce((n, x) => n + x.qty, 0)} items` : 'Awaiting order');
  // The sidebar heading was replaced by the control panel; keep legacy node if present.
  const legacy = $('orderListHeading'); if (legacy) legacy.textContent = state.order ? `${state.order.id} · ${state.order.lines.reduce((n, x) => n + x.qty, 0)} items` : 'Awaiting order';
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  setText('loadText', `${kgText(loaded)} / ${kgText(CAPACITY)}`); setWidth('loadFill', loaded / CAPACITY * 100);
  setText('loadText2', `${kgText(loaded)} / ${kgText(CAPACITY)}`); setWidth('loadFill2', loaded / CAPACITY * 100);
  renderQueue(); renderStockout();
}
function renderProgress() {
  const done = state.plan?.legs.slice(0, state.stage).reduce((n, leg) => n + leg.length, 0) || 0;
  const percent = state.awaitingPickup ? 100 : state.plan ? Math.min(100, Math.round((done + state.legDistance) / state.plan.length * 100)) : 0;
  setWidth('progressFill', percent); setText('progressPercent', `${percent}%`);
  setText('progressText', state.awaitingPickup ? 'Awaiting exit handover' : state.shortage ? 'Awaiting shortage decision' : state.running ? `To ${nextName()}` : state.order ? 'Ready / paused' : 'Waiting for paid order');
  setText('nextTarget', nextName());
  setText('fulfillPct', `${percent}%`); setWidth('fulfillFill', percent);
}
function nextName() {
  if (state.awaitingPickup) return 'Exit handover';
  if (!state.plan) return '—';
  if (state.stage < state.plan.stops.length) return `Zone ${state.plan.stops[state.stage].shelfId} · ${state.plan.stops[state.stage].lines.map(x => x.product.name).join(', ')}`;
  return state.stage === state.plan.stops.length ? 'Checkout' : 'Exit';
}
function renderTimeline() {
  const steps = ['Read paid order', 'Weight check · enter store', 'Held–Karp + A* planning',
    ...(state.plan?.stops || []).map(s => `Pick zone ${s.shelfId}`), 'Checkout verification', 'Leave via exit', 'Customer handover'];
  const active = Math.min(3 + state.stage, steps.length - 1);
  $('timeline').innerHTML = steps.map((step, i) => `<li class="${!state.order ? '' : i < active ? 'is-done' : i === active ? 'is-active' : ''}">${step}</li>`).join('');
}
function renderRobotCenter() {
  const labels = { idle: 'IDLE', moving: 'MOVING', turning: 'AVOIDING', picking: 'PICKING', blocked: 'SAFE STOP', charging: 'CHARGING', error: 'FAULT' };
  const label = labels[robotState()];
  setText('robotStatusText', `${label} · ${state.battery.toFixed(0)}% BATTERY · AMR-01`);
  setText('robotTaskText', state.fault ? faultAdvice[state.fault] : state.order ? `${nextName()} — ${state.running ? 'robot following A* path' : 'simulation paused'}.` : 'No active task. Submit an order in Order Management, then press Play in the 3D Supermarket view.');
  setText('robotModeText', `MODE: ${state.scenario === 'peak' ? 'PEAK FLOW' : 'NORMAL'}`);
  setText('robotStateBadge', `STATE: ${label}`);
  setText('robotDestination', nextName());
  setText('robotBattery2', `${state.battery.toFixed(0)}%`); setText('batteryText2', `${state.battery.toFixed(0)}%`);
  setWidth('batteryFill2', state.battery);
  setText('robotLoad2', kgText(state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0)));
  setText('robotDistance2', state.traveled.toFixed(1));
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  $('robotTelemetryTable').innerHTML = [
    ['Position (x, y)', state.position.map(n => n.toFixed(1)).join(', ')],
    ['Graph nodes', `${nodes.size}`],
    ['Active restrictions', `${state.closedEdges.size}`],
    ['Dynamic obstacles', `${state.dynamicObstacles.length}`],
    ['Simulated elapsed', `${state.elapsed.toFixed(1)} s`],
    ['Plan cost', state.plan ? state.plan.cost.toFixed(1) : '—'],
    ['Plan risk', state.plan ? state.plan.risk.toFixed(1) : '—'],
    ['Load / capacity', `${kgText(loaded)} / ${kgText(CAPACITY)}`],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="right mono">${escapeHtml(v)}</td></tr>`).join('');
  setText('destinationText', nextName());
  setText('navDistance', state.plan ? `${state.plan.length.toFixed(1)} map units` : '—');
  setText('navElapsed', `${state.elapsed.toFixed(1)} s`);
  setText('navStops', `${Math.min(state.stage, state.plan?.stops.length ?? 0)} / ${state.plan?.stops.length ?? 0}`);
  setText('faultState', state.fault ? faultAdvice[state.fault] : 'No active fault.');
  $('suddenPersonFix')?.removeAttribute('hidden');
  $('injectFaultBtn').setAttribute('aria-pressed', String(!!state.fault));
  setText('pickupCode', state.order ? state.order.id.slice(-4) : '—');
}
function renderRouteView() {
  setText('heldKarpMethod', state.plan ? `${state.plan.method} · ${state.plan.stops.length} unique zones` : 'Waiting for an order.');
  const stops = state.plan?.stops || [];
  $('heldKarpFlow').innerHTML = stops.length ? [STORE.entrance, ...stops.map(s => s.point), STORE.checkout, STORE.exit]
    .map((p, i, arr) => `${i ? '<span class="route-arrow">→</span>' : ''}<span class="route-node ${i <= state.stage ? 'route-node--done' : ''}">${i === 0 ? 'IN' : i === arr.length - 1 ? 'OUT' : i === arr.length - 2 ? 'PAY' : `Z${stops[i - 1].shelfId}`}</span>`).join('')
    : '<span class="muted">Submit an order to compute the exact sequence.</span>';
  $('heldKarpTable').innerHTML = stops.length ? stops.map((s, i) =>
    `<tr><td>${i + 1}</td><td><b>${escapeHtml(s.category || shelves.find(x => x.id === s.shelfId)?.category || s.shelfId)}</b></td><td class="mono">${s.point.join(', ')}</td><td>${s.lines.map(x => escapeHtml(x.product.name)).join(', ')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No plan yet.</td></tr>';
  $('astarTable').innerHTML = state.plan ? state.plan.legs.map((leg, i) =>
    `<tr><td>${i === 0 ? 'Entrance → Z1' : i < stops.length ? `Z${stops[i - 1].shelfId} → Z${stops[i].shelfId}` : i === stops.length ? `Z${stops.at(-1).shelfId} → Checkout` : 'Checkout → Exit'}</td><td class="right num">${leg.length.toFixed(1)}</td><td class="right num">${leg.time.toFixed(1)}</td><td class="right num">${leg.risk.toFixed(1)}</td><td class="right num">${leg.cost.toFixed(1)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No plan yet.</td></tr>';
  if (!state.order) {
    $('comparisonBody').innerHTML = '<tr><td colspan="3" class="muted">Submit an order to compare plans.</td></tr>';
    setText('comparisonInsight', 'Both plans are computed with the same order, time slot and cost function.');
    setText('routeCompareNote', 'Original plan = same order evaluated as a normal-flow baseline.');
    return;
  }
  const a = scoreExistingRoute(state.normalPlan, state.scenario, state.slot), b = state.plan;
  const changed = a.points.map(key).join('|') !== b.points.map(key).join('|');
  setText('routeCompareNote', `${b.method} · visit order: IN → ${b.stops.map(s => `Z${s.shelfId}`).join(' → ')} → PAY → OUT.`);
  const rows = [
    ['Route length', `${a.length.toFixed(1)} map units`, `${b.length.toFixed(1)} map units`],
    ['Estimated time (simulated)', `${a.time.toFixed(1)} s`, `${b.time.toFixed(1)} s`],
    ['Risk value', a.risk.toFixed(1), b.risk.toFixed(1)],
    ['Total cost', a.cost.toFixed(1), b.cost.toFixed(1)],
    ['Replans', '0', changed ? '1' : '0'],
  ];
  $('comparisonBody').innerHTML = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  setText('comparisonInsight', `Same order and ${timeSlots.find(t => t.id === state.slot).label} sample. Cost = distance + 0.45 × time + 1.3 × risk. All timing values are simulation assumptions.`);
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
    ['Pedestrian crossing', state.events.has('pedestrian')],
    ['Shopping cart blocking', state.events.has('cart')],
    ['Central aisle closed', state.closedEdges.size > 0],
    ['Overload test', orderWeight() > CAPACITY || state.events.has('overload')],
    ['Shelf congestion / peak', state.scenario === 'peak' || state.events.has('congestion')],
    ['Navigation fault', !!state.fault || state.events.has('failure')],
  ];
  $('activeEvents').innerHTML = conditions.map(([label, active]) =>
    `<li><span>${label}</span><span class="pill ${active ? 'pill--warn' : 'pill--ok'}">${active ? 'ACTIVE' : 'CLEAR'}</span></li>`).join('')
    + '<li><span>Simulation data source</span><span class="pill pill--info">RULE-DRIVEN</span></li>';
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
function renderPresentationHud() {
  setText('hudTask', state.running ? `To ${nextName()}` : state.order ? 'Paused / ready' : 'Waiting for order');
  setText('hudOrder', state.order ? `${state.order.id} · ${state.stage}/${state.plan?.stops.length ?? 0} zones` : '—');
  setText('hudRoute', state.plan ? `${state.plan.length.toFixed(1)} units · cost ${state.plan.cost.toFixed(1)}` : '—');
  setText('hudMetrics', state.plan ? state.plan.method : 'Held–Karp + A*');
}
function renderAll() {
  renderLiveOps(); renderQueue(); renderOrderState(); renderInventory(); renderProgress();
  renderTimeline(); renderRobotCenter(); renderRouteView(); renderSimulationView(); renderPresentationHud();
  renderOverviewPreview();
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
  state.history = [[...STORE.entrance]]; state.detected = new Set(); state.traveled = 0;
  state.dynamicObstacles = preserveSafety ? dynamic : [];
  state.plan = state.order ? buildPlan(state.order.lines, state.scenario, state.slot) : null;
  state.normalPlan = state.order ? buildPlan(state.order.lines, 'normal', state.slot) : null;
  setText('playLabel', 'Play fulfillment'); setText('playIcon', '▶');
  status(state.order ? 'Paid order received' : 'Awaiting order',
    state.order ? 'Press Play to check weight and leave the entrance.' : 'Select products and submit an order first.', 'IDLE');
  if (state.fault) status('Fault safe-stop', faultAdvice[state.fault], 'FAULT');
  renderAll();
}
function actualPrice() { return state.bought.reduce((n, x) => n + x.product.price * x.qty, 0); }
function activateNext() {
  state.order = state.queue.shift() || null; state.stockoutId = ''; resetPlayback();
  if (state.order) {
    log(`Queue advanced to ${state.order.id}: paid order loaded.`);
    if (orderWeight() > CAPACITY) status('Cannot depart · overload', `${kgText(orderWeight())} exceeds the ${kgText(CAPACITY)} limit.`, 'FAULT');
  }
}
function submitOrder() {
  const lines = cartLines();
  if (!lines.length || cartPrice() < MIN_ORDER || lines.some(x => x.qty > x.product.stock)) return;
  const id = `NX-${String(++state.orderCounter).padStart(4, '0')}`;
  const order = { id, lines: lines.map(x => ({ product: x.product, qty: x.qty })), paid: cartPrice() };
  state.queue.push(order); state.cart.clear(); renderCart(); renderRecommendations();
  if (!state.order) activateNext(); else renderAll();
  setText('orderMessage', `${id}: simulated payment accepted (${money(order.paid)}); ${state.order === order ? 'robot loaded the order.' : `queue position ${state.queue.length}.`} No real transaction.`);
  log(`${id} submitted · ${state.order === order ? 'assigned to AMR-01' : `queued #${state.queue.length}`}.`);
}
function updateScenario(source = 'manual') {
  if (state.order && !state.awaitingPickup) resetPlayback(true);
  if (source === 'manual') log(`Scenario changed to ${state.scenario === 'peak' ? 'weekday peak' : 'normal flow'} at ${state.slot}: candidate routes recalculated.`);
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
    if (resolution?.kind === 'skip') { log(`${line.product.name} skipped: customer declined substitute.`); continue; }
    const actual = resolution?.kind === 'accept' ? resolution.replacement : line.product;
    actual.stock = Math.max(0, actual.stock - line.qty);
    state.bought.push({ product: actual, qty: line.qty });
    log(`Zone ${stop.shelfId}: picked ${actual.name} × ${line.qty}${resolution ? ' (accepted substitute)' : ''}.`);
  }
  state.stage++; state.pauseLeft = .6;
  const loaded = state.bought.reduce((n, x) => n + x.product.weight * x.qty, 0);
  status('Items verified', `Current load ${kgText(loaded)}. Proceeding to the next zone.`, 'PICKING');
  renderInventory(); renderAll();
}
function requestPickupAssist(stop, wasRunning) {
  const names = stop.lines.filter(line => state.resolutions.get(line.product.id)?.kind !== 'skip')
    .map(line => state.resolutions.get(line.product.id)?.replacement || line.product)
    .filter(p => pickupProfile(p).assist).map(p => p.name);
  if (!names.length || state.assistedShelves.has(stop.shelfId)) return false;
  state.assistPending = { stop, names, wasRunning }; state.running = false;
  status('Employee assistance required', `${names.join(', ')} needs verification. Robot stopped.`, 'PICKING');
  log(`Zone ${stop.shelfId}: employee assistance required for ${names.join(', ')}.`, 'warn');
  renderAll(); return true;
}
function confirmPickupAssist() {
  if (!state.assistPending) return;
  const { stop, wasRunning } = state.assistPending;
  state.assistedShelves.add(stop.shelfId); state.assistPending = null;
  log(`Employee verified assisted pick at zone ${stop.shelfId}.`);
  completeStop(stop);
  if (wasRunning && !state.fault && !state.events.has('failure')) {
    state.running = true; state.lastFrame = 0; setText('playLabel', 'Pause fulfillment'); setText('playIcon', 'Ⅱ'); requestAnimationFrame(animate);
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
      status('Shortage · awaiting decision', `${line.product.name} is out of stock at zone ${stop.shelfId}.`, 'PICKING');
      log(`${line.product.name} shortage: robot stopped; no automatic substitution.`, 'warn'); renderAll(); return;
    }
    if (requestPickupAssist(stop, state.running)) return;
    completeStop(stop);
  } else if (index === stops.length) {
    log(`Checkout: ${state.bought.reduce((n, x) => n + x.qty, 0)} items, final simulated amount ${money(actualPrice())}.`);
    status('Checkout complete', 'Robot proceeds to the exit handover point.', 'PICKING');
    state.pauseLeft = .8; state.stage++; renderAll();
  } else {
    state.running = false; state.finished = true; state.awaitingPickup = true; state.stage++;
    log('Robot reached the exit. Waiting for customer handover.');
    status('Awaiting exit handover', `Order ${state.order.id} is ready for collection.`, 'CHARGING');
    setText('playLabel', 'Awaiting handover'); setText('playIcon', '✓'); renderAll();
  }
  if (state.order) setText('orderMessage', `${state.order.id}: ${state.awaitingPickup ? 'at exit, awaiting handover' : 'robot fulfilling'}; simulated payment only.`);
}
function decideSubstitution(accept) {
  if (!state.shortage) return;
  const { line, alternative, wasRunning } = state.shortage;
  if (accept && !alternative) return;
  if (accept) {
    const projected = orderWeight() - line.product.weight * line.qty + alternative.weight * line.qty;
    if (projected > CAPACITY) { status('Substitute overload', `Projected load ${kgText(projected)} exceeds capacity. Decline the substitute.`, 'FAULT'); return; }
  }
  state.resolutions.set(line.product.id, accept ? { kind: 'accept', replacement: alternative } : { kind: 'skip' });
  log(accept ? `Customer accepted ${line.product.name} → ${alternative.name}.` : `Customer declined substitute for ${line.product.name}; item skipped.`);
  state.shortage = null;
  if (requestPickupAssist(state.plan.stops[state.stage], wasRunning)) return;
  completeStop(state.plan.stops[state.stage]);
  if (wasRunning && !state.fault && !state.events.has('failure')) {
    state.running = true; state.lastFrame = 0; setText('playLabel', 'Pause fulfillment'); setText('playIcon', 'Ⅱ'); requestAnimationFrame(animate);
  }
}
function confirmHandoff() {
  if (!state.awaitingPickup) return;
  const finished = state.order;
  log(`Exit handover complete: ${finished.id} collected; final simulated amount ${money(actualPrice())}.`);
  state.completed.push({ id: finished.id, status: 'Completed' });
  state.order = null; state.awaitingPickup = false; state.stockoutId = '';
  activateNext();
  setText('orderMessage', state.order ? `${finished.id} handed over. Next order ${state.order.id} loaded.` : `${finished.id} handed over. Queue empty.`);
}
function cancelOrder(id) {
  const index = state.queue.findIndex(order => order.id === id); if (index < 0) return;
  state.queue.splice(index, 1); state.completed.push({ id, status: 'Cancelled' }); renderAll(); log(`${id} cancelled from queue.`);
}
function cancelActive() {
  if (!state.order || state.running || state.stage > 0 || state.elapsed > 0 || state.awaitingPickup) return;
  const id = state.order.id; state.completed.push({ id, status: 'Cancelled' }); state.order = null; activateNext();
  log(`${id} cancelled; next queued order loaded.`);
}
const faultAdvice = {
  sensor: 'Sensor unavailable: robot safe-stopped. Inspect the sensor and manually clear the fault.',
  localization: 'Localization lost: safe-stop. Re-localize and verify the shelf map before recovery.',
  network: 'Order network outage: safe-stop. Reconcile the local order with the server before recovery.',
  battery: 'Low battery: safe-stop. Operator must charge or take over the order.',
  wrongItem: 'Item verification mismatch: safe-stop. Operator must recheck name and barcode.',
};
function setFault(active) {
  state.fault = active ? $('faultSelect').value : '';
  if (!active) state.events.delete('failure');
  state.running = false; state.lastFrame = 0;
  if (active) {
    state.events.add('failure');
    status('Fault safe-stop', faultAdvice[state.fault], 'FAULT');
    log(`Fault drill: ${faultAdvice[state.fault]}`, 'danger');
  } else {
    status('Fault cleared', 'Press Play to continue the current order from its position.', 'IDLE');
    log('Operator cleared the fault; robot is waiting for a continue command.');
  }
  drawRobot(); renderAll();
}
function toggleSuddenPerson() {
  const active = !state.events.has('pedestrian');
  if (active) state.events.add('pedestrian'); else state.events.delete('pedestrian');
  state.running = false; state.lastFrame = 0;
  if (active) { status('Sudden pedestrian · safe-stop', 'Independent near-field layer prevents further motion.', 'SAFE STOP'); log('Sudden pedestrian: immediate safe-stop (simulation).', 'danger'); }
  else { status('Pedestrian cleared', 'Press Play to re-check the route and continue.', 'IDLE'); log('Simulated pedestrian left the aisle.'); }
  drawRobot(); renderAll();
}

/* ------------------------------------------------------ simulation events */
function handleSimEvent(type) {
  if (type === 'pedestrian' || type === 'cart') {
    const nextPoint = state.plan?.legs[state.stage]?.points.at(-1) || [70, 45];
    const point = [Math.max(8, Math.min(132, state.position[0] + (nextPoint[0] - state.position[0]) * .55)),
      Math.max(8, Math.min(82, state.position[1] + (nextPoint[1] - state.position[1]) * .55))];
    state.dynamicObstacles = state.dynamicObstacles.filter(o => o.type !== (type === 'pedestrian' ? 'person' : 'cart'));
    state.dynamicObstacles.push({ id: `EVT-${type}`, type: type === 'pedestrian' ? 'person' : 'cart', zone: 'Simulation event', point });
    state.events.add(type); state.slowLeft = type === 'cart' ? 2.4 : 1.8;
    log(`${type === 'pedestrian' ? 'Pedestrian crossing' : 'Shopping cart'} simulation: obstacle at (${point.map(n => n.toFixed(1)).join(', ')}); robot slowing and checking the path.`, 'warn');
    status(type === 'pedestrian' ? 'Pedestrian detected' : 'Cart blocking aisle', 'Rule-driven safety layer: slowing down, then replanning if needed.', 'AVOIDING');
    if (state.plan && state.running) replanCurrentLeg('Obstacle event');
    drawCrowd(); renderAll(); return;
  }
  if (type === 'aisle') {
    const edge = [[60, 34], [80, 34]], id = edgeKey(...edge);
    if (state.closedEdges.has(id)) {
      state.closedEdges.delete(id); state.events.delete('aisle');
      log('Central aisle reopened; A* may use the direct corridor again.');
    } else {
      state.closedEdges.add(id); state.events.add('aisle');
      log('Aisle closure simulation: central corridor edge removed from the graph.', 'warn');
      status('Aisle closed', 'Restricted edge shown in red. Replanning around the closure.', 'SAFE STOP');
      if (state.running) replanCurrentLeg('Aisle closure');
    }
    drawRoutes(); renderAll(); return;
  }
  if (type === 'overload') {
    const product = products.find(p => p.name === 'Beverage Pack');
    if (state.cart.has(product.id)) state.cart.delete(product.id); else state.cart.set(product.id, 3);
    state.events.add('overload');
    log(state.cart.has(product.id) ? 'Overload drill: 3 × 6 kg cases added to the cart. A 12 kg limit will block departure.' : 'Overload drill load removed.', 'warn');
    renderCart(); renderAll(); return;
  }
  if (type === 'congestion') {
    state.scenario = state.scenario === 'peak' ? 'normal' : 'peak';
    state.events.add('congestion');
    updateScenario(); log(`Shelf congestion drill: scenario is now ${state.scenario === 'peak' ? 'weekday peak' : 'normal flow'}.`, 'warn');
    return;
  }
  if (type === 'failure') { setFault(!state.fault); return; }
}

/* -------------------------------------------------------------- animation */
function animate(now) {
  if (!state.running) return;
  if (!state.lastFrame) state.lastFrame = now;
  const delta = Math.min((now - state.lastFrame) / 1000, .08);
  state.lastFrame = now; state.elapsed += delta;
  if (state.fault || state.events.has('failure')) {
    state.running = false; status('Fault safe-stop', faultAdvice[state.fault || 'localization'], 'FAULT'); renderAll(); return;
  }
  if (state.blocked) { status('Safe stop', 'All aisles closed; robot holds position.', 'SAFE STOP'); requestAnimationFrame(animate); return; }
  if (state.pauseLeft > 0) { state.pauseLeft = Math.max(0, state.pauseLeft - delta); requestAnimationFrame(animate); return; }
  const leg = state.plan?.legs[state.stage]; if (!leg) return;
  const sensed = getObstacleSnapshot(state.scenario, state.slot);
  const person = sensed.find(p => p.type === 'person' && !state.detected.has(p.id) && dist(state.position, p.point) < 5.5);
  if (person) {
    state.detected.add(person.id); state.slowLeft = 1;
    log(`Rule layer: pedestrian near ${person.zone}; slowing and keeping clearance.`);
    status('Pedestrian · slow down', 'Low speed through the aisle; path remains feasible.', 'AVOIDING');
  }
  const cart = sensed.find(o => o.type === 'cart' && !state.detected.has('cart') && dist(state.position, o.point) < 5.5);
  if (cart) { state.detected.add('cart'); state.slowLeft = 1; log('Rule layer: shopping cart detected; slowing and steering to the side.'); }
  const slow = state.slowLeft > 0; state.slowLeft = Math.max(0, state.slowLeft - delta);
  const step = delta * (state.scenario === 'peak' ? 22 : 26) * (slow ? .45 : 1);
  const previous = state.position;
  state.legDistance = Math.min(leg.length, state.legDistance + step);
  state.position = positionOnLeg(leg, state.legDistance);
  const travelled = dist(previous, state.position);
  state.traveled += travelled; state.battery = Math.max(0, state.battery - travelled * .09);
  if (state.battery < 15 && !state.events.has('lowBattery')) {
    state.events.add('lowBattery'); log('Simulated battery below 15%; operator should plan a charge.', 'warn');
  }
  if (dist(state.history.at(-1), state.position) > .15) state.history.push([...state.position]);
  drawHistory(); drawRobot(); renderProgress();
  if (state.legDistance >= leg.length - .001) { state.legDistance = 0; arrive(); }
  if (++state.uiTick % 12 === 0) { renderLiveOps(); renderRobotCenter(); renderPresentationHud(); }
  if (state.running) requestAnimationFrame(animate);
}
function playPause() {
  if (state.shortage) { status('Decide shortage first', 'Choose accept substitute or skip in the task panel.', 'PICKING'); return; }
  if (state.assistPending) { status('Confirm assisted pick', 'The employee must verify the items before the robot moves.', 'PICKING'); return; }
  if (state.fault || state.events.has('failure')) { status('Fault safe-stop', faultAdvice[state.fault || 'localization'], 'FAULT'); return; }
  if (state.awaitingPickup) { status('Confirm handover', 'Customer must collect the order at the exit.', 'CHARGING'); return; }
  if (!state.order) { status('Submit an order first', 'Select products and simulate payment to start the robot.', 'IDLE'); log('No paid order; robot stays at the entrance.'); return; }
  if (orderWeight() > CAPACITY) { status('Cannot depart · overload', `${kgText(orderWeight())} exceeds ${kgText(CAPACITY)}.`, 'FAULT'); log('Weight check failed; robot remains at the entrance.', 'danger'); return; }
  if (state.running) {
    state.running = false; state.lastFrame = 0; setText('playLabel', 'Continue fulfillment'); setText('playIcon', '▶');
    status('Simulation paused', 'Press continue to resume from the current position.', 'IDLE');
    renderProgress(); renderQueue(); return;
  }
  if (state.stage === 0 && state.elapsed === 0) {
    log(`Weight check passed: ${kgText(orderWeight())} / ${kgText(CAPACITY)}.`);
    log(`${state.plan.method}; ${state.plan.stops.length} zones; A* planned every leg.`);
  }
  state.running = true; state.lastFrame = 0; setText('playLabel', 'Pause fulfillment'); setText('playIcon', 'Ⅱ');
  status(`To ${nextName()}`, 'Following the A* path; rule layer handles pedestrians and carts.', 'MOVING');
  renderProgress(); renderQueue(); requestAnimationFrame(animate);
}
function toggleBlock() {
  state.blocked = !state.blocked;
  log(state.blocked ? 'All aisle closure test: robot safe-stopped.' : 'Aisles reopened; robot may continue.');
  status(state.blocked ? 'Safe stop' : 'Route available', state.blocked ? 'Robot holds position.' : 'Continue when ready.', state.blocked ? 'SAFE STOP' : 'IDLE');
  renderAll();
}
function demoOrder() {
  if (!research) { setText('orderMessage', 'Real catalog is still loading. Please retry.'); return; }
  const used = new Set();
  const examples = research.top.filter(p => {
    const item = productById.get(`I${p.id}`);
    if (!item || p.weightG <= 0 || p.weightG > 2000 || used.has(item.shelfId)) return false;
    used.add(item.shelfId); return true;
  }).slice(0, 4);
  state.cart = new Map(examples.map(p => [`I${p.id}`, 1]));
  renderCart(); renderRecommendations(); renderAll();
  setText('orderMessage', 'Four real sample products loaded. Simulate payment; an active order will queue this basket.');
}
function toggleOverload() {
  const product = products.find(p => p.name === 'Beverage Pack');
  changeQty(product.id, state.cart.has(product.id) ? -state.cart.get(product.id) : 3);
  setText('orderMessage', state.cart.has(product.id) ? 'Three 6 kg cases added; a 12 kg order will be blocked.' : 'Test cases removed; paid orders are unaffected.');
}
function runBenchmark() {
  if (!state.order) { setText('benchmarkResult', 'Simulate payment first, then compare the same order.'); return; }
  const modes = [['Distance only', 'distance'], ['Distance + time', 'time'], ['Distance + time + risk', 'full']];
  const rows = modes.map(([label, mode]) => {
    const plan = buildPlan(state.order.lines, state.scenario, state.slot, mode);
    return { label, score: plan && scoreExistingRoute(plan, state.scenario, state.slot) };
  });
  if (rows.some(row => !row.score)) { setText('benchmarkResult', 'No comparable route exists under the current restrictions.'); return; }
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
  $('benchmarkResult').innerHTML = `<table class="data-table"><thead><tr><th>Planning input</th><th>Length</th><th>Sim seconds</th><th>Risk</th></tr></thead><tbody>${body}</tbody></table><p>Across ${checked} fixed teaching scenarios, the full cost produced lower risk than the distance-only baseline ${safer} times. Not a randomized experiment.</p>`;
}
function renderDataAudit() {
  const counts = crowdSamples[state.slot], base = crowdSamples['09'];
  const changed = counts.filter((n, i) => Math.abs(n - base[i]) >= 3).length;
  setText('dataAudit', research ? `Cleaned files: ${research.summary.products.toLocaleString()} products, ${research.summary.orders.toLocaleString()} orders, ${research.summary.basketOrders.toLocaleString()} train baskets. Pre-cleaning deletion counts cannot be reconstructed from cleaned CSVs.` : 'Reading real data statistics…');
  setText('driftAudit', `${timeSlots.find(t => t.id === state.slot).label} vs 09:00 teaching baseline: ${changed}/${shelves.length} zones differ by at least 3 simulated people. This is a resampling prompt, not real model drift.`);
}
function renderPickupFeasibility() {
  const lines = state.order?.lines || ['Apple', 'Shrimp', 'Frozen Dumplings', 'Beverage Pack'].map(name => ({ product: products.find(p => p.name === name), qty: 1 }));
  $('pickupFeasibility').innerHTML = `<ul>${lines.map(({ product: p }) => `<li>${escapeHtml(p.name)}: ${pickupProfile(p).label}</li>`).join('')}</ul>`;
}

/* ------------------------------------------------------------------ binding */
function populateFilters() {
  if (research) {
    $('categoryFilter').innerHTML = '<option value="">All departments</option>' + research.index.departments.map(x =>
      `<option value="${x.id}">${escapeHtml(x.name)} (${x.count})</option>`).join('');
    updateSubcategories();
  }
  $('timeSlot').innerHTML = timeSlots.map(x => `<option value="${x.id}">${x.label}</option>`).join('');
}
function updateSubcategories() {
  if (!research) return;
  const dept = $('categoryFilter').value;
  const aisles = research.index.aisles.filter(x => !dept || x.departmentId === Number(dept));
  $('subcategoryFilter').innerHTML = '<option value="">All aisles</option>' + aisles.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
  scheduleCatalogSearch();
}
function scheduleCatalogSearch() {
  if (!research) return;
  clearTimeout(catalogTimer);
  const request = ++catalogRequest;
  $('catalogue').innerHTML = '<p class="empty">Searching real product catalog…</p>';
  catalogTimer = setTimeout(async () => {
    try {
      const query = $('productSearch').value, dept = $('categoryFilter').value, aisle = $('subcategoryFilter').value;
      const rows = !query && !dept && !aisle ? research.top.slice(0, 36) : await searchCatalog(research.index, query, dept, aisle);
      if (request !== catalogRequest) return;
      catalogResults = rows.map(row => {
        const id = `I${row.id}`; if (!productById.has(id)) productById.set(id, convertProduct(row)); return productById.get(id);
      });
      renderCatalogue();
    } catch (error) { if (request === catalogRequest) $('catalogue').textContent = `Catalog load failed: ${error.message}`; }
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
  $('resetBtn').addEventListener('click', () => { resetPlayback(); log('Current order restarted; robot returned to the entrance.'); });
  $('safetyTestBtn')?.addEventListener('click', toggleBlock);
  $('cameraResetBtn').addEventListener('click', () => scene3d.resetCamera());
  $('cameraIso').addEventListener('click', () => setCamera('iso'));
  $('cameraFollow').addEventListener('click', () => setCamera('follow'));
  $('cameraClose').addEventListener('click', () => setCamera('close'));
  $('stockoutSelect').addEventListener('change', () => {
    state.stockoutId = $('stockoutSelect').value;
    log(state.stockoutId ? `Shortage drill selected for ${productById.get(state.stockoutId).name}.` : 'Shortage drill disabled.');
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
function setCamera(mode) {
  scene3d.setCameraMode(mode);
  ['cameraIso', 'cameraFollow', 'cameraClose'].forEach((id, i) =>
    $(id).setAttribute('aria-pressed', String(['iso', 'follow', 'close'][i] === mode)));
}

/* --------------------------------------------------------------------- init */
scene3d = createStoreScene($('scene3d'), $('storeMap'));
scene3d.setScenario(state.scenario, state.slot);
drawBaseMap(); drawFixtures(); populateFilters(); renderCatalogue(); renderCart();
renderInventory(); renderRecommendations(); renderCrowd(); resetPlayback(); bindEvents();
scene3d.setActive(false);
log('NEXUS RETAIL simulation initialised. Real catalog loading…');

loadResearch().then(data => {
  research = data;
  for (const row of [...data.top, ...Object.values(data.rules.products)]) {
    const id = `I${row.id}`; if (!productById.has(id)) productById.set(id, convertProduct(row));
  }
  rules = data.rules.rules.map(rule => ({ ...rule, from: `I${rule.from}`, to: `I${rule.to}` }));
  populateFilters(); scheduleCatalogSearch(); renderRules(); renderRecommendations();
  renderResearchDashboard(data); renderDataAudit(); renderPickupFeasibility(); renderInventory();
  log(`Real catalog loaded: ${data.summary.products.toLocaleString()} products; ${data.rules.ruleCount.toLocaleString()} Apriori rules.`);
}).catch(error => {
  $('catalogue').textContent = `Real data failed to load: ${error.message}`;
  setText('miningMethod', 'Real analysis data unavailable; check public/data.');
  console.error(error);
});
