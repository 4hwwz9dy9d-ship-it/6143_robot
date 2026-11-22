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
  'TURNING', 'QUEUEING', 'GOING_TO_CHECKOUT', 'EXITING',
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
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0, queueWaits: 0, maxQueue: 0 };
    this.densityTarget = { low: 7, medium: 16, high: 30 }[this.density] ?? 7;
    this.lanes = STORE.checkoutLanes.map(l => ({ ...l, occupied: new Map(), served: 0 }));
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
    this.spawnCooldown = 0;
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0, queueWaits: 0, maxQueue: 0 };
    this.lanes = STORE.checkoutLanes.map(l => ({ ...l, occupied: new Map(), served: 0 }));
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
    };
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
    const person = {
      id: `PED-${String(this.nextId++).padStart(2, '0')}`,
      type: typeKey, typeName: type.name, cn: type.cn,
      position, velocity: [0, 0],
      heading: (this.random() - .5) * .5 + Math.PI / 2, // 不同朝向进入
      speed: type.speed * this.speedFactor,
      radius: type.radius, height: type.height, cart: type.cart,
      look: type.look, style: Math.floor(this.random() * 6),
      state: 'ENTER_STORE', timer: 0, phase: this.random() * TAU,
      route: [], routeIndex: 0, goal: null, sections: 0,
      yieldToRobot: 0, blocked: 0, crossing: !!forced.crossing,
      lane: null, queueSlot: -1,
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
    const safeGoal = state === 'EXITING' ? [...goal] : this.safePoint(goal, person.radius);
    person.route = routeBetween(this.nodes, this.safePoint(person.position, person.radius), safeGoal);
    person.routeIndex = Math.min(1, person.route.length - 1);
    person.state = state;
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

  /** 收银台队列：按当前占用数选择最短队列，容量满则继续购物或等待。 */
  assignCheckout(person) {
    const available = this.lanes
      .map(l => ({ lane: l, size: l.occupied.size }))
      .filter(x => x.size < x.lane.capacity)
      .sort((a, b) => a.size - b.size);
    if (!available.length) {
      // 队列全满：先浏览等待，不涌向收银台。
      person.state = 'BROWSING';
      person.timer = 2.5 + this.random() * 3;
      this.metrics.queueWaits++;
      return false;
    }
    const { lane } = available[0];
    let slotIndex = 0;
    while (slotIndex < lane.capacity && lane.occupied.has(slotIndex)) slotIndex++;
    lane.occupied.set(slotIndex, person.id);
    person.lane = lane.id; person.queueSlot = slotIndex;
    person.sections = 99;
    this.sendTo(person, lane.slots[slotIndex], 'GOING_TO_CHECKOUT');
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.lanes.reduce((n, l) => n + l.occupied.size, 0));
    return true;
  }

  releaseLane(person) {
    if (!person.lane) return;
    const lane = this.lanes.find(l => l.id === person.lane);
    if (lane) { lane.occupied.delete(person.queueSlot); lane.served++; }
    person.lane = null; person.queueSlot = -1;
  }

  update(dt, robot = null) {
    if (!this.running || dt <= 0) return;
    const step = Math.min(dt, .08);
    // 渐进入场：每 1.1 秒最多补 1 人，全部从生成点进入。
    this.spawnCooldown = Math.max(0, this.spawnCooldown - step);
    if (this.people.length < this.targetCount && this.spawnCooldown <= 0) {
      if (this.fill(robot?.position)) this.spawnCooldown = .55 + this.random() * .8;
    }
    for (let i = this.people.length - 1; i >= 0; i--) {
      const person = this.people[i];
      this.advance(person, step, robot);
      if (person.state === 'EXITING' && dist(person.position, person.goal || STORE.exitLane) < 2.6) {
        this.releaseLane(person);
        this.people.splice(i, 1); this.metrics.exits++;
      }
    }
  }

  advance(person, dt, robot) {
    const type = PEDESTRIAN_TYPES[person.type];
    const maxSpeed = type.speed * this.speedFactor / M;
    let desired = [0, 0];

    if (['BROWSING', 'STOPPING'].includes(person.state)) {
      person.timer -= dt;
      person.phase += dt * .6;
      if (person.timer <= 0) {
        if (person.sections >= (this.mode === 'shopping' ? 3 : 2)) this.assignCheckout(person);
        else { person.sections++; const s = this.pickSection(); person.section = s; this.sendTo(person, s.point, 'WALK_TO_SECTION'); }
      }
      person.velocity = [person.velocity[0] * Math.max(0, 1 - dt * 8), person.velocity[1] * Math.max(0, 1 - dt * 8)];
      this.move(person, dt);
      return;
    }

    if (person.state === 'QUEUEING') {
      person.timer -= dt;
      person.phase += dt * .5;
      if (person.timer <= 0) {
        const lane = this.lanes.find(l => l.id === person.lane) || STORE.checkoutLanes[0];
        // 结账完成 → 经前场通道步行至右侧墙体开口，从出口离店。
        this.releaseLane(person);
        this.sendTo(person, STORE.outsideExit, 'EXITING');
      }
      person.velocity = [person.velocity[0] * Math.max(0, 1 - dt * 8), person.velocity[1] * Math.max(0, 1 - dt * 8)];
      this.move(person, dt);
      return;
    }

    let target = person.route[person.routeIndex];
    while (target && dist(person.position, target) < 1.2) {
      person.routeIndex++;
      if (person.routeIndex >= person.route.length) {
        if (person.state === 'GOING_TO_CHECKOUT') {
          person.state = 'QUEUEING'; person.timer = 2 + this.random() * 3;
        } else if (person.state === 'ENTER_STORE' || person.state === 'WALK_TO_SECTION') {
          person.state = 'BROWSING';
          person.timer = type.browse[0] + this.random() * (type.browse[1] - type.browse[0]);
        } else { this.sendTo(person, STORE.exitLane, 'EXITING'); }
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
        const push = (minD - d) / minD * maxSpeed * 1.35;
        desired[0] += dx / d * push; desired[1] += dy / d * push;
      }
    }

    // 对机器人反应：保留侧向让行分量，避免双向死锁。
    if (robot?.position) {
      const dx = person.position[0] - robot.position[0], dy = person.position[1] - robot.position[1];
      const d = Math.hypot(dx, dy), dM = d * M;
      if (dM < 2.8 && d > .0001) {
        const side = [-dy / d, dx / d];
        const gain = clamp((2.8 - dM) / 2.8, 0, 1);
        const toward = -(desired[0] * dx + desired[1] * dy) / d;
        if (toward > 0 && dM < 2.2) {
          const sideDot = desired[0] * side[0] + desired[1] * side[1];
          desired[0] = side[0] * Math.max(sideDot, 0);
          desired[1] = side[1] * Math.max(sideDot, 0);
        } else if (toward > 0) {
          desired[0] -= toward * dx / d; desired[1] -= toward * dy / d;
        }
        desired[0] += side[0] * maxSpeed * gain * 1.5;
        desired[1] += side[1] * maxSpeed * gain * 1.5;
        desired[0] *= 1 - gain * .45; desired[1] *= 1 - gain * .45;
        if (person.yieldToRobot <= 0) this.metrics.pedestrianYields++;
        person.yieldToRobot = .8;
        if (dM < 1.0) {
          const sideDot = desired[0] * side[0] + desired[1] * side[1];
          desired[0] = side[0] * sideDot; desired[1] = side[1] * sideDot;
          person.blocked = .8;
          this.metrics.blocks++;
        }
      }
    }
    person.yieldToRobot = Math.max(0, person.yieldToRobot - dt);
    person.blocked = Math.max(0, (person.blocked || 0) - dt);

    const magnitude = Math.hypot(desired[0], desired[1]);
    const limited = magnitude > maxSpeed ? maxSpeed / magnitude : 1;
    const blend = Math.min(1, dt * 5.5);
    person.velocity[0] += (desired[0] * limited - person.velocity[0]) * blend;
    person.velocity[1] += (desired[1] * limited - person.velocity[1]) * blend;
    const speed = Math.hypot(person.velocity[0], person.velocity[1]);
    if (speed > .08) person.heading = lerpAngle(person.heading, Math.atan2(person.velocity[0], person.velocity[1]), Math.min(1, dt * 7));
    person.phase += (speed * M / Math.max(.5, type.height)) * dt * 3.4;
    this.move(person, dt);
  }

  move(person, dt) {
    const inOpeningY = Math.abs(person.position[1] - STORE.openings.entrance.y) <= STORE.openings.entrance.halfHeight;
    const minX = person.state === 'EXITING' && person.position[0] > STORE.width - 10 ? 0 : inOpeningY ? 0 : 4;
    const maxX = person.state === 'EXITING' || person.state === 'ENTER_STORE' ? STORE.width + 8 : STORE.width - 4;
    const nextX = clamp(person.position[0] + person.velocity[0] * dt, minX, maxX);
    const nextY = clamp(person.position[1] + person.velocity[1] * dt, 4, STORE.height - 4);
    if (!this.blockedByFixture(nextX, person.position[1], person)) person.position[0] = nextX; else person.velocity[0] = 0;
    if (!this.blockedByFixture(person.position[0], nextY, person)) {
      const canExit = person.state === 'EXITING' && person.position[0] > STORE.width - 9;
      const crossingWall = person.position[0] < 4 || person.position[0] > STORE.width - 4;
      if (!crossingWall || inOpeningY || canExit) person.position[1] = nextY; else person.velocity[1] = 0;
    } else person.velocity[1] = 0;
    // 墙体硬约束：除入口/出口开口外，行人不得在墙外横向移动。
    const outsideLeft = person.position[0] < 4, outsideRight = person.position[0] > STORE.width - 4;
    const allowedOpening = Math.abs(person.position[1] - STORE.openings.entrance.y) <= STORE.openings.entrance.halfHeight;
    const allowedExit = person.state === 'EXITING' && person.position[0] > STORE.width - 9;
    if ((outsideLeft || outsideRight) && !allowedOpening && !allowedExit) {
      person.position[0] = outsideLeft ? 4 : STORE.width - 4;
      person.velocity[0] = 0;
    }
  }

  /** 与 3D/2D 完全同源的障碍判定：货架 + 实体装置（不含地面标线）。 */
  blockedByFixture(x, y, person) {
    const r = (person.radius || .26) / M;
    for (const s of shelves) if (x > s.xMin - r && x < s.xMax + r && y > s.yMin - r && y < s.yMax + r) return true;
    for (const f of layoutFixtures) {
      if (!['wall', 'promo', 'checkout'].includes(f.kind)) continue;
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
      radius: p.radius, height: p.height, crossing: p.crossing,
      lane: p.lane, queueSlot: p.queueSlot,
      goal: p.goal ? [...p.goal] : null,
      destination: p.goal ? [...p.goal] : (p.section?.point ? [...p.section.point] : null),
      destinationShelf: p.section?.shelfId || null,
      avoiding: p.yieldToRobot > 0,
      blocked: p.blocked > 0,
    }));
  }

  /** 测试/面板用：队列长度与容量。 */
  queueStatus() {
    return this.lanes.map(l => ({ id: l.id, size: l.occupied.size, capacity: l.capacity, served: l.served }));
  }
}

function normalize(v) {
  const d = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / d, v[1] / d];
}
