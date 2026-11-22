// NEXUS RETAIL V2 — 统一数据层 / 浏览器持久化。
// 订单、库存、补货记录共用此处；3D、订单页、机器人调度只读同一份数据。
// 没有服务端，因此采用 localStorage；无痕/禁用存储时自动降级为内存态。
const STORAGE_KEY = 'nexus-retail-v2';
const VERSION = 2;

const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ version: VERSION, orderCounter: 0, orders: [], restocks: [], inventory: {}, settings: {} });

// 后台配置：机器人数量默认 1，最多 2 台。与订单/库存共用同一持久化数据源。
const DEFAULT_SETTINGS = Object.freeze({ robotCount: 1 });
export function getSetting(key, fallback) {
  const value = data.settings?.[key];
  return value === undefined ? (DEFAULT_SETTINGS[key] ?? fallback) : value;
}
export function setSetting(key, value) {
  data.settings = data.settings || {};
  data.settings[key] = value;
  persist();
  return value;
}
export function getRobotCount() {
  return Math.max(1, Math.min(2, Number(getSetting('robotCount', 1)) || 1));
}

let storageOk = true;
let data = empty();
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === VERSION) data = { ...empty(), ...parsed };
  }
} catch (error) {
  storageOk = false;
  console.warn('持久化存储不可用，本次运行仅保存在内存中：', error.message);
}

export const persistenceStatus = () => storageOk ? 'localStorage' : 'memory-only';

export function persist() {
  if (!storageOk) return false;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
  catch (error) { storageOk = false; console.warn('写入持久化存储失败：', error.message); return false; }
}

/* ------------------------------------------------------------------ 库存 */
export function hydrateInventory(products) {
  let changed = false;
  for (const product of products) {
    if (Object.prototype.hasOwnProperty.call(data.inventory, product.id)) {
      product.stock = Math.max(0, Math.min(product.capacity, Number(data.inventory[product.id]) || 0));
    } else {
      data.inventory[product.id] = product.stock;
      changed = true;
    }
  }
  if (changed) persist();
}

export function saveInventory(products) {
  for (const product of products) data.inventory[product.id] = product.stock;
  persist();
}

/* ------------------------------------------------------------------ 订单 */
const lineSnapshot = line => ({
  productId: line.product?.id || line.productId,
  name: line.product?.name || line.name,
  category: line.product?.category || line.category,
  shelfId: line.product?.shelfId || line.shelfId,
  point: line.product?.point || line.point,
  price: line.product?.price ?? line.price,
  weight: line.product?.weight ?? line.weight,
  qty: line.qty,
  sourceId: line.product?.sourceId || line.sourceId || null,
});

export function serializeOrder(order) {
  return clone({
    ...order,
    lines: (order.lines || []).map(lineSnapshot),
    product: undefined,
  });
}

export function hydrateOrder(record, productById) {
  const order = clone(record);
  order.lines = (record.lines || []).map(line => ({
    ...line, product: productById.get(line.productId) || null,
  })).filter(line => line.product);
  return order;
}

export function nextOrderId() {
  data.orderCounter = (Number(data.orderCounter) || 0) + 1;
  persist();
  return `NX-${String(data.orderCounter).padStart(4, '0')}`;
}

export function saveOrder(order) {
  const snapshot = serializeOrder(order);
  const index = data.orders.findIndex(item => item.id === snapshot.id);
  if (index >= 0) data.orders[index] = { ...data.orders[index], ...snapshot };
  else data.orders.unshift(snapshot);
  persist();
  return snapshot;
}

export function patchOrder(id, patch) {
  const index = data.orders.findIndex(item => item.id === id);
  if (index < 0) return null;
  data.orders[index] = { ...data.orders[index], ...clone(patch) };
  persist();
  return data.orders[index];
}

export function getOrderRecord(id) { return data.orders.find(item => item.id === id) || null; }
export function listOrders() { return clone(data.orders); }

/* ------------------------------------------------------------------ 补货 */
export function addRestock(record) {
  data.restocks.unshift({ ...clone(record), id: `RS-${Date.now().toString(36)}-${data.restocks.length + 1}` });
  data.restocks = data.restocks.slice(0, 300);
  persist();
  return data.restocks[0];
}
export function listRestocks() { return clone(data.restocks); }

export function coreSnapshot() {
  return { version: VERSION, persistence: persistenceStatus(), orders: listOrders(), restocks: listRestocks(),
    inventory: { ...data.inventory }, orderCounter: data.orderCounter, settings: { ...data.settings }, robotCount: getRobotCount() };
}
