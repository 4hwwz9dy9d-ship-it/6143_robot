// NEXUS RETAIL — store geometry, product simulation and crowd samples.
// IMPORTANT: shelf pick points are graph nodes. The navigation graph in app.js
// and the 3D scene in scene3d.js both read this file, so coordinates stay in sync.
// Real product names/categories come from public/data (Instacart). Everything
// declared here (shelf position, stock, crowd, robot capacity) is a SIMULATION
// ASSUMPTION and is labelled as such in the interface.

// 物理比例（仿真初始设计值，非真实场所安全规范）
// 1 地图单位 = 0.17 m；3D 场景的 X_SCALE 与此处一致。
export const PHYSICS = Object.freeze({
  metersPerUnit: 0.17,
  robot: Object.freeze({ width: .62, length: .82, height: .92, radius: .36, maxSpeed: .78, accel: .42, brake: .62, turnRadius: .55 }),
  pedestrian: Object.freeze({ radius: .26, bodyWidth: .46 }),
  safety: Object.freeze({ buffer: .80, warnDistance: 2.0, yieldDistance: 1.35, emergencyGap: .06 }),
  aisles: Object.freeze({ main: 2.6, secondary: 1.9, access: 1.3 }),
});

export const STORE = {
  width: 140, height: 90,
  entrance: [5, 8], checkout: [130, 8], exit: [138, 8],
  aisleXs: [20, 40, 60, 80, 100, 120],
  crossYs: [8, 34, 56, 82],
  verticalYs: [8, 22, 34, 45, 56, 67, 82],
};

export const nodeKey = p => p.join(',');

// 机器人与行人共用同一张通道图，避免两套坐标/连通性。
export function buildNavNodes() {
  const nodes = new Map();
  const edge = (a, b) => {
    for (const p of [a, b]) if (!nodes.has(nodeKey(p))) nodes.set(nodeKey(p), { point: p, neighbors: [] });
    nodes.get(nodeKey(a)).neighbors.push(nodeKey(b));
    nodes.get(nodeKey(b)).neighbors.push(nodeKey(a));
  };
  const bottom = [STORE.entrance[0], ...STORE.aisleXs, STORE.checkout[0], STORE.exit[0]];
  for (let i = 1; i < bottom.length; i++) edge([bottom[i - 1], 8], [bottom[i], 8]);
  for (const y of STORE.crossYs.slice(1)) for (let i = 1; i < STORE.aisleXs.length; i++) edge([STORE.aisleXs[i - 1], y], [STORE.aisleXs[i], y]);
  for (const x of STORE.aisleXs) for (let i = 1; i < STORE.verticalYs.length; i++) edge([x, STORE.verticalYs[i - 1]], [x, STORE.verticalYs[i]]);
  return nodes;
}

// 18 个不规则货区。通道净宽按 PHYSICS.aisles 设计：
// 横向主通道（y=34/56）净宽约 2.4–2.6 m；纵向次通道（x=20…120）净宽约 1.9 m。
// 每个货区仍位于其通道单元内，A* 边不会穿过货架。
const zoneDefs = [
  // 第一排 — 日用 / 个人护理（y 通道 8..34，货架 15..26）
  { category: 'Personal Care',      x: 25, y: 15, w: 9,  h: 10, kind: 'gondola', height: 1.62 },
  { category: 'Household Essentials',x: 45, y: 15, w: 8,  h: 11, kind: 'gondola', height: 1.86 },
  { category: 'Cleaning Supplies',  x: 64, y: 16, w: 9,  h: 8,  kind: 'gondola', height: 1.45 },
  { category: 'Baby Care',          x: 84, y: 15, w: 8,  h: 10, kind: 'gondola', height: 1.72 },
  { category: 'Stationery',         x: 104,y: 16, w: 9,  h: 9,  kind: 'bulk',    height: 1.38 },
  { category: 'Pet Supplies',       x: 125,y: 15, w: 8,  h: 11, kind: 'gondola', height: 1.70 },
  // 第二排 — 食品饮料（y 通道 34..56，货架 41..49）
  { category: 'Beverages',          x: 25, y: 41, w: 8,  h: 8,  kind: 'cooler',  height: 2.05 },
  { category: 'Dairy & Eggs',       x: 44, y: 41, w: 9,  h: 8,  kind: 'cooler',  height: 2.05 },
  { category: 'Bakery',             x: 64, y: 41, w: 8,  h: 8,  kind: 'bulk',    height: 1.35 },
  { category: 'Snacks',             x: 83, y: 41, w: 9,  h: 8,  kind: 'gondola', height: 1.55 },
  { category: 'Ready Meals',        x: 103,y: 41, w: 9,  h: 8,  kind: 'gondola', height: 1.68 },
  { category: 'Frozen Food',        x: 124,y: 41, w: 8,  h: 8,  kind: 'cooler',  height: 2.10 },
  // 第三排 — 生鲜与粮油（y 通道 56..82，货架 63..75）
  { category: 'Fresh Produce',      x: 24, y: 63, w: 10, h: 12, kind: 'produce', height: 1.12 },
  { category: 'Seafood',            x: 44, y: 63, w: 9,  h: 11, kind: 'cooler',  height: 1.95 },
  { category: 'Meat',               x: 64, y: 63, w: 10, h: 12, kind: 'cooler',  height: 1.95 },
  { category: 'Grains & Oils',      x: 84, y: 63, w: 8,  h: 11, kind: 'gondola', height: 1.78 },
  { category: 'Soy Products',       x: 103,y: 63, w: 10, h: 12, kind: 'cooler',  height: 1.90 },
  { category: 'Condiments',         x: 124,y: 63, w: 9,  h: 12, kind: 'gondola', height: 1.64 },
];

export const shelves = zoneDefs.map((d, i) => {
  const row = Math.floor(i / 6), column = i % 6;
  return {
    id: `${row + 1}-${column + 1}`, category: d.category, kind: d.kind,
    xMin: d.x, xMax: d.x + d.w, yMin: d.y, yMax: d.y + d.h,
    shelfHeight: d.height, row, column,
    point: [STORE.aisleXs[column], [22, 45, 67][row]],
  };
});

// 中文区域名：仅用于场景标牌与 2D 地图，分类键仍保持英文以匹配真实数据。
export const zoneCn = {
  'Personal Care': '个人护理', 'Household Essentials': '家庭日用', 'Cleaning Supplies': '清洁用品',
  'Baby Care': '母婴用品', Stationery: '文具', 'Pet Supplies': '宠物用品', Beverages: '饮品',
  'Dairy & Eggs': '乳制品与蛋类', Bakery: '烘焙', Snacks: '零食小吃', 'Ready Meals': '即食餐',
  'Frozen Food': '冷冻食品', 'Fresh Produce': '生鲜果蔬', Seafood: '海鲜', Meat: '肉类',
  'Grains & Oils': '谷物与食用油', 'Soy Products': '豆制品', Condiments: '调味品',
};
export const zoneName = value => zoneCn[value] || value;

// Non-pickable architectural fixtures. They are drawn in 3D and in the 2D map.
export const layoutFixtures = [
  { label: '乳制品墙', x: 3,   y: 26, w: 5,  h: 16, kind: 'wall' },
  { label: '零食墙', x: 3,   y: 50, w: 5,  h: 14, kind: 'wall' },
  { label: '日用品墙', x: 3,   y: 72, w: 5,  h: 14, kind: 'wall' },
  { label: '后侧冷柜 A', x: 24, y: 87, w: 28, h: 4, kind: 'wall' },
  { label: '后侧冷柜 B', x: 62, y: 87, w: 28, h: 4, kind: 'wall' },
  { label: '后侧冷柜 C', x: 104, y: 87, w: 26, h: 4, kind: 'wall' },
  { label: '冷藏墙', x: 137, y: 44, w: 4, h: 12, kind: 'wall' },
  { label: '食品杂货墙', x: 137, y: 70, w: 4, h: 12, kind: 'wall' },
  { label: '促销岛 A', x: 11, y: 18, w: 8, h: 8, kind: 'promo' },
  { label: '促销岛 B', x: 11, y: 66, w: 8, h: 8, kind: 'promo' },
  { label: '促销岛 C', x: 129, y: 35, w: 7, h: 7, kind: 'promo' },
  { label: '收银台 01', x: 123, y: 4, w: 5, h: 3, kind: 'checkout' },
  { label: '收银台 02', x: 130, y: 4, w: 5, h: 3, kind: 'checkout' },
  { label: '收银台 03', x: 137, y: 4, w: 5, h: 3, kind: 'checkout' },
  { label: '购物车停放区', x: 14, y: 3, w: 10, h: 3, kind: 'cart' },
  { label: '入口', x: 5, y: 8, w: 7, h: 4, kind: 'entrance' },
  { label: '出口', x: 138, y: 8, w: 7, h: 4, kind: 'exit' },
];

// Teaching catalog: English names, mapped to real zones. Price/weight/stock
// are SIMULATED values; the Instacart catalog supplies the real product names.
const productRows = [
  ['Apple', 'Fresh Produce', 'Fruit', 8, 1.4], ['Banana', 'Fresh Produce', 'Fruit', 7, 1.0],
  ['Orange', 'Fresh Produce', 'Fruit', 9, 1.2], ['Tomato', 'Fresh Produce', 'Vegetable', 6, .7],
  ['Broccoli', 'Fresh Produce', 'Vegetable', 8, .6], ['Carrot', 'Fresh Produce', 'Vegetable', 5, .8],
  ['Potato Chips', 'Snacks', 'Chips', 10, .18], ['Biscuits', 'Snacks', 'Bakery Snack', 12, .3],
  ['Chocolate', 'Snacks', 'Confectionery', 16, .15],
  ['Frozen Dumplings', 'Frozen Food', 'Frozen Meal', 24, .8], ['Ice Cream', 'Frozen Food', 'Frozen Dessert', 12, .25],
  ['Soy Sauce', 'Condiments', 'Sauce', 13, .5], ['Salt', 'Condiments', 'Basic', 3, .5],
  ['Shampoo', 'Personal Care', 'Hair Care', 28, .5], ['Toothpaste', 'Personal Care', 'Oral Care', 15, .2],
  ['Laundry Detergent', 'Household Essentials', 'Laundry', 30, 1.2],
  ['Concentrated Detergent', 'Household Essentials', 'Laundry', 34, 1.0],
  ['Paper Towels', 'Household Essentials', 'Paper', 18, .5],
  ['Mineral Water', 'Beverages', 'Water', 4, .55], ['Fruit Juice', 'Beverages', 'Juice', 12, 1.0],
  ['Beverage Pack', 'Beverages', 'Case Pack', 48, 6],
  ['Whole Milk', 'Dairy & Eggs', 'Milk', 14, 1.6], ['Low-fat Milk', 'Dairy & Eggs', 'Milk', 16, 1.5],
  ['Yogurt', 'Dairy & Eggs', 'Chilled Dairy', 11, .5], ['Cheese', 'Dairy & Eggs', 'Cheese', 19, .2],
  ['Toast', 'Bakery', 'Bread', 14, .4], ['Cake', 'Bakery', 'Pastry', 20, .5],
  ['Chicken Breast', 'Meat', 'Poultry', 22, .8], ['Pork', 'Meat', 'Pork', 28, 1.0],
  ['Baby Wipes', 'Baby Care', 'Care', 19, .35], ['Baby Cereal', 'Baby Care', 'Food', 25, .3],
  ['Notebook', 'Stationery', 'Paper', 8, .25], ['Ballpoint Pen', 'Stationery', 'Writing', 5, .05],
  ['Shrimp', 'Seafood', 'Seafood', 36, .7], ['Salmon', 'Seafood', 'Seafood', 45, .5],
  ['Instant Noodles', 'Ready Meals', 'Noodles', 6, .12], ['Ready Rice', 'Ready Meals', 'Rice', 13, .3],
  ['Tofu', 'Soy Products', 'Fresh Soy', 5, .4], ['Soy Milk', 'Soy Products', 'Drink', 7, .5],
  ['Rice', 'Grains & Oils', 'Grain', 32, 2.3], ['Brown Rice', 'Grains & Oils', 'Grain', 35, 2.0],
  ['Cooking Oil', 'Grains & Oils', 'Oil', 42, 1.8],
  ['Cat Food', 'Pet Supplies', 'Pet Food', 34, 1.2], ['Dog Treats', 'Pet Supplies', 'Snack', 18, .3],
  ['Cleaning Spray', 'Cleaning Supplies', 'Spray', 20, .6], ['Trash Bags', 'Cleaning Supplies', 'Consumable', 12, .2],
];

export const products = productRows.map(([name, category, subcategory, price, weight], i) => {
  const shelf = shelves.find(s => s.category === category);
  return {
    id: `G${String(i + 1).padStart(2, '0')}`, name, category, subcategory,
    shelfId: shelf.id, point: [...shelf.point], price, weight,
    capacity: 20, stock: name === 'Salt' ? 1 : name === 'Ice Cream' ? 0 : 20,
    source: 'Simulation catalog',
  };
});

export const timeSlots = [
  { id: '09', label: 'Weekday 09:00' }, { id: '13', label: 'Weekday 13:00' },
  { id: '18', label: 'Weekday 18:00' }, { id: '20', label: 'Weekday 20:00' },
];

// Index order matches shelves[]. Simulated people counts near each zone.
export const crowdSamples = {
  '09': [2,1,1,1,1,1,2,2,1,1,1,1,1,1,1,2,1,1],
  '13': [3,2,1,2,1,1,3,3,2,2,1,1,2,2,1,3,1,1],
  '18': [4,3,2,2,2,2,4,6,5,4,2,1,3,4,3,6,2,2],
  '20': [2,2,1,1,1,1,2,3,2,2,1,1,2,2,1,3,1,1],
};

export function shelfCrowd(slot, shelfId) {
  return crowdSamples[slot]?.[shelves.findIndex(s => s.id === shelfId)] ?? 0;
}

export function peopleForScenario(scenario, slot = '09') {
  const result = shelves.map((s, i) => ({
    id: `P${i + 1}`, zone: s.category,
    point: [s.point[0] + 1.7 + (slot === '20' ? .7 : slot === '13' ? -.6 : 0),
            s.point[1] + (i % 2 ? 3 : -3) + (slot === '18' ? .7 : 0)],
  }));
  if (scenario === 'peak') result.push(
    { id: 'H1', zone: 'Beverages aisle', point: [43, 51] },
    { id: 'H2', zone: 'Central corridor', point: [53, 34] },
    { id: 'H3', zone: 'Central corridor', point: [69, 34] },
    { id: 'H4', zone: 'Grains & Oils aisle', point: [82, 72] },
  );
  if (slot === '13') result.push({ id: 'T13', zone: 'Beverages aisle', point: [22, 30] });
  if (slot === '18') result.push(
    { id: 'T18', zone: 'Dairy aisle', point: [43, 52] },
    { id: 'T18b', zone: 'Grains & Oils aisle', point: [82, 76] },
  );
  return result;
}
