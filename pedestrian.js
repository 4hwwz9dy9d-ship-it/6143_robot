// NEXUS RETAIL — pedestrian simulation system.
// SIMULATION: every person, route, speed and state here is rule-driven and is
// labelled as such in the interface. No real vision / tracking data is used.
// Coordinates are the shared map units from storeData.js (1 unit = 0.17 m).
import { STORE, shelves, PHYSICS, buildNavNodes, nodeKey } from './storeData.js';

const M = PHYSICS.metersPerUnit;
const TAU = Math.PI * 2;

export const PEDESTRIAN_TYPES = Object.freeze({
  regular:  { key: 'regular',  name: 'Regular Shopper',  cn: '普通顾客',   speed: .95, height: 1.70, radius: .24, browse: [2, 5],  cart: false },
  slow:     { key: 'slow',     name: 'Slow Walker',      cn: '慢速顾客',   speed: .62, height: 1.62, radius: .25, browse: [4, 8],  cart: false },
  cart:     { key: 'cart',     name: 'Cart Shopper',     cn: '推车顾客',   speed: .78, height: 1.68, radius: .38, browse: [2, 4],  cart: true  },
  browsing: { key: 'browsing', name: 'Browsing Shopper', cn: '浏览顾客',   speed: .72, height: 1.74, radius: .24, browse: [6, 12], cart: false },
  fast:     { key: 'fast',     name: 'Fast Walker',      cn: '快速顾客',   speed: 1.35, height: 1.78, radius: .23, browse: [.5, 1.5], cart: false },
});

export const PEDESTRIAN_STATES = Object.freeze([
  'ENTER_STORE', 'WALK_TO_SECTION', 'WALKING', 'BROWSING', 'STOPPING',
  'TURNING', 'QUEUEING', 'GOING_TO_CHECKOUT', 'EXITING',
]);

const keys = Object.keys(PEDESTRIAN_TYPES);
// 行人排队/离店点位于主通道外侧，避免与机器人出口路段争用同一节点。
const PED_CHECKOUT = [112, 14];
const PED_EXIT = [118, 14];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};

/** 固定种子的伪随机数：同一场景可重复执行，便于回归测试。 */
function makeRandom(seed = 6143) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** 在共享通道图上求最短路（Dijkstra，节点数很小）。 */
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
  // 用实际起终点替换最近的图节点，行人不会瞬移到节点上。
  if (dist(from, chain[0]) > .01) chain.unshift(from);
  if (dist(chain.at(-1), to) > .01) chain.push(to);
  // 最近的图节点可能在行人背后（例如入口节点），去掉这个无意义的回头点。
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
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0 };
    this.densityTarget = { low: 6, medium: 12, high: 20 }[this.density] ?? 6;
  }

  get targetCount() { return this.mode === 'crowded' ? Math.max(16, this.densityTarget) : this.densityTarget; }

  configure({ density, mode, speedFactor, running } = {}) {
    if (density) { this.density = density; this.densityTarget = { low: 6, medium: 12, high: 20 }[density] ?? 6; }
    if (mode) this.mode = mode;
    if (typeof speedFactor === 'number') this.speedFactor = clamp(speedFactor, .5, 1.6);
    if (typeof running === 'boolean') this.running = running;
    if (this.running && this.people.length < this.targetCount) this.fill();
    return this;
  }

  reset() {
    this.people = []; this.nextId = 1; this.random = makeRandom(6143);
    this.metrics = { spawned: 0, exits: 0, pedestrianYields: 0, blocks: 0 };
    if (this.running) this.fill();
  }

  setDensity(density) { return this.configure({ density }); }
  setMode(mode) { return this.configure({ mode }); }
  setSpeedFactor(factor) { return this.configure({ speedFactor: factor }); }
  start() { return this.configure({ running: true }); }
  pause() { return this.configure({ running: false }); }

  /** 选择某种人物类型；购物车顾客在拥堵场景中更常见。 */
  pickType() {
    const r = this.random();
    if (this.mode === 'crowded') return r < .3 ? 'cart' : r < .5 ? 'slow' : r < .75 ? 'regular' : 'fast';
    if (this.mode === 'crossing') return r < .45 ? 'cart' : r < .8 ? 'regular' : 'fast';
    if (this.mode === 'natural') return r < .18 ? 'cart' : r < .38 ? 'fast' : r < .58 ? 'slow' : r < .78 ? 'browsing' : 'regular';
    return r < .16 ? 'cart' : r < .36 ? 'browsing' : r < .56 ? 'slow' : r < .74 ? 'fast' : 'regular';
  }

  pickSection() {
    const s = shelves[Math.floor(this.random() * shelves.length)];
    const side = this.random() < .5 ? -1 : 1;
    return [s.point[0] + side * (1.2 + this.random() * 1.1), s.point[1] + (this.random() - .5) * 2.4];
  }

  makePerson(override = {}) {
    const typeKey = override.type || this.pickType();
    const type = PEDESTRIAN_TYPES[typeKey];
    const jitter = () => (this.random() - .5) * 2;
    const position = override.position ? [...override.position] : [12 + this.random() * 2.4, STORE.entrance[1] + jitter() * .35];
    const person = {
      id: `PED-${String(this.nextId++).padStart(2, '0')}`,
      type: typeKey, typeName: type.name, cn: type.cn,
      position, velocity: [0, 0], heading: Math.PI / 2,
      speed: type.speed * this.speedFactor,
      radius: type.radius, height: type.height, cart: type.cart,
      style: Math.floor(this.random() * 5),
      state: 'ENTER_STORE', timer: 0, phase: this.random() * TAU,
      route: [], routeIndex: 0, goal: null, sections: 0,
      yieldToRobot: 0, blocked: 0, crossing: !!override.crossing,
      color: [0xc47a58, 0xd7a16c, 0x936b61, 0x5e7f99, 0x9e8a6b][Math.floor(this.random() * 5)],
    };
    this.metrics.spawned++;
    return person;
  }

  sendTo(person, goal, state = 'WALK_TO_SECTION') {
    person.goal = [...goal];
    person.route = routeBetween(this.nodes, person.position, goal);
    person.routeIndex = Math.min(1, person.route.length - 1);
    person.state = state;
  }

  /** 入口补人，维持目标密度；行人从入口进入而不是凭空出现。 */
  fill() {
    let guard = 0;
    while (this.people.length < this.targetCount && guard++ < 40) {
      const person = this.makePerson();
      // 入口处错开，避免出生即重叠；机器人停在入口，行人从右侧进店。
      person.position[0] += (this.people.length % 4) * 1.6;
      this.sendTo(person, this.pickSection(), 'ENTER_STORE');
      this.people.push(person);
    }
  }

  /** 横穿演示：在机器人前方生成一个横向穿过其路径的行人。 */
  injectCrossing(robotPoint, robotDirection = [1, 0], options = {}) {
    const dir = normalize(robotDirection);
    const side = [-dir[1], dir[0]];
    const ahead = options.ahead ?? 13;               // 地图单位，约 2.2 m
    const lateral = options.lateral ?? 8;            // 约 1.36 m
    const center = [robotPoint[0] + dir[0] * ahead, robotPoint[1] + dir[1] * ahead];
    const from = [clamp(center[0] - side[0] * lateral, 6, 134), clamp(center[1] - side[1] * lateral, 7, 84)];
    const to = [clamp(center[0] + side[0] * lateral * 1.35, 6, 134), clamp(center[1] + side[1] * lateral * 1.35, 7, 84)];
    const person = this.makePerson({ type: options.type || 'cart', position: from, crossing: true });
    person.route = [from, center, to]; person.routeIndex = 1;
    person.goal = [...to]; person.state = 'WALKING';
    this.people.push(person);
    return person;
  }

  /** 窄道迎面演示：在机器人正前方生成一个朝机器人走来的行人。 */
  injectHeadOn(robotPoint, robotDirection = [1, 0], options = {}) {
    const dir = normalize(robotDirection);
    const ahead = options.ahead ?? 16;
    const from = [clamp(robotPoint[0] + dir[0] * ahead, 6, 134), clamp(robotPoint[1] + dir[1] * ahead, 7, 84)];
    const person = this.makePerson({ type: options.type || 'regular', position: from, crossing: true });
    const to = [clamp(from[0] - dir[0] * 18, 6, 134), clamp(from[1] - dir[1] * 18, 7, 84)];
    person.route = [from, to]; person.routeIndex = 1; person.goal = [...to]; person.state = 'WALKING';
    this.people.push(person);
    return person;
  }

  applyPreset(name, robotPoint = STORE.entrance, robotDirection = [1, 0]) {
    this.reset();
    switch (name) {
      case 'crossing':
        this.configure({ density: 'low', mode: 'crossing', running: true });
        this.fill(); this.injectCrossing(robotPoint, robotDirection); break;
      case 'narrow':
        this.configure({ density: 'low', mode: 'shopping', running: true });
        this.injectHeadOn(robotPoint, robotDirection); break;
      case 'peak':
        this.configure({ density: 'high', mode: 'crowded', running: true });
        this.fill();
        this.injectCrossing(robotPoint, robotDirection, { ahead: 18, type: 'cart' });
        this.injectHeadOn(robotPoint, robotDirection, { ahead: 24, type: 'regular' });
        break;
      case 'normal':
      default:
        this.configure({ density: 'low', mode: 'shopping', running: true });
        this.fill(); break;
    }
    return this.snapshot();
  }

  /** 每个仿真帧调用。robot = { position:[x,y], velocity:[vx,vy] }（地图单位）。 */
  update(dt, robot = null) {
    if (!this.running || dt <= 0) return;
    const step = Math.min(dt, .08);
    const target = this.targetCount;
    while (this.people.length < target) {
      const person = this.makePerson();
      person.position[0] += (this.people.length % 4) * 1.6;
      this.sendTo(person, this.pickSection(), 'ENTER_STORE');
      this.people.push(person);
    }
    for (let i = this.people.length - 1; i >= 0; i--) {
      const person = this.people[i];
      this.advance(person, step, robot);
      if (dist(person.position, person.goal || PED_EXIT) < 2.5 && person.state === 'EXITING') {
        this.people.splice(i, 1); this.metrics.exits++;
      }
    }
  }

  advance(person, dt, robot) {
    const type = PEDESTRIAN_TYPES[person.type];
    const maxSpeed = type.speed * this.speedFactor / M; // m/s → 地图单位/s
    let desired = [0, 0];

    if (person.state === 'BROWSING' || person.state === 'QUEUEING' || person.state === 'STOPPING') {
      person.timer -= dt;
      // 浏览时轻微侧身，脚部保持接地（动画层用 phase 控制）
      person.phase += dt * .6;
      if (person.timer <= 0) {
        if (person.state === 'QUEUEING') { person.sections = 99; this.sendTo(person, PED_EXIT, 'GOING_TO_CHECKOUT'); }
        else if (person.sections >= (this.mode === 'shopping' ? 3 : 2)) this.sendTo(person, PED_CHECKOUT, 'GOING_TO_CHECKOUT');
        else { person.sections++; this.sendTo(person, this.pickSection(), 'WALK_TO_SECTION'); }
      }
      person.velocity = [person.velocity[0] * Math.max(0, 1 - dt * 8), person.velocity[1] * Math.max(0, 1 - dt * 8)];
      this.move(person, dt);
      return;
    }

    // 跟随图路径。到达当前节点后转向下一个节点。
    let target = person.route[person.routeIndex];
    while (target && dist(person.position, target) < 1.2) {
      person.routeIndex++;
      if (person.routeIndex >= person.route.length) {
        if (person.state === 'GOING_TO_CHECKOUT') {
          person.state = 'QUEUEING'; person.timer = 1.5 + this.random() * 2.5;
        } else if (person.state === 'ENTER_STORE' || person.state === 'WALK_TO_SECTION') {
          person.state = 'BROWSING';
          person.timer = type.browse[0] + this.random() * (type.browse[1] - type.browse[0]);
        } else { person.state = 'EXITING'; this.sendTo(person, PED_EXIT, 'EXITING'); }
        target = null; break;
      }
      target = person.route[person.routeIndex];
    }
    if (target) {
      const d = Math.max(.001, dist(person.position, target));
      desired = [(target[0] - person.position[0]) / d * maxSpeed, (target[1] - person.position[1]) / d * maxSpeed];
    }

    // 行人互斥：相互接近时施加横向分离力（对称减速，保证不穿透）。
    for (const other of this.people) {
      if (other === person) continue;
      const dx = person.position[0] - other.position[0], dy = person.position[1] - other.position[1];
      const d = Math.hypot(dx, dy);
      const minD = (person.radius + other.radius) / M + .35;
      if (d < minD && d > .0001) {
        const push = (minD - d) / minD * maxSpeed * 1.35;
        desired[0] += dx / d * push; desired[1] += dy / d * push;
        if (d < minD * .65) person.blocked += dt; else person.blocked = Math.max(0, person.blocked - dt);
      }
    }

    // 对机器人反应：进入 1.6 m 内减速并向侧向让行；极近时完全停下。
    if (robot?.position) {
      const dx = person.position[0] - robot.position[0], dy = person.position[1] - robot.position[1];
      const d = Math.hypot(dx, dy), dM = d * M;
      if (dM < 2.8 && d > .0001) {
        const side = [-dy / d, dx / d];
        const gain = clamp((2.8 - dM) / 2.8, 0, 1);
        // 朝机器人前进的分量优先移除；迎面接近时只保留侧向绕行。
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
          // 只保留侧向分量：绝不因机器人而完全静止，避免双向死锁。
          const sideDot = desired[0] * side[0] + desired[1] * side[1];
          desired[0] = side[0] * sideDot; desired[1] = side[1] * sideDot;
          this.metrics.blocks++;
        }
      }
    }
    person.yieldToRobot = Math.max(0, person.yieldToRobot - dt);

    // 速度限制 + 转向平滑；phase 与真实位移绑定，避免"原地踏步"。
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
    const nextX = clamp(person.position[0] + person.velocity[0] * dt, 3, STORE.width - 3);
    const nextY = clamp(person.position[1] + person.velocity[1] * dt, 3, STORE.height - 3);
    // 货架是静态障碍：不允许行人穿柜。采用轴分离 + 回退到通道中心。
    if (!this.blockedByFixture(nextX, person.position[1], person)) person.position[0] = nextX; else person.velocity[0] = 0;
    if (!this.blockedByFixture(person.position[0], nextY, person)) person.position[1] = nextY; else person.velocity[1] = 0;
  }

  blockedByFixture(x, y, person) {
    const r = person.radius / M;
    for (const s of shelves) if (x > s.xMin - r && x < s.xMax + r && y > s.yMin - r && y < s.yMax + r) return true;
    return false;
  }

  snapshot() {
    return this.people.map(p => ({
      id: p.id, type: p.type, typeName: p.typeName, cn: p.cn,
      x: p.position[0], y: p.position[1], vx: p.velocity[0], vy: p.velocity[1],
      heading: p.heading, phase: p.phase, speed: Math.hypot(p.velocity[0], p.velocity[1]) * M,
      state: p.state, cart: p.cart, style: p.style, color: p.color,
      radius: p.radius, height: p.height, crossing: p.crossing,
    }));
  }
}

function normalize(v) {
  const d = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / d, v[1] / d];
}
