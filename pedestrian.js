// NEXUS RETAIL — 行人自主仿真系统 (SIMULATION，规则驱动，非真实视觉识别)。
// 坐标来自 storeData.js 共享地图单位 (1 unit = 0.17 m)。
// 本版修复：渐进分批入场 / 多生成点 / 安全间距 / 货架墙碰撞 /
// 收银台独立队列位与容量上限 / 机器人通道与顾客排队区分离。
import { STORE, PHYSICS, shelves, layoutFixtures, buildNavNodes, nodeKey } from './storeData.js';

const M = PHYSICS.metersPerUnit;
const TAU = Math.PI * 2;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerpAngle = (a, b, t) => {
  const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};
// 队列站位：index 0 = 队首（正对收银台），index 越大越靠后。
const queueSpot = (lane, index) => lane.slots[lane.capacity - 1 - clamp(index, 0, lane.capacity - 1)];
// 结账离店动线：从队首先侧向让出排队通道（不穿过仍在排队的人），再汇入 y=26 主通道走向出口。
const exitLaneX = lane => (lane.x < STORE.checkout[0] ? lane.x + 6 : lane.x - 6);
// V3.2：行人 id → [0,1) 的稳定散列（不消耗种子随机流，同一行人永远走同一条过门车道）。
const doorLaneHash = id => {
  const str = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};

// 参考图 6 套真实服装角色（店员绿马甲 / 米色衬衫 / 绿毛衣 / 藏青风衣 / 酒红开衫 / 灰夹克）
export const PEDESTRIAN_TYPES = Object.freeze({
  regular:  { key: 'regular',  name: 'Regular Shopper',  cn: '普通顾客',   speed: .95, height: 1.72, radius: .24, browse: [2, 5],  cart: false, look: 1 },
  slow:     { key: 'slow',     name: 'Slow Walker',      cn: '慢速顾客',   speed: .62, height: 1.64, radius: .25, browse: [4, 8],  cart: false, look: 4 },
  cart:     { key: 'cart',     name: 'Cart Shopper',     cn: '推车顾客',   speed: .78, height: 1.70, radius: .38, browse: [2, 4],  cart: true,  look: 5 },
  browsing: { key: 'browsing', name: 'Browsing Shopper', cn: '浏览顾客',   speed: .72, height: 1.68, radius: .24, browse: [6, 12], cart: false, look: 2 },
  fast:     { key: 'fast',     name: 'Fast Walker',      cn: '快速顾客',   speed: 1.35, height: 1.80, radius: .23, browse: [.5, 1.5], cart: false, look: 3 },
});

export const PEDESTRIAN_STATES = Object.freeze([
  'ENTER_STORE', 'WALK_TO_SECTION', 'WALKING', 'BROWSING', 'STOPPING',
  'TURNING', 'QUEUEING', 'GOING_TO_CHECKOUT', 'EXITING', 'DETOUR',
]);

function makeRandom(seed = 6143) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function routeBetween(nodes, from, to) {
  const a = [...nodes.values()].reduce((best, n) => dist(n.point, from) < dist(best.point, from) ? n : best);
  const b = [...nodes.values()].reduce((best, n) => dist(n.point, to) < dist(best.point, to) ? n : best);
  const start = nodeKey(a.point), finish = nodeKey(b.point);
  const costs = new Map([[start, 0]]), prev = new Map(), open = new Set([start]);
  while (open.size) {
    let current = [...open].reduce((x, y) => (costs.get(x) ?? Infinity) <= (costs.get(y) ?? Infinity) ? x : y);
    if (current === finish) break;
    open.delete(current);
    const node = nodes.get(current);
    for (const nk of node.neighbors) {
      const score = costs.get(current) + dist(node.point, nodes.get(nk).point);
      if (score < (costs.get(nk) ?? Infinity)) { costs.set(nk, score); prev.set(nk, current); open.add(nk); }
    }
  }
  if (!costs.has(finish)) return [from, to];
  const chain = [nodes.get(finish).point];
  let cursor = finish;
  while (prev.has(cursor)) { cursor = prev.get(cursor); chain.unshift(nodes.get(cursor).point); }
  if (dist(from, chain[0]) > .01) chain.unshift(from);
  if (dist(chain.at(-1), to) > .01) chain.push(to);
  if (chain.length > 3 && dist(chain[1], to) > dist(chain[2], to)) chain.splice(1, 1);
  return chain;
}

export class PedestrianSystem {
  constructor(options = {}) {
    this.nodes = options.nodes || buildNavNodes();
    this.random = makeRandom(options.seed ?? 6143);
    this.people = [];
    this.nextId = 1;
    this.density = options.density ?? 'low';
    this.mode = options.mode ?? 'shopping';
    this.speedFactor = options.speedFactor ?? 1;
    this.running = false;
    this.spawnCooldown = 0;
    this.clock = 0;
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0, queueWaits: 0, maxQueue: 0, detours: 0,
      checkoutServed: 0, checkoutWaitSum: 0 };
    this.densityTarget = { low: 7, medium: 16, high: 30 }[this.density] ?? 7;
    this.lanes = this.makeLanes();
  }

  /** 收银台运行态：队列表 + 正在结账的计时 + 服务人次，全部按真实排队顺序维护。 */
  makeLanes() {
    return STORE.checkoutLanes.map(l => ({ ...l, queue: [], served: 0, serveLeft: 0, waitSum: 0, waitCount: 0 }));
  }

  get targetCount() { return this.mode === 'crowded' ? Math.max(24, this.densityTarget) : this.densityTarget; }

  configure({ density, mode, speedFactor, running } = {}) {
    if (density) { this.density = density; this.densityTarget = { low: 7, medium: 16, high: 30 }[density] ?? 7; }
    if (mode) this.mode = mode;
    if (typeof speedFactor === 'number') this.speedFactor = clamp(speedFactor, .5, 1.6);
    if (typeof running === 'boolean') this.running = running;
    return this;
  }

  reset() {
    this.people = []; this.nextId = 1; this.random = makeRandom(6143);
    this.spawnCooldown = 0; this.clock = 0;
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0, queueWaits: 0, maxQueue: 0, detours: 0,
      checkoutServed: 0, checkoutWaitSum: 0 };
    this.lanes = this.makeLanes();
    if (this.running) this.fill();
  }

  setDensity(density) { return this.configure({ density }); }
  setMode(mode) { return this.configure({ mode }); }
  setSpeedFactor(factor) { return this.configure({ speedFactor: factor }); }
  start() { return this.configure({ running: true }); }
  pause() { return this.configure({ running: false }); }

  pickType() {
    const r = this.random();
    if (this.mode === 'crowded') return r < .28 ? 'cart' : r < .5 ? 'slow' : r < .75 ? 'regular' : 'fast';
    if (this.mode === 'crossing') return r < .45 ? 'cart' : r < .8 ? 'regular' : 'fast';
    if (this.mode === 'natural') return r < .18 ? 'cart' : r < .38 ? 'fast' : r < .58 ? 'slow' : r < .78 ? 'browsing' : 'regular';
    return r < .16 ? 'cart' : r < .36 ? 'browsing' : r < .56 ? 'slow' : r < .74 ? 'fast' : 'regular';
  }

  pickSection() {
    const s = shelves[Math.floor(this.random() * shelves.length)];
    const side = this.random() < .5 ? -1 : 1;
    return {
      point: [s.point[0] + side * (1.4 + this.random() * .8), s.point[1] + (this.random() - .5) * 2.4],
      shelfId: s.id,
      // 面向货架：取货点相对货架中心的方向（地图坐标），3D 用它旋转人物正面。
      faceHeading: Math.atan2((s.xMin + s.xMax) / 2 - (s.point[0] + side * 1.8),
        (s.yMin + s.yMax) / 2 - s.point[1]),
      pickTier: Math.floor(this.random() * 3),
    };
  }

  /**
   * 购物篮规模（= 要逛几个货区）：
   * 「买得少、买得快」的顾客只逛 1 个货区就直奔收银台，买得多的逛 2–3 个。
   * 高峰时段( crowded ) 小篮顾客比例更高，收银台才会真的排起队。
   */
  pickBasket(typeKey) {
    const r = this.random();
    if (this.mode === 'crowded') return r < .42 ? 1 : r < .78 ? 2 : 3;
    if (typeKey === 'fast') return r < .72 ? 1 : 2;
    if (typeKey === 'cart') return r < .28 ? 1 : r < .72 ? 2 : 3;
    return r < .38 ? 1 : r < .74 ? 2 : 3;
  }

  /** 结账服务时长（仿真秒）：件数越多扫得越久，服务结束顾客立即离店。 */
  serviceSeconds(items, basket = 2) {
    const cfg = STORE.checkoutService || { base: 2.2, perItem: .5, min: 2.2, max: 6.5 };
    return clamp(cfg.base + items * cfg.perItem + basket * .12, cfg.min, cfg.max);
  }

  /** 在货架/设备/墙体内则拒绝生成；左右墙仅入口/出口高度允许进出。 */
  isFree(point, radiusM, robotPoint = null) {
    const r = radiusM / M;
    const inOpeningY = Math.abs(point[1] - STORE.openings.entrance.y) <= STORE.openings.entrance.halfHeight - r;
    const minX = inOpeningY ? 0 : 4 + r;
    const maxX = inOpeningY ? STORE.width : STORE.width - 4 - r;
    if (point[0] < minX || point[0] > maxX || point[1] < 4 + r || point[1] > STORE.height - 4 - r) return false;
    if (this.blockedByFixture(point[0], point[1], { radius: radiusM })) return false;
    for (const p of this.people) if (dist(point, p.position) < (radiusM + p.radius) / M + .5) return false;
    if (robotPoint && dist(point, robotPoint) < 3.2 / M) return false;
    return true;
  }

  /** 将任意请求点吸附到最近的合法点，避免注入场景时穿墙/穿货架。 */
  safePoint(point, radiusM = .26) {
    if (this.isFree(point, radiusM)) return [...point];
    for (let ring = 1; ring <= 12; ring++) for (let k = 0; k < 12; k++) {
      const angle = k / 12 * TAU;
      const candidate = [point[0] + Math.cos(angle) * ring * 1.4, point[1] + Math.sin(angle) * ring * 1.4];
      if (this.isFree(candidate, radiusM)) return candidate;
    }
    return [...STORE.entrance];
  }

  /** 多生成点 + 安全间距；找不到空位则本次跳过，等待下一帧。 */
  spawnOne(robotPoint = null, forced = {}) {
    const typeKey = forced.type || this.pickType();
    const type = PEDESTRIAN_TYPES[typeKey];
    let position = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const base = STORE.spawnPoints[Math.floor(this.random() * STORE.spawnPoints.length)];
      const candidate = [base[0] + (this.random() - .5) * 2.4, base[1] + (this.random() - .5) * 3.2];
      if (this.isFree(candidate, type.radius, robotPoint)) { position = candidate; break; }
    }
    if (!position) return null;
    const basket = this.pickBasket(typeKey);
    const items = 2 + basket * 3 + Math.floor(this.random() * 4);
    const person = {
      id: `PED-${String(this.nextId++).padStart(2, '0')}`,
      type: typeKey, typeName: type.name, cn: type.cn,
      position, velocity: [0, 0],
      heading: (this.random() - .5) * .5 + Math.PI / 2, // 不同朝向进入
      speed: type.speed * this.speedFactor,
      radius: type.radius, height: type.height, cart: type.cart,
      look: type.look, style: Math.floor(this.random() * 6),
      state: 'ENTER_STORE', timer: 0, phase: this.random() * TAU,
      route: [], routeIndex: 0, goal: null, sections: 1, basket, items,
      serviceSeconds: this.serviceSeconds(items, basket),
      yieldToRobot: 0, blocked: 0, crossing: !!forced.crossing,
      yieldSide: 0, yieldTimer: 0,
      // V2.5 僵局脱离：与机器人持续近距离对峙时，行人明确换一条方向绕行，
      // 而不是反复侧移贴着机器人「绕圈」。
      stallTimer: 0, detourCooldown: 0, detourGoal: null, detourReturn: null,
      lane: null, queueSlot: -1, queueIndex: -1, queueJoinAt: 0, queueArrivedAt: 0, serving: false,
      color: [0x2f6b4f, 0xc2a878, 0x3f5a42, 0x243b52, 0x7d3341, 0x4a4f55][type.look % 6],
      skin: [0xf0c9a8, 0xe0ae87, 0xc98d68, 0x8d5c42, 0xf5d7b8][Math.floor(this.random() * 5)],
    };
    this.metrics.spawned++;
    return person;
  }

  fill(robotPoint = null, immediate = false) {
    // immediate 用于测试预设；正常运行时由 update() 渐进分批入场。
    let guard = 0;
    while (this.people.length < this.targetCount && guard++ < (immediate ? 40 : 1)) {
      const person = this.spawnOne(robotPoint);
      if (!person) break;
      const section = this.pickSection();
      person.section = section;
      this.sendTo(person, section.point, 'ENTER_STORE');
      this.people.push(person);
    }
  }

  sendTo(person, goal, state = 'WALK_TO_SECTION') {
    person.goal = [...goal];
    // 排队位与出口都是「别人站过/正在让出的合法位置」，不做安全点吸附，
    // 否则队伍前进时每个人都会被挤偏，队列会散开。
    const safeGoal = (state === 'EXITING' || state === 'GOING_TO_CHECKOUT') ? [...goal] : this.safePoint(goal, person.radius);
    person.route = routeBetween(this.nodes, this.safePoint(person.position, person.radius), safeGoal);
    person.routeIndex = Math.min(1, person.route.length - 1);
    person.state = state;
  }

  /**
   * V2.5 僵局脱离：行人与机器人持续近距离对峙（双方都在减速/侧移却谁也过不去）时，
   * 不再原地侧移贴着机器人「绕圈」，而是明确换一个方向——绕到机器人侧后方的临时点，
   * 到达后再重新规划回原目标。对应现实中「人完全可以换个方向走」。
   */
  beginDetour(person, robot) {
    const goal = person.goal ? [...person.goal]
      : (person.section?.point ? [...person.section.point] : [...STORE.exit]);
    // V3.1：绕行点放在机器人**后方**（沿「机器人 → 原目标」反方向退、再向行人所在侧拉开
    // ≈2 m）。旧版把绕行点放在机器人前方，行人会从机器人面前斜切过去、看起来像「围着机器转」；
    // 真人遇到挡路的机器人会退半步、从它背后绕过去继续走。
    const axis = [goal[0] - robot.position[0], goal[1] - robot.position[1]];
    const g = Math.hypot(axis[0], axis[1]) || 1;
    const fwd = [axis[0] / g, axis[1] / g];
    const side = [-fwd[1], fwd[0]];
    const rel = [person.position[0] - robot.position[0], person.position[1] - robot.position[1]];
    const sign = (rel[0] * side[0] + rel[1] * side[1]) >= 0 ? 1 : -1;
    const raw = [
      robot.position[0] - fwd[0] * 12 + side[0] * sign * 14,
      robot.position[1] - fwd[1] * 12 + side[1] * sign * 14,
    ];
    const pt = [clamp(raw[0], 6, STORE.width - 6), clamp(raw[1], 6, STORE.height - 6)];
    // V3.1b：脱离点吸附到导航图节点——「离机器人 ≥16 单位（≈2.7 m）且顺路（离人也近、
    // 离原目标也近）」的节点优先。旧版直接用几何偏移点，路线可能贴着机器人甚至被货架
    // 卡死（行人在货架边反复蹭=另一种「围机器人转」）。
    let escape = this.safePoint(pt, person.radius);
    let bestScore = Infinity;
    for (const node of this.nodes.values()) {
      const p2 = node.point;
      const dRobot = dist(p2, robot.position), dPerson = dist(p2, person.position);
      if (dRobot < 16 || dPerson < 8 || dPerson > 46) continue;
      const score = dPerson + dist(p2, goal);
      if (score < bestScore) { bestScore = score; escape = [...p2]; }
    }
    person.detourGoal = goal;
    person.detourReturn = person.state === 'DETOUR' ? 'WALK_TO_SECTION' : person.state;
    this.sendTo(person, escape, 'DETOUR');
    person.detourCooldown = 6.0;
    person.stallTimer = 0;
    person.yieldTimer = 0;
    this.metrics.detours++;
  }

  injectCrossing(robotPoint, robotDirection = [1, 0], options = {}) {
    const dir = normalize(robotDirection);
    const side = [-dir[1], dir[0]];
    const ahead = options.ahead ?? 13;
    const lateral = options.lateral ?? 8;
    const center = [robotPoint[0] + dir[0] * ahead, robotPoint[1] + dir[1] * ahead];
    const rawFrom = [clamp(center[0] - side[0] * lateral, 6, STORE.width - 6), clamp(center[1] - side[1] * lateral, 6, STORE.height - 6)];
    const rawTo = [clamp(center[0] + side[0] * lateral * 1.35, 6, STORE.width - 6), clamp(center[1] + side[1] * lateral * 1.35, 6, STORE.height - 6)];
    const person = this.spawnOne(robotPoint, { type: options.type || 'cart', crossing: true });
    if (!person) return null;
    const from = this.safePoint(rawFrom, person.radius);
    const to = this.safePoint(rawTo, person.radius);
    person.position = [...from];
    person.route = routeBetween(this.nodes, from, to); person.routeIndex = Math.min(1, person.route.length - 1);
    person.goal = [...to]; person.state = 'WALKING';
    this.people.push(person);
    return person;
  }

  injectHeadOn(robotPoint, robotDirection = [1, 0], options = {}) {
    const dir = normalize(robotDirection);
    const ahead = options.ahead ?? 16;
    const rawFrom = [clamp(robotPoint[0] + dir[0] * ahead, 6, STORE.width - 6), clamp(robotPoint[1] + dir[1] * ahead, 6, STORE.height - 6)];
    const person = this.spawnOne(robotPoint, { type: options.type || 'regular', crossing: true });
    if (!person) return null;
    const from = this.safePoint(rawFrom, person.radius);
    const rawTo = [clamp(from[0] - dir[0] * 18, 6, STORE.width - 6), clamp(from[1] - dir[1] * 18, 6, STORE.height - 6)];
    const to = this.safePoint(rawTo, person.radius);
    person.position = [...from];
    person.route = routeBetween(this.nodes, from, to); person.routeIndex = Math.min(1, person.route.length - 1);
    person.goal = [...to]; person.state = 'WALKING';
    this.people.push(person);
    return person;
  }

  applyPreset(name, robotPoint = STORE.entrance, robotDirection = [1, 0]) {
    this.reset();
    switch (name) {
      case 'crossing':
        this.configure({ density: 'low', mode: 'crossing', running: true });
        this.fill(robotPoint, true); this.injectCrossing(robotPoint, robotDirection); break;
      case 'narrow':
        this.configure({ density: 'low', mode: 'shopping', running: true });
        this.injectHeadOn(robotPoint, robotDirection); break;
      case 'peak':
        this.configure({ density: 'high', mode: 'crowded', running: true });
        this.fill(robotPoint, true);
        this.injectCrossing(robotPoint, robotDirection, { ahead: 18, type: 'cart' });
        this.injectHeadOn(robotPoint, robotDirection, { ahead: 24, type: 'regular' });
        break;
      case 'normal':
      default:
        this.configure({ density: 'low', mode: 'shopping', running: true });
        this.fill(robotPoint, true); break;
    }
    return this.snapshot();
  }

  /**
   * 收银台队列（真实先进先出）：
   * 顾客排到队尾 → 队首顾客由店员扫码结账（固定服务时长）→ 结账完成立即离店 →
   * 后面每位顾客整体前移一格。买得少的顾客更早到达收银台，高峰时队列会明显变长。
   */
  assignCheckout(person) {
    const open = this.lanes.filter(l => l.queue.length < l.capacity);
    if (!open.length) {
      // 所有收银台都排满：顾客继续逛一会儿再回来排队，不涌向同一坐标。
      person.state = 'BROWSING';
      person.timer = 2.2 + this.random() * 2.8;
      this.metrics.queueWaits++;
      return false;
    }
    open.sort((a, b) => (a.queue.length - b.queue.length)
      || (dist(person.position, a.slots[0]) - dist(person.position, b.slots[0])));
    const lane = open[0];
    person.lane = lane.id;
    person.queueJoinAt = this.clock;
    person.sections = 99;
    person.serving = false;
    lane.queue.push(person);
    person.queueIndex = lane.queue.length - 1;
    person.queueSlot = lane.capacity - 1 - person.queueIndex;
    this.reindex(lane);
    this.sendTo(person, queueSpot(lane, person.queueIndex), 'GOING_TO_CHECKOUT');
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.totalQueued());
    return true;
  }

  /** 队列位置一变就重算每人的站位序号（3D 与 2D 都读这个值）。 */
  reindex(lane) {
    lane.queue.forEach((p, i) => { p.queueIndex = i; p.queueSlot = lane.capacity - 1 - i; });
  }

  totalQueued() { return this.lanes.reduce((n, l) => n + l.queue.length, 0); }

  /** 结构性离队（离店 / 重置 / 被移除），不计入服务人次。 */
  releaseLane(person) {
    let removed = null;
    for (const lane of this.lanes) {
      const index = lane.queue.indexOf(person);
      if (index < 0) continue;
      lane.queue.splice(index, 1);
      this.reindex(lane);
      removed = lane;
      break;
    }
    person.lane = null; person.queueIndex = -1; person.queueSlot = -1; person.serving = false;
    return removed;
  }

  /** 队首结账完成：结算等待时间、释放队列，并把后队整体前移一格。 */
  finishCheckout(lane, head) {
    const index = lane.queue.indexOf(head);
    if (index >= 0) lane.queue.splice(index, 1);
    const waited = Math.max(0, this.clock - (head.queueArrivedAt || head.queueJoinAt || this.clock));
    lane.served++; lane.waitSum += waited; lane.waitCount++;
    this.metrics.checkoutServed++;
    this.metrics.checkoutWaitSum += waited;
    head.serving = false; head.lane = null; head.queueIndex = -1; head.queueSlot = -1;
    this.exitAfterCheckout(head, lane);
    this.reindex(lane);
    lane.queue.forEach((p, i) => {
      if (dist(p.position, queueSpot(lane, i)) > .6) this.sendTo(p, queueSpot(lane, i), 'GOING_TO_CHECKOUT');
    });
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.totalQueued());
  }

  /**
   * V3.2 离店动线：结完账（或被判定离店）的行人走「自己的过门车道」出门。
   * 旧版所有人都汇到门中点 (170,26) 再向南折 90°，高峰期七八个人在门口挤成一坨
   * 互相顶、谁都出不去。现在过门 y 在整个开门宽度内随机摊开（26±4 单位 ≈0.7 m），
   * 到门前 x=164 就已切到自己的车道，直着穿门而出；出门后收敛到店外消失点。
   */
  beginExit(person, lane = null) {
    // V3.2：车道偏移用「行人 id 散列」而不是共享种子随机数——随机流被消耗会让
    // 后续所有行为（顾客类型/浏览时长/排队选择）整体移位，回归测试方差变大。
    person.exitDoorY = 26 + (doorLaneHash(person.id) - .5) * 8;   // [22, 30]，推车顾客（半径上限 4.36）也留有余量
    const doorY = person.exitDoorY;
    person.goal = [...STORE.outsideExit];
    if (lane) {
      // 刚结完账：先侧向让出排队通道，再沿自己的车道 straight 穿门。
      const sideX = exitLaneX(lane);
      const front = queueSpot(lane, 0);
      person.route = [
        [...front], [sideX, front[1]], [sideX, doorY],
        [STORE.exit[0] - 12, doorY], [STORE.exit[0] + 5, doorY], [...STORE.outsideExit],
      ];
      person.routeIndex = 1;
      person.heading = Math.PI / 2;
    } else {
      // 闲置/兜底离店：导航到门前自己的车道口，然后直行出门。
      this.sendTo(person, [STORE.exit[0] - 12, doorY], 'EXITING');
      person.route.push([STORE.exit[0] + 5, doorY], [...STORE.outsideExit]);
    }
    person.state = 'EXITING';
    person.timer = 0;
  }

  /** 付完款从队首侧向离开排队通道，再沿前场主通道走到右出口（不穿过仍在排队的人）。 */
  exitAfterCheckout(person, lane) {
    this.beginExit(person, lane);
  }

  /** 收银台状态机：每次只服务一名队首顾客，服务时长由该顾客的件数决定。 */
  serviceLanes(dt) {
    for (const lane of this.lanes) {
      if (lane.queue.some(p => !this.people.includes(p))) {
        lane.queue = lane.queue.filter(p => this.people.includes(p));
        this.reindex(lane);
      }
      const head = lane.queue[0];
      if (!head) { lane.serveLeft = 0; continue; }
      const front = queueSpot(lane, 0);
      const atFront = head.state === 'QUEUEING' && dist(head.position, front) < 1.6;
      if (!atFront) { lane.serveLeft = 0; head.serving = false; continue; }
      if (lane.serveLeft <= 0) {
        lane.serveLeft = head.serviceSeconds || this.serviceSeconds(head.items || 8, head.basket || 2);
        head.serving = true;
      }
      lane.serveLeft = Math.max(0, lane.serveLeft - dt);
      head.serving = lane.serveLeft > 0;
      if (lane.serveLeft <= 1e-6) this.finishCheckout(lane, head);
    }
  }

  update(dt, robot = null) {
    if (!this.running || dt <= 0) return;
    const step = Math.min(dt, .08);
    this.clock += step;
    // 渐进入场：每 1.1 秒最多补 1 人，全部从生成点进入。
    this.spawnCooldown = Math.max(0, this.spawnCooldown - step);
    if (this.people.length < this.targetCount && this.spawnCooldown <= 0) {
      if (this.fill(robot?.position)) this.spawnCooldown = .55 + this.random() * .8;
    }
    for (let i = this.people.length - 1; i >= 0; i--) {
      const person = this.people[i];
      this.advance(person, step, robot);
      // 走出出口即消失：一旦越过右墙开口外侧（x > width + 6）立即移除，
      // 避免行人停留在墙外铺装区产生视觉穿模；离店计数在此时结算。
      const passedExit = person.state === 'EXITING' && person.position[0] > STORE.width + 6;
      const reachedGoal = person.state === 'EXITING' && dist(person.position, person.goal || STORE.exitLane) < 2.6;
      if (passedExit || reachedGoal) {
        this.releaseLane(person);
        this.people.splice(i, 1); this.metrics.exits++;
      }
    }
    // 收银台按真实队列顺序服务队首，服务结束后后队整体前移。
    this.serviceLanes(step);
  }

  advance(person, dt, robot) {
    const type = PEDESTRIAN_TYPES[person.type];
    // V3.2：离店的人步速 +18%——结完账就往外走、不再闲逛，门口排空更快。
    const maxSpeed = type.speed * this.speedFactor / M * (person.state === 'EXITING' ? 1.18 : 1);
    let desired = [0, 0];

    if (['BROWSING', 'STOPPING'].includes(person.state)) {
      person.timer -= dt;
      person.phase += dt * .6;
      person.stallTimer = 0;
      person.detourCooldown = Math.max(0, (person.detourCooldown || 0) - dt);
      // V2.5：机器人贴到正在浏览的顾客身边时，顾客提前结束浏览、换个方向离开，
      // 避免「人站着不动 + 机器人停车等」形成围堵僵局。
      // V2.9：被标记为 planted 的顾客（人群堵路演练里「正忙着理货/交谈的一群人」）
      // 不会因为机器人靠近就散开——这才会真的把通道堵住，逼机器人自己决定改道。
      if (!person.planted && robot?.position && dist(person.position, robot.position) * M < 1.7)
        person.timer = Math.min(person.timer, .35);
      if (person.faceHeading !== undefined) {
        person.heading = lerpAngle(person.heading, person.faceHeading, Math.min(1, dt * 6));
      }
      if (person.timer <= 0) {
        // 买得少（购物篮小）的顾客逛完 1 个货区就直奔收银台；买得多的继续逛。
        if (person.sections >= (person.basket ?? 3)) this.assignCheckout(person);
        else { person.sections++; const s = this.pickSection(); person.section = s; this.sendTo(person, s.point, 'WALK_TO_SECTION'); }
      }
      person.velocity = [person.velocity[0] * Math.max(0, 1 - dt * 8), person.velocity[1] * Math.max(0, 1 - dt * 8)];
      this.move(person, dt, robot);
      return;
    }

    if (person.state === 'QUEUEING') {
      person.phase += dt * .5;
      person.stallTimer = 0;
      person.detourCooldown = Math.max(0, (person.detourCooldown || 0) - dt);
      // 站在队首/队列中：面向收银台（地图 y 减小方向），不再自由行走。
      person.faceHeading = Math.PI;
      // 结账与离队由 serviceLanes() 真实驱动（队首服务计时 → 后队前移）。
      // 这里仅保留兜底计时，避免手动注入或失去队列归属的路人永久卡住。
      if (!person.lane || !this.lanes.some(l => l.queue.includes(person))) {
        person.timer = (person.timer || 0) - dt;
        if (person.timer <= 0) this.beginExit(person);
      }
      person.velocity = [person.velocity[0] * Math.max(0, 1 - dt * 8), person.velocity[1] * Math.max(0, 1 - dt * 8)];
      this.move(person, dt, robot);
      return;
    }

    let target = person.route[person.routeIndex];
    while (target && dist(person.position, target) < 1.2) {
      person.routeIndex++;
      if (person.routeIndex >= person.route.length) {
        if (person.state === 'GOING_TO_CHECKOUT') {
          // 到位即进入队列等待：真正开始结账由收银台服务计时决定，不再各自随机等待。
          // 等待时间从「站进队伍」开始算，不含此前走向收银台的步行时间。
          person.state = 'QUEUEING'; person.timer = 0;
          person.queueArrivedAt = this.clock;
          person.faceHeading = Math.PI; person.heading = Math.PI;
          person.velocity = [0, 0];
        } else if (person.state === 'ENTER_STORE' || person.state === 'WALK_TO_SECTION') {
          person.state = 'BROWSING';
          person.timer = type.browse[0] + this.random() * (type.browse[1] - type.browse[0]);
          // 到达货架后锁定面向货架的朝向与取货层，不再沿用行走方向。
          if (person.section) {
            person.faceHeading = person.section.faceHeading;
            person.pickTier = person.section.pickTier;
          }
        } else if (person.state === 'DETOUR') {
          // 已绕过机器人：回到原目标，恢复正常行走状态。
          const goal = person.detourGoal || STORE.exit;
          const back = person.detourReturn || 'WALK_TO_SECTION';
          person.detourGoal = null; person.detourReturn = null;
          this.sendTo(person, goal, back === 'DETOUR' ? 'WALK_TO_SECTION' : back);
        } else { this.beginExit(person); }
        target = null; break;
      }
      target = person.route[person.routeIndex];
    }
    if (target) {
      const d = Math.max(.001, dist(person.position, target));
      desired = [(target[0] - person.position[0]) / d * maxSpeed, (target[1] - person.position[1]) / d * maxSpeed];
    }

    // 行人互斥
    for (const other of this.people) {
      if (other === person) continue;
      const dx = person.position[0] - other.position[0], dy = person.position[1] - other.position[1];
      const d = Math.hypot(dx, dy);
      const minD = (person.radius + other.radius) / M + .35;
      if (d < minD && d > .0001) {
        // V3.2：门口（x>158）两个都在离店的人互斥减弱——大家目标一致往外走，
        // 全强度互斥会让门前的密集人流互相顶成结；1.35 → 0.75 保持不重叠即可。
        const doorStream = person.state === 'EXITING' && other.state === 'EXITING'
          && person.position[0] > 158 && other.position[0] > 158;
        const push = (minD - d) / minD * maxSpeed * (doorStream ? .75 : 1.35);
        desired[0] += dx / d * push; desired[1] += dy / d * push;
      }
    }

    // 对机器人反应：V2.5 —— 行人先主动侧移让出通道；若双方持续对峙（绕圈），
    // 则明确「换个方向」绕到机器人侧后方再回原目标，而不是贴着机器人反复横跳。
    person.detourCooldown = Math.max(0, (person.detourCooldown || 0) - dt);
    // V2.5：进入绕行后专注沿新路线走，不再叠加侧移让行，否则又会在机器人旁边绕圈。
    const inDetour = person.state === 'DETOUR';
    if (!inDetour && robot?.position) {
      const dx = person.position[0] - robot.position[0], dy = person.position[1] - robot.position[1];
      const d = Math.hypot(dx, dy), dM = d * M;
      person.yieldTimer = Math.max(0, (person.yieldTimer || 0) - dt);
      if (dM < 3.0 && d > .0001) {
        person.stallTimer = (person.stallTimer || 0) + dt;
        // 僵局：持续近距离 >1.5 s，或已被阻挡且 >0.9 s → 行人换一条路绕过机器人。
        // 但「正在去收银台 / 已在队列里」的顾客只做侧向让行，不放弃队列绕远路，
        // 否则队伍会被一个绕远的人卡住，收银台长时间空转。
        const queueBound = person.state === 'GOING_TO_CHECKOUT' || person.state === 'QUEUEING';
        if (!queueBound && person.state !== 'DETOUR' && person.detourCooldown <= 0 &&
            (person.stallTimer > 1.5 || (person.blocked > 0 && person.stallTimer > .9))) {
          this.beginDetour(person, robot);
          return;
        }
        const side = [-dy / d, dx / d];
        const toward = -(desired[0] * dx + desired[1] * dy) / d;
        // 锁定让行方向一次，持续朝同一侧移动直到计时结束，杜绝左右横跳。
        if (person.yieldTimer <= 0) {
          const sideDot = desired[0] * side[0] + desired[1] * side[1];
          let chosen = sideDot >= 0 ? 1 : -1;
          // V3.1c：让行方向要感知货架——窄通道里机器人停着时，一侧可能被货架堵死，
          // 只按「期望方向」选边会把人顶在货架和机器人之间反复蹭（碰撞的来源）。
          const open = sgn => !this.blockedByFixture(
            robot.position[0] + side[0] * sgn * 4, robot.position[1] + side[1] * sgn * 4, person);
          if (!open(chosen) && open(-chosen)) chosen = -chosen;
          person.yieldSide = chosen;
          person.yieldTimer = 2.2;
          if (person.yieldToRobot <= 0) this.metrics.pedestrianYields++;
        }
        const gain = clamp((3.0 - dM) / 3.0, 0, 1);
        const goSide = [side[0] * person.yieldSide, side[1] * person.yieldSide];
        // 迎面或同向逼近：把朝机器人的分量替换为侧向让行，而不是原地停住。
        if (toward > 0) {
          desired[0] -= toward * dx / d; desired[1] -= toward * dy / d;
        }
        // V3.1：让行 = 离机器人 2.2 m 以内时侧移让开、2.2 m 以外恢复正常走路，
        // 不再持续绕着机器人兜圈。
        // 中距离（0.95–3 m）：侧移让出通道即可，不再持续绕圈；
        // 极近距离（<0.95 m）：快速侧移脱离——这是防碰撞的关键动作，不能弱化。
        const far = dM >= 2.2;
        const stepAside = far ? .3 : (.8 + gain * .8);
        desired[0] += goSide[0] * maxSpeed * stepAside;
        desired[1] += goSide[1] * maxSpeed * stepAside;
        if (dM < 0.95) {
          const sideDot = desired[0] * goSide[0] + desired[1] * goSide[1];
          desired[0] = goSide[0] * Math.max(maxSpeed, sideDot);
          desired[1] = goSide[1] * Math.max(maxSpeed, sideDot);
          person.blocked = .5;
          this.metrics.blocks++;
        }
        person.yieldToRobot = 1.0;
      } else person.stallTimer = Math.max(0, (person.stallTimer || 0) - dt * 2);
    } else person.stallTimer = 0;
    person.yieldToRobot = Math.max(0, person.yieldToRobot - dt);
    person.blocked = Math.max(0, (person.blocked || 0) - dt);

    // V2.5：绕行期间不做方向锁定的主动让行，但持续保留一个「机器人排斥场」：
    // 抵消朝机器人走的分量 + 按距离渐强的远离分量，越近越强。
    // 这样行人确实在换方向走，又不会沿新路线直穿（或撞上）静止的机器人。
    if (inDetour && robot?.position) {
      const dx = person.position[0] - robot.position[0], dy = person.position[1] - robot.position[1];
      const d = Math.hypot(dx, dy), dM = d * M;
      if (dM < 2.2 && d > .0001) {
        // V3.1：绕行路线本身已避开机器人，这里只保留轻量排斥防贴身——
        // 旧版排斥太强，会把人顶在 2.2 m 边界上原地卡死（另一种「围着机器人转」）。
        const nx = dx / d, ny = dy / d;
        const toward = -(desired[0] * nx + desired[1] * ny);
        if (toward > 0) { desired[0] += nx * toward; desired[1] += ny * toward; }
        const gain = clamp((2.2 - dM) / 2.2, 0, 1);
        desired[0] += nx * maxSpeed * (.12 + gain * .55);
        desired[1] += ny * maxSpeed * (.12 + gain * .55);
        if (dM < 1.0) { desired[0] += nx * maxSpeed * .7; desired[1] += ny * maxSpeed * .7; }
      }
    }

    const magnitude = Math.hypot(desired[0], desired[1]);
    const limited = magnitude > maxSpeed ? maxSpeed / magnitude : 1;
    const blend = Math.min(1, dt * 5.5);
    person.velocity[0] += (desired[0] * limited - person.velocity[0]) * blend;
    person.velocity[1] += (desired[1] * limited - person.velocity[1]) * blend;
    const speed = Math.hypot(person.velocity[0], person.velocity[1]);
    if (speed > .08) person.heading = lerpAngle(person.heading, Math.atan2(person.velocity[0], person.velocity[1]), Math.min(1, dt * 7));
    person.phase += (speed * M / Math.max(.5, type.height)) * dt * 3.4;
    this.move(person, dt, robot);
  }

  move(person, dt, robot = null) {
    // V3.1c：机器人车体是实体。行人贴近车体时沿 hull 边缘滑过，绝不进入车体——
    // 机器人停在通道上等行人时，这是「人绕过停着的车」与「人穿进车里」的分界线。
    let robotHull = null;
    if (robot?.position) {
      robotHull = (PHYSICS.robot.radius + (person.radius || .26)) / M + .15;
      const [rx, ry] = robot.position;
      const dNow = Math.hypot(person.position[0] - rx, person.position[1] - ry);
      if (dNow < robotHull) {
        // 已经在 hull 内（极少见，例如追尾碰撞余量）：径向推出去。
        const nx = (person.position[0] - rx) / (dNow || 1), ny = (person.position[1] - ry) / (dNow || 1);
        person.position[0] = rx + nx * robotHull;
        person.position[1] = ry + ny * robotHull;
        person.velocity[0] += nx * Math.abs(person.velocity[0]) * .5;
        person.velocity[1] += ny * Math.abs(person.velocity[1]) * .5;
      }
    }
    // V2.1 硬约束：左墙只在入口开口可穿越，右墙只在出口开口可穿越。
    const inEntryY = Math.abs(person.position[1] - STORE.openings.entrance.y) <= STORE.openings.entrance.halfHeight - (person.radius || .26) / M;
    const inExitY = Math.abs(person.position[1] - STORE.openings.exit.y) <= STORE.openings.exit.halfHeight - (person.radius || .26) / M;
    const atLeftWall = person.position[0] < 6, atRightWall = person.position[0] > STORE.width - 6;
    const canUseEntry = atLeftWall && inEntryY && (person.state === 'ENTER_STORE' || person.state === 'EXITING');
    const canUseExit = atRightWall && inExitY && person.state === 'EXITING';
    const minX = canUseEntry ? 0 : 4;
    const maxX = canUseExit ? STORE.width + 8 : STORE.width - 4;
    let nextX = clamp(person.position[0] + person.velocity[0] * dt, minX, maxX);
    let nextY = clamp(person.position[1] + person.velocity[1] * dt, 4, STORE.height - 4);
    if (robotHull !== null && robot?.position) {
      const [rx, ry] = robot.position;
      if (Math.hypot(nextX - rx, person.position[1] - ry) < robotHull) { nextX = person.position[0]; person.velocity[0] = 0; }
      if (Math.hypot(person.position[0] - rx, nextY - ry) < robotHull) { nextY = person.position[1]; person.velocity[1] = 0; }
    }
    if (!this.blockedByFixture(nextX, person.position[1], person)) person.position[0] = nextX; else person.velocity[0] = 0;
    if (!this.blockedByFixture(person.position[0], nextY, person)) {
      const crossingWall = person.position[0] < 4 || person.position[0] > STORE.width - 4;
      if (!crossingWall || canUseEntry || canUseExit) person.position[1] = nextY; else person.velocity[1] = 0;
    } else person.velocity[1] = 0;
    // 墙体硬约束：除唯一入口/出口开口外，行人不得在墙外移动。
    const outsideLeft = person.position[0] < 4, outsideRight = person.position[0] > STORE.width - 4;
    if ((outsideLeft && !canUseEntry) || (outsideRight && !canUseExit)) {
      person.position[0] = outsideLeft ? 4 : STORE.width - 4;
      person.velocity[0] = 0;
    }
  }

  /** 与 3D/2D 完全同源的障碍判定：货架 + 实体装置（不含地面标线）。 */
  blockedByFixture(x, y, person) {
    const r = (person.radius || .26) / M;
    for (const s of shelves) if (x > s.xMin - r && x < s.xMax + r && y > s.yMin - r && y < s.yMax + r) return true;
    for (const f of layoutFixtures) {
      // V2.8：机器人自助收银台（robotpay）也是实体装置，行人不得穿过。
      if (!['wall', 'promo', 'checkout', 'kiosk', 'charger', 'robotpay'].includes(f.kind)) continue;
      if (x > f.x - f.w / 2 - r && x < f.x + f.w / 2 + r && y > f.y - f.h / 2 - r && y < f.y + f.h / 2 + r) return true;
    }
    return false;
  }

  snapshot() {
    return this.people.map(p => ({
      id: p.id, type: p.type, typeName: p.typeName, cn: p.cn,
      x: p.position[0], y: p.position[1], vx: p.velocity[0], vy: p.velocity[1],
      heading: p.heading, phase: p.phase, speed: Math.hypot(p.velocity[0], p.velocity[1]) * M,
      state: p.state, cart: p.cart, look: p.look, style: p.style, color: p.color, skin: p.skin,
      faceHeading: p.faceHeading, pickTier: p.pickTier ?? 1, pickShelf: p.section?.shelfId || null,
      radius: p.radius, height: p.height, crossing: p.crossing,
      lane: p.lane, queueSlot: p.queueSlot, queueIndex: p.queueIndex,
      basket: p.basket, items: p.items, serving: !!p.serving,
      serviceSeconds: p.serviceSeconds,
      goal: p.goal ? [...p.goal] : null,
      destination: p.goal ? [...p.goal] : (p.section?.point ? [...p.section.point] : null),
      destinationShelf: p.section?.shelfId || null,
      avoiding: p.yieldToRobot > 0,
      detour: p.state === 'DETOUR',
      blocked: p.blocked > 0,
    }));
  }

  /** 测试/面板用：每个收银台的排队人数、容量、正在结账的顾客、服务人次与平均等待。 */
  queueStatus() {
    return this.lanes.map(l => ({
      id: l.id, size: l.queue.length, capacity: l.capacity, served: l.served,
      serving: l.queue[0] && l.serveLeft > 0 ? l.queue[0].id : null,
      serveLeft: +Math.max(0, l.serveLeft).toFixed(1),
      wait: l.waitCount ? +(l.waitSum / l.waitCount).toFixed(1) : 0,
    }));
  }

  /** 收银汇总（面板/测试共用）：已结账人次、仍在排队人数、平均等待、最大排队。 */
  checkoutSummary() {
    const total = this.totalQueued();
    const avgWait = this.metrics.checkoutServed
      ? +(this.metrics.checkoutWaitSum / this.metrics.checkoutServed).toFixed(1) : 0;
    return {
      served: this.metrics.checkoutServed, queued: total, avgWait,
      maxQueue: this.metrics.maxQueue, lanes: this.lanes.length,
      busyLanes: this.lanes.filter(l => l.queue.length > 0).length,
    };
  }
}

function normalize(v) {
  const d = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / d, v[1] / d];
}
