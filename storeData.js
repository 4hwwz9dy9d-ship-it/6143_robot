// NEXUS RETAIL — 单一坐标配置源 / store geometry / product simulation.
// ALL world coordinates (floor, walls, shelves, fixtures, nav graph, robot,
// pedestrians, checkout queues, camera bounds) are derived from STORE below.
// 1 map unit = 0.17 m. Store = 176 x 141 units ≈ 29.9 m x 24.0 m.
// Real product names/categories come from public/data (Instacart). Shelf
// positions, stock, crowd samples and robot capacity are SIMULATION ASSUMPTIONS.

export const PHYSICS = Object.freeze({
  metersPerUnit: 0.17,
  robot: Object.freeze({ width: .62, length: .82, height: .92, radius: .36, maxSpeed: .78, accel: .42, brake: .62, turnRadius: .55 }),
  pedestrian: Object.freeze({ radius: .26, bodyWidth: .46 }),
  safety: Object.freeze({ buffer: .80, warnDistance: 2.0, yieldDistance: 1.35, emergencyGap: .06 }),
  aisles: Object.freeze({ main: 2.7, secondary: 2.0, access: 1.3 }),
});

const M = PHYSICS.metersPerUnit;
const UNIT_W = 176, UNIT_H = 141;

// 货架单元：3 排 × 6 列。通道中心即导航节点，货架永远留在单元内部，
// 因此 A* 边不会穿过任何货架；两侧净空 ≈ 2.0–2.7 m。
const AISLE_XS = [18, 45, 72, 99, 126, 153];
const CROSS_YS = [26, 62, 98, 134];
const VERTICAL_YS = [26, 44, 62, 80, 98, 116, 134];
const ROW_CENTERS = [44, 80, 116];
const colCenter = c => (c < AISLE_XS.length - 1 ? (AISLE_XS[c] + AISLE_XS[c + 1]) / 2 : (AISLE_XS[c] + UNIT_W) / 2);

// 收银台队列：顾客排队区在前场 y<26，与机器人 y=26 主通道分离。
// 每个收银台有独立队列位与容量上限，避免所有人涌向同一坐标。
// slots 从队尾(y=22)排到队首(y=10)：队首正对收银台，顾客在此完成结账。
const LANE_XS = [132, 144, 156, 168];
const queueSlots = x => [22, 18, 14, 10].map(y => [x, y]);

// V2.8：机器人自助收银台（机身中心 / 机器人买单停靠位）。单独抽成常量，
// 因为 STORE.handoff 也要指向它（历史代码里 handoff 表示「订单终点」）。
const ROBOT_PAY_POS = Object.freeze([120, 10]);
const ROBOT_PAY_STOP = Object.freeze([120, 15.4]);

export const STORE = {
  width: UNIT_W, height: UNIT_H,
  meters: Object.freeze({ width: +(UNIT_W * M).toFixed(2), height: +(UNIT_H * M).toFixed(2) }),
  entrance: [8, 26], checkout: [150, 26], exit: [170, 26],
  // V2.8：订单终点从「文具与宠物用品之间的店内交接区 [153,44]」改成
  // 机器人专用自助收银台（充电桩右侧）。机器人取完所有商品后先去自助收银台结算，
  // 平台收到账单、用户在线上确认订单后才返回充电桩补电。
  // handoff 这个名字保留为「订单终点」的兼容别名，避免整条链路再改一遍。
  handoff: [...ROBOT_PAY_STOP],
  aisleXs: AISLE_XS, crossYs: CROSS_YS, verticalYs: VERTICAL_YS,
  hotCorridor: Object.freeze({ y: 62, xMin: 45, xMax: 99 }),
  frontZone: Object.freeze({ yMin: 2, yMax: 26 }),
  // 墙体真实开口：行人只能从左入口进入、从右出口离开。
  // V2.3：开口加宽（5.2→6.6，约 1.77m→2.24m），高峰时段行人出入更宽松、不与门框拥挤。
  openings: Object.freeze({
    entrance: Object.freeze({ y: 26, halfHeight: 6.6 }),
    exit: Object.freeze({ y: 26, halfHeight: 6.6 }),
  }),
  checkoutLanes: LANE_XS.map((x, i) => ({
    id: `LANE-${i + 1}`, x,
    counter: [x, 6], payPoint: [x, 10],
    slots: queueSlots(x), capacity: 4,
    robotWait: [x - 5, 26],
  })),
  // V2.6：收银服务时间（仿真秒）。顾客走到队首后由该收银台的店员完成扫码收款，
  // 服务的时长由购物篮件数决定（件数多 = 买得多 = 结账慢），服务结束立即离店。
  checkoutService: Object.freeze({ base: 2.0, perItem: .34, min: 2.0, max: 5.2 }),
  // V2.1：唯一入口生成点。所有行人只能从左墙开口(入口)进入，不再从店内凭空出现。
  spawnPoints: Object.freeze([[8, 26], [10, 26], [6, 26], [12, 26], [8, 24], [8, 28]]),
  // V2.8：机器人最终停靠点 = 充电桩。桩体已从 x=116 左移到 x=108，
  // 让出右侧空间给「机器人自助收银台」（x=120），三者在收银台 1（左缘 127.5）
  // 与前场空地之间各留 ≥1 m 通道，不再挤成一堆。
  // 桩体中心 position=[108,8]；机器人对接位 dockSlot=[108,13.4] 在桩体正前方 5.4 单位
  // （≈0.92 m）处，车体（半深 2.35 单位）与桩体底座（半宽 2.06 单位）之间留 1.0 单位
  // （≈0.17 m）净空，机器人正面朝向桩体、机械臂在车头朝外，停靠不会与桩体穿模。
  chargingDocks: Object.freeze([
    Object.freeze({ id: 'CHG-1', position: [108, 8], dockSlot: [108, 13.4] }),
  ]),
  // V2.8：机器人专用自助收银台（按工业设计三视图 1600 × 600 × 650 mm 建模）。
  // 位于充电桩右侧 x=120、y=10（机身 3.6 × 3.9 单位 ≈ 0.61 × 0.66 m），
  // 左距充电桩 6.1 单位（≈1.04 m）、右距收银台 1 左缘 5.7 单位（≈0.97 m）。
  // stop 是机器人买单时的停靠位（机身正前方 3.45 单位 ≈ 0.59 m，车头距台面 0.19 m），
  // 机械臂（水平伸展 0.30 m）可以伸到 0.86 m 高的台面上放购物篮。
  robotPayStations: Object.freeze([
    Object.freeze({
      id: 'RPOS-1', position: [...ROBOT_PAY_POS], stop: [...ROBOT_PAY_STOP],
      width: 3.6, depth: 3.9, height: 1.6,
    }),
  ]),
  // V2.7/V2.8：1 号位就是充电桩对接位（机器人默认在桩上待命，下一单从桩上出发）；
  // 2 号位是备用泊位，位于 1 号位左侧，两处都不在排队区、不在主通道上。
  robotWaitSlots: Object.freeze([[108, 13.4], [102, 13.4]]),
  robotWait: [108, 13.4],
  exitLane: [170, 20],
  outsideExit: [182, 26],
  // 机器人从右墙出口离开后，经场景外侧服务通道返回左入口（不穿墙、不瞬移）。
  // 外侧通道位于墙体之外，3D 场景有对应铺装地面；仅机器人使用，行人导航图不含这些边。
  // V2.5：整备点移到前墙外侧服务通道中央 [88,-8]，与右墙出口开口相距约 100 单位（17 m）。
  // 出门后先沿外墙南下 → 西行到整备点停 3 秒 → 继续西行 → 从左入口回归泊位。
  // 因此出口周边（含门内、门外、行人出店动线 y=26）全程没有任何机器人停留点。
  outsideReturn: Object.freeze({
    exitOuter: [182, 26], rightSouth: [182, -8],
    staging: [88, -8],
    frontSouth: [-8, -8], entranceOuter: [-8, 26],
  }),
};

export const CAMERA = Object.freeze({
  full:   Object.freeze({ position: [0, 26, 32], target: [0, .4, 0] }),
  iso:    Object.freeze({ position: [22, 27, 32], target: [0, .4, 0] }),
  top:    Object.freeze({ position: [0, 42, .6], target: [0, 0, 0] }),
  minDistance: 6, maxDistance: 80,
  worldRadius: +(Math.hypot(UNIT_W * M, UNIT_H * M) / 2).toFixed(1),
});

export const nodeKey = p => p.join(',');

// 机器人与行人共用同一张通道图，避免两套坐标/连通性。
export function buildNavNodes({ includeOutside = false } = {}) {
  const nodes = new Map();
  const edge = (a, b) => {
    for (const p of [a, b]) if (!nodes.has(nodeKey(p))) nodes.set(nodeKey(p), { point: p, neighbors: [] });
    nodes.get(nodeKey(a)).neighbors.push(nodeKey(b));
    nodes.get(nodeKey(b)).neighbors.push(nodeKey(a));
  };
  const bottomXs = [...new Set([STORE.entrance[0], ...STORE.robotWaitSlots.map(s => s[0]), ...STORE.aisleXs,
    ...LANE_XS, STORE.checkout[0], STORE.exit[0],
    ...STORE.chargingDocks.map(d => d.position[0]),
    ...STORE.robotPayStations.map(s => s.stop[0])])].sort((a, b) => a - b);
  for (let i = 1; i < bottomXs.length; i++) edge([bottomXs[i - 1], CROSS_YS[0]], [bottomXs[i], CROSS_YS[0]]);
  for (const y of CROSS_YS.slice(1)) for (let i = 1; i < AISLE_XS.length; i++) edge([AISLE_XS[i - 1], y], [AISLE_XS[i], y]);
  for (const x of AISLE_XS) for (let i = 1; i < VERTICAL_YS.length; i++) edge([x, VERTICAL_YS[i - 1]], [x, VERTICAL_YS[i]]);
  // 等待泊位支线：泊位在前场 y=8~13，纵向连到 y=26 主通道，不占入口水平通道。
  for (const slot of STORE.robotWaitSlots) edge(slot, [slot[0], CROSS_YS[0]]);
  // V2.7：充电桩桩体是实体（行人也不能穿过），不进入导航图；只把「对接位」当作节点。
  // 对接位与备用泊位之间建立短边，回坞/换位不必绕走主通道。
  for (const dock of STORE.chargingDocks) {
    const slot = dock.dockSlot || dock.position;
    for (const other of STORE.robotWaitSlots) {
      if (other[0] === slot[0] && other[1] === slot[1]) continue;
      if (Math.hypot(other[0] - slot[0], other[1] - slot[1]) <= 14) edge(slot, other);
    }
  }
  // 收银队列接到前场主通道，并沿排队通道逐位连通：顾客从队尾进入、向前走到自己的站位。
  // 这一组队内纵向边很关键——否则离队首最近的导航点会变成机器人泊位，
  // 顾客去结账时会被导航「带进」机器人停靠位。
  for (const lane of STORE.checkoutLanes) {
    edge(lane.slots[0], [lane.x, 26]);
    for (let i = 1; i < lane.slots.length; i++) edge(lane.slots[i - 1], lane.slots[i]);
  }
  // V2.8：机器人自助收银台的买单位：接到前场主通道；与附近停靠位之间补短边，
  // 结算完回桩、或从桩上出发来买单都不必绕主通道。
  for (const pay of STORE.robotPayStations) {
    edge(pay.stop, [pay.stop[0], CROSS_YS[0]]);
    for (const slot of STORE.robotWaitSlots) {
      if (Math.hypot(slot[0] - pay.stop[0], slot[1] - pay.stop[1]) <= 14) edge(pay.stop, slot);
    }
  }
  edge(STORE.exitLane, STORE.exit);
  edge(STORE.exit, STORE.outsideExit);
  if (includeOutside) {
    const o = STORE.outsideReturn;
    edge(o.exitOuter, o.rightSouth);
    edge(o.rightSouth, o.staging);
    edge(o.staging, o.frontSouth);
    edge(o.frontSouth, o.entranceOuter);
    edge(o.entranceOuter, STORE.entrance);
  }
  return nodes;
}

// 18 个不规则货区。w/h 在各自单元内变化，通道净宽 2.0–2.7 m。
const zoneDefs = [
  // 第一排 — 日用 / 个人护理
  { category: 'Personal Care',       col: 0, row: 0, w: 14, h: 18, kind: 'gondola', height: 1.62 },
  { category: 'Household Essentials',col: 1, row: 0, w: 13, h: 20, kind: 'gondola', height: 1.86 },
  { category: 'Cleaning Supplies',   col: 2, row: 0, w: 15, h: 16, kind: 'gondola', height: 1.45 },
  { category: 'Baby Care',           col: 3, row: 0, w: 12, h: 19, kind: 'gondola', height: 1.72 },
  { category: 'Stationery',          col: 4, row: 0, w: 14, h: 17, kind: 'bulk',    height: 1.38 },
  { category: 'Pet Supplies',        col: 5, row: 0, w: 13, h: 18, kind: 'gondola', height: 1.70 },
  // 第二排 — 食品饮料
  { category: 'Beverages',           col: 0, row: 1, w: 14, h: 18, kind: 'cooler',  height: 2.05 },
  { category: 'Dairy & Eggs',        col: 1, row: 1, w: 13, h: 19, kind: 'cooler',  height: 2.05 },
  { category: 'Bakery',              col: 2, row: 1, w: 15, h: 17, kind: 'bulk',    height: 1.38 },
  { category: 'Snacks',              col: 3, row: 1, w: 12, h: 20, kind: 'gondola', height: 1.55 },
  { category: 'Ready Meals',         col: 4, row: 1, w: 14, h: 16, kind: 'gondola', height: 1.68 },
  { category: 'Frozen Food',         col: 5, row: 1, w: 13, h: 18, kind: 'cooler',  height: 2.10 },
  // 第三排 — 生鲜与粮油
  { category: 'Fresh Produce',       col: 0, row: 2, w: 16, h: 18, kind: 'produce', height: 1.12 },
  { category: 'Seafood',             col: 1, row: 2, w: 13, h: 17, kind: 'cooler',  height: 1.95 },
  { category: 'Meat',                col: 2, row: 2, w: 15, h: 19, kind: 'cooler',  height: 1.95 },
  { category: 'Grains & Oils',       col: 3, row: 2, w: 12, h: 18, kind: 'gondola', height: 1.78 },
  { category: 'Soy Products',        col: 4, row: 2, w: 14, h: 20, kind: 'cooler',  height: 1.90 },
  { category: 'Condiments',          col: 5, row: 2, w: 13, h: 16, kind: 'gondola', height: 1.64 },
];

export const shelves = zoneDefs.map((d, i) => {
  // 单元内确定性错位：同一列的货架不在一条直线上，形成更自然的卖场层次；
  // 偏移量控制在单元净空内，不侵入任何 A* 通道节点/边。
  const jitterX = ((i * 7) % 5 - 2) * .9;   // -1.8 ~ +1.8 单位
  const jitterY = ((i * 11) % 5 - 2) * 1.1; // -2.2 ~ +2.2 单位
  const cx = colCenter(d.col) + jitterX, cy = ROW_CENTERS[d.row] + jitterY;
  return {
    id: `${d.row + 1}-${d.col + 1}`, category: d.category, kind: d.kind,
    xMin: +(cx - d.w / 2).toFixed(2), xMax: +(cx + d.w / 2).toFixed(2),
    yMin: +(cy - d.h / 2).toFixed(2), yMax: +(cy + d.h / 2).toFixed(2),
    shelfHeight: d.height, row: d.row, column: d.col,
    // 取货点位于左侧通道上的导航节点，距离货架边缘约 1.1 m。
    point: [AISLE_XS[d.col], ROW_CENTERS[d.row]],
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

// 不可取货的建筑装置。3D 与 2D 地图都从此处绘制。
export const layoutFixtures = [
  { label: '乳品冷藏墙', x: 4,   y: 44,  w: 5,  h: 18, kind: 'wall' },
  { label: '零食墙',     x: 4,   y: 80,  w: 5,  h: 18, kind: 'wall' },
  { label: '日用墙',     x: 4,   y: 116, w: 5,  h: 18, kind: 'wall' },
  { label: '后侧冷柜 A', x: 40,  y: 137, w: 34, h: 5,  kind: 'wall' },
  { label: '后侧冷柜 B', x: 90,  y: 137, w: 34, h: 5,  kind: 'wall' },
  { label: '后侧冷柜 C', x: 140, y: 137, w: 32, h: 5,  kind: 'wall' },
  { label: '冷藏侧柜',   x: 172, y: 80,  w: 5,  h: 20, kind: 'wall' },
  { label: '杂货侧柜',   x: 172, y: 116, w: 5,  h: 18, kind: 'wall' },
  { label: '促销岛 A',   x: 45,  y: 12,  w: 11, h: 9,  kind: 'promo' },
  { label: '促销岛 B',   x: 72,  y: 12,  w: 11, h: 9,  kind: 'promo' },
  // V2.2：促销岛 C 从 x=126 移到前场空地；V2.8 再左移到 x=94，
  // 给「充电桩(x=108) + 机器人自助收银台(x=120)」这一排让出 ≥1 m 的通行间隙。
  { label: '促销岛 C',   x: 94,  y: 12,  w: 10, h: 9,  kind: 'promo' },
  // 两台自助结账机：位于前场空位，不占机器人主通道 y=26，也不与收银台/排队区重叠。
  { label: '自助结账 1', x: 56,  y: 6,   w: 7,  h: 4,  kind: 'kiosk' },
  { label: '自助结账 2', x: 84,  y: 6,   w: 7,  h: 4,  kind: 'kiosk' },
  // V2.8：收银台按三视图放大到 1.53 × 0.61 m（台面 820 mm 高），不再是一张 0.28 m 的矮台。
  ...STORE.checkoutLanes.map((lane, i) => ({ label: `收银台 ${String(i + 1).padStart(2, '0')}`, x: lane.x, y: 6, w: 9, h: 3.6, kind: 'checkout' })),
  ...STORE.checkoutLanes.map((lane, i) => ({ label: `排队区 ${i + 1}`, x: lane.x, y: 16, w: 4, h: 15, kind: 'queue' })),
  // V2.7：机器人停靠位（1 号位=充电桩对接位）标线收窄到 5×6，避免与桩体底座/邻位标线重叠。
  ...STORE.robotWaitSlots.map((p, i) => ({ label: `停靠位 ${i + 1}`, x: p[0], y: p[1], w: 5, h: 6, kind: 'robotwait' })),
  // V2.7：充电桩是实体装置（行人/机器人都不穿模），单独标记，供 2D 绘制与行人避障共用。
  ...STORE.chargingDocks.map(d => ({ label: '充电桩', x: d.position[0], y: d.position[1], w: 5, h: 5, kind: 'charger' })),
  { label: '购物车停放区', x: 10,  y: 9,  w: 11, h: 7,  kind: 'cart' },
  // V2.8：机器人自助收银台（实体装置，行人绕行；机器人停在其前方的买单位）。
  ...STORE.robotPayStations.map(s => ({ label: '机器人自助收银', x: s.position[0], y: s.position[1], w: s.width, h: s.depth, kind: 'robotpay' })),
  // V2.8：买单位地面标线（不是实体障碍，行人可正常通行）。
  ...STORE.robotPayStations.map(s => ({ label: '买单位', x: s.stop[0], y: s.stop[1], w: 5, h: 6, kind: 'handoff' })),
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
  { id: '09', label: '工作日 09:00' }, { id: '13', label: '工作日 13:00' },
  { id: '18', label: '工作日 18:00' }, { id: '20', label: '工作日 20:00' },
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

// 规则层静态行人（2D 地图/热力提示）。自主行人的生成由 pedestrian.js 负责。
export function peopleForScenario(scenario, slot = '09') {
  const result = shelves.map((s, i) => ({
    id: `P${i + 1}`, zone: s.category,
    point: [s.point[0] + 2.6 + (slot === '20' ? 1 : slot === '13' ? -1 : 0),
            s.point[1] + (i % 2 ? 5 : -5) + (slot === '18' ? 1 : 0)],
  }));
  if (scenario === 'peak') result.push(
    { id: 'H1', zone: '饮品通道', point: [47, 80] },
    { id: 'H2', zone: '中央主通道', point: [70, 62] },
    { id: 'H3', zone: '中央主通道', point: [99, 62] },
    { id: 'H4', zone: '粮油通道', point: [102, 116] },
  );
  if (slot === '13') result.push({ id: 'T13', zone: '饮品通道', point: [18, 44] });
  if (slot === '18') result.push(
    { id: 'T18', zone: '乳品通道', point: [45, 80] },
    { id: 'T18b', zone: '粮油通道', point: [99, 116] },
  );
  return result;
}
