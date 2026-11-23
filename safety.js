// NEXUS RETAIL 2.1 — Unified collision, trajectory and motion-control layer.
// 所有几何都在「地图单位」下计算（1 unit = 0.17 m），与 storeData.js / app.js / scene3d.js 同源。
// 设计原则：静态障碍膨胀 + 圆形底盘扫掠 + 碰撞感知路径简化 + Pure Pursuit + 加速度限制。
// 本模块只提供纯函数/状态对象；不直接改写 app.js 的订单/库存/仿真状态。

import { PHYSICS, STORE, shelves, layoutFixtures } from './storeData.js';

const M = PHYSICS.metersPerUnit;
const ROBOT_R = PHYSICS.robot.radius / M;          // 0.26 m → 1.529 地图单位
const EXTRA = 0.12 / M;                             // 12 cm 安全余量 → 0.71 单位
export const ROBOT_INFLATE = ROBOT_R + EXTRA;       // ≈ 2.59 单位（含余量的底盘半径）

// 运行时扫掠只对「机器人侧偏/转弯时真正会撞上的大型固定障碍」生效。
// A* 网格已把全部 fixture 视为不可通行，规划折线本身不会穿过它们；而 charger / robotpay
// 是机器人必须靠近对接的装置——dockSlot=[108,13.4] 距桩体 AABB 边缘仅 2.9 单位，
// 加上底盘膨胀 2.235 后膨胀盒覆盖到 y=12.735，LANE_KEEP 侧偏会把机器人中心推到 y≈12.71，
// 导致起步阶段被误判为穿模并反复重规划。把这两个对接装置交给 A* + 视觉层处理，
// 运行时扫掠只兜底货架/墙/冷柜/收银台等不会主动靠近的实体。
const SOLID_FIXTURE = new Set(['wall', 'promo', 'checkout', 'kiosk', 'cooler']);

/** 统一静态碰撞体：货架 AABB + 实体装置 AABB，全部按机器人底盘半径膨胀。 */
export function buildStaticObstacles() {
  const out = [];
  for (const s of shelves) {
    out.push({
      kind: 'shelf', id: s.id, name: s.category,
      xMin: s.xMin, xMax: s.xMax, yMin: s.yMin, yMax: s.yMax,
    });
  }
  for (const f of layoutFixtures) {
    if (!SOLID_FIXTURE.has(f.kind)) continue;
    const hw = f.w / 2, hh = f.h / 2;
    out.push({
      kind: f.kind, id: f.id || `${f.kind}-${f.x}-${f.y}`, name: f.kind,
      xMin: f.x - hw, xMax: f.x + hw, yMin: f.y - hh, yMax: f.y + hh,
    });
  }
  return out;
}

export const STATIC_OBSTACLES = buildStaticObstacles();

/** 点是否落入任一膨胀后的静态障碍。radiusUnits 为额外半径（默认机器人底盘膨胀）。 */
export function pointBlocked(p, radius = ROBOT_INFLATE, obstacles = STATIC_OBSTACLES) {
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return true;
  for (const o of obstacles) {
    if (p[0] > o.xMin - radius && p[0] < o.xMax + radius &&
        p[1] > o.yMin - radius && p[1] < o.yMax + radius) return o;
  }
  return null;
}

/** 点到线段最短距离（用于扫掠的连续检测，不是只采样端点）。 */
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 线段是否扫过任一障碍（把障碍 AABB 膨胀 radius 后做线段-AABB 相交）。 */
export function segmentBlocked(a, b, radius = ROBOT_INFLATE, obstacles = STATIC_OBSTACLES) {
  if (!a || !b) return null;
  // 对膨胀矩形做 slab 相交测试（连续，不依赖采样密度）
  for (const o of obstacles) {
    const minX = o.xMin - radius, maxX = o.xMax + radius;
    const minY = o.yMin - radius, maxY = o.yMax + radius;
    let t0 = 0, t1 = 1;
    for (const [origin, delta, lo, hi] of [
      [a[0], b[0] - a[0], minX, maxX],
      [a[1], b[1] - a[1], minY, maxY],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < lo || origin > hi) { t0 = 2; break; }
      } else {
        let ta = (lo - origin) / delta, tb = (hi - origin) / delta;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) break;
      }
    }
    if (t0 <= t1 && t0 <= 1 && t1 >= 0) return o;
  }
  return null;
}

/** 机器人转弯时的底盘扫掠：中心线 + 四个角点轨迹全部检查。 */
export function sweepBlocked(from, to, fromHeading, toHeading,
                             radius = ROBOT_INFLATE, obstacles = STATIC_OBSTACLES) {
  if (!from || !to) return null;
  const hit = segmentBlocked(from, to, radius, obstacles);
  if (hit) return hit;
  // 旋转时按车头/车尾/左右侧四个方向取底盘边缘点，检查其扫掠线
  const steps = 4;
  const angles = [fromHeading, toHeading];
  const edge = PHYSICS.robot.length / 2 / M * 0.9; // 近似半长（地图单位）
  for (const ang of angles) {
    if (!Number.isFinite(ang)) continue;
    const fx = Math.sin(ang) * radius, fy = Math.cos(ang) * radius;
    const sx = Math.cos(ang) * edge, sy = -Math.sin(ang) * edge;
    const probes = [
      [[from[0] + fx, from[1] + fy], [to[0] + fx, to[1] + fy]],
      [[from[0] - fx, from[1] - fy], [to[0] - fx, to[1] - fy]],
      [[from[0] + sx, from[1] + sy], [to[0] + sx, to[1] + sy]],
      [[from[0] - sx, from[1] - sy], [to[0] - sx, to[1] - sy]],
    ];
    for (const [pa, pb] of probes) {
      const h = segmentBlocked(pa, pb, 0, obstacles);
      if (h) return h;
    }
  }
  void steps;
  return null;
}

/** Line-of-Sight 路径简化：保留起点/终点，跳过所有可直连的中间拐点。 */
export function lineOfSightSimplify(points, obstacles = STATIC_OBSTACLES) {
  const pts = points.filter(Boolean);
  if (pts.length <= 2) return pts.map(p => [...p]);
  const out = [[...pts[0]]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && segmentBlocked(pts[i], pts[j], ROBOT_INFLATE, obstacles)) j--;
    out.push([...pts[j]]);
    i = j;
  }
  return out;
}

/** 碰撞感知平滑：在 LOS 折线上做迭代 Chaikin 圆角化；任一段碰撞则回退到 LOS 结果。 */
export function collisionAwareSmooth(points, iterations = 2, obstacles = STATIC_OBSTACLES) {
  const base = lineOfSightSimplify(points, obstacles);
  if (base.length <= 2) return base;
  let current = base;
  for (let it = 0; it < iterations; it++) {
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i], b = current[i + 1];
      next.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
      next.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    next.push(current[current.length - 1]);
    // 验证每一段都不碰撞；不通过则本次迭代作废（保持上一轮可用结果）
    let ok = true;
    for (let i = 1; i < next.length && ok; i++) {
      if (segmentBlocked(next[i - 1], next[i], ROBOT_INFLATE, obstacles)) ok = false;
    }
    if (ok) current = next; else break;
  }
  return current;
}

export function pathLength(points) {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return n;
}

/** 沿折线按弧长取点（Pure Pursuit 的 lookahead 目标）。 */
export function pointAtDistance(points, distance) {
  if (!points?.length) return null;
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= seg || i === points.length - 1) {
      const t = seg > 1e-9 ? Math.min(1, left / seg) : 1;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i - 1, remaining: seg - left };
    }
    left -= seg;
  }
  return { point: [...points[points.length - 1]], index: points.length - 2, remaining: 0 };
}

export const angleWrap = a => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Pure Pursuit 转向：返回本步应达到的 heading 与角速度。
 * heading 与 app.js 一致：0 = 地图 +y，顺时针为正（atan2(dx,dy)）。
 */
export function purePursuit(position, heading, points, at, opts = {}) {
  const lookahead = opts.lookahead ?? 11;           // 地图单位（≈1.87 m）
  const maxRate = opts.maxRate ?? 1.35;             // rad/s 角速度上限
  const maxAccel = opts.maxAccel ?? 2.4;            // rad/s² 角加速度上限
  if (!points?.length || !Number.isFinite(heading)) return { heading, rate: 0, target: null };
  const target = pointAtDistance(points, at + lookahead);
  if (!target) return { heading, rate: 0, target: null };
  const desired = Math.atan2(target.point[0] - position[0], target.point[1] - position[1]);
  const err = angleWrap(desired - heading);
  const rate = clamp(err / Math.max(.12, lookahead / 22), -maxRate, maxRate);
  const nextRate = clamp(rate, (opts.prevRate ?? 0) - maxAccel * (opts.dt || .016), (opts.prevRate ?? 0) + maxAccel * (opts.dt || .016));
  return { heading: heading + nextRate * (opts.dt || .016), rate: nextRate, target: target.point, error: err };
}

/** 纵向速度控制：加速度/制动限制 + 到点自动减速。 */
export function speedProfile(current, target, remaining, dt = .016, cfg = {}) {
  const accel = cfg.accel ?? PHYSICS.robot.accel / M;   // m/s² → units/s²
  const brake = cfg.brake ?? PHYSICS.robot.brake / M;
  const maxSpeed = cfg.maxSpeed ?? PHYSICS.robot.maxSpeed / M;
  let goal = clamp(target, 0, maxSpeed);
  // 剩余距离小于制动距离时按比例减速（保证到点停车）
  const stopDistance = (current * current) / (2 * brake) + 1.2;
  if (remaining < stopDistance) goal = Math.min(goal, Math.max(0, (remaining - .3) / Math.max(.5, stopDistance)) * maxSpeed);
  const delta = clamp(goal - current, -brake * dt, accel * dt);
  return clamp(current + delta, 0, maxSpeed);
}

/* ---------------------------------------------------------------------------
 * 决策日志：只记录运行时真实状态，不做预先写死的文本。
 * ------------------------------------------------------------------------- */
export class DecisionLog {
  constructor(limit = 120) { this.entries = []; this.limit = limit; }
  push(clock, level, source, text, data = {}) {
    const entry = {
      id: `D${String(this.entries.length + 1).padStart(3, '0')}`,
      at: +(clock || 0).toFixed(2),
      level, source, text, data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    return entry;
  }
  clear() { this.entries.length = 0; }
  list() { return [...this.entries]; }
}

/* ---------------------------------------------------------------------------
 * 局部规划器：每个仿真步比较 A 减速 / B 左绕 / C 右绕 / D 等待 / E 后退。
 * 与 robotBehavior 的预测式 TTC 互补：这里做「方案比较 + 代价选择」。
 * ------------------------------------------------------------------------- */
export class LocalPlanner {
  constructor() {
    this.lastAction = 'NORMAL';
    this.blockedTime = 0;
    this.waitTime = 0;
    this.backCooldown = 0;
    // 决策滞回：一次避让动作至少保持一段时间，避免逐帧在 SLOW/BACK 间振荡、刷屏日志。
    this.heldOption = null;
    this.holdUntil = 0;
    this.lastLoggedAction = 'NORMAL';
    this.log = new DecisionLog();
  }
  reset() {
    this.lastAction = 'NORMAL'; this.blockedTime = 0; this.waitTime = 0; this.backCooldown = 0;
    this.heldOption = null; this.holdUntil = 0; this.lastLoggedAction = 'NORMAL'; this.log.clear();
  }

  /** 左右侧可用空间：沿法线方向采样，找连续可通行宽度（地图单位）。 */
  sideClearance(position, direction, sign) {
    const nx = -direction[1] * sign, ny = direction[0] * sign;
    let clear = 0;
    for (let d = .6; d <= 9; d += .6) {
      const p = [position[0] + nx * d, position[1] + ny * d];
      if (pointBlocked(p, ROBOT_INFLATE, STATIC_OBSTACLES)) break;
      clear = d;
    }
    return clear;
  }

  /** 后方是否安全（倒车必要条件）。 */
  rearClear(position, direction, pedestrians, minBack = 4.5) {
    const bx = -direction[0], by = -direction[1];
    for (let d = 1; d <= minBack; d += .75) {
      const p = [position[0] + bx * d, position[1] + by * d];
      if (pointBlocked(p, ROBOT_INFLATE, STATIC_OBSTACLES)) return false;
      for (const q of pedestrians) {
        if (!q || !Number.isFinite(q.x)) continue;
        if (Math.hypot(q.x - p[0], q.y - p[1]) < (q.radius || .26) / M + ROBOT_R + .6) return false;
      }
    }
    return true;
  }

  /**
   * @param ctx {clock, position, direction, speed, pedestrians, obstacles, aheadCount, ttc,
   *             riskPredict, remain, emergency}
   * @returns {action, speedFactor, lateral, backUp, reason, scores, risk, log}
   */
  decide(ctx) {
    const dt = ctx.dt ?? .016;
    this.backCooldown = Math.max(0, this.backCooldown - dt);
    const ahead = ctx.aheadCount || 0;
    const rawTtc = Number.isFinite(ctx.ttc) ? ctx.ttc : 99;
    // TTC=0 但前方无人：通常来自侧向障碍/已通过目标/除零，不是真正的迎面碰撞信号。
    // 若不加判断会把正常配送误触发为 BACK，机器人反复倒退、订单无法完成。
    const ttc = (rawTtc <= 0 && ahead === 0 && !ctx.emergency) ? 99 : rawTtc;
    // 收紧触发：只有【前方近处（<8 单位）确实有人】或【有效 TTC 逼近】或【紧急停车】才算风险。
    // 旧逻辑 ahead>0（<11 单位、侧偏<3.2）过于宽泛，走廊另一侧的人也会持续触发减速。
    const risky = (ttc < 3.2 && ttc >= 0) || !!ctx.emergency ||
      (ahead > 0 && (ctx.nearestDistance ?? 99) < 8);
    const risk = typeof ctx.riskPredict === 'function'
      ? ctx.riskPredict({ pedestrian_density: ahead, robot_ped_distance: ctx.nearestDistance ?? 9,
          relative_velocity: ctx.nearestSpeed ?? 0, ttc: Math.min(ttc, 12),
          corridor_width: ctx.corridorWidth ?? 2.6, obstacle_count: (ctx.obstacles || []).length })
      : { level: ahead > 1 ? 'High' : ahead ? 'Medium' : 'Low', score: ahead * .3 };
    const left = this.sideClearance(ctx.position, ctx.direction, 1);
    const right = this.sideClearance(ctx.position, ctx.direction, -1);

    if (!risky) {
      this.blockedTime = 0; this.waitTime = 0;
      this.heldOption = null; this.holdUntil = 0;
      const first = !this.log.entries.length; // 每个配送段记录一条真实起始决策，日志不留白
      this.lastAction = 'NORMAL'; this.lastLoggedAction = 'NORMAL';
      const log = first
        ? this.log.push(ctx.clock, 'info', 'LocalPlanner',
          `通道畅通，保持全局路线（ML 风险 ${risk.level}）`,
          { risk: risk.level, riskScore: risk.score, left: +left.toFixed(1), right: +right.toFixed(1),
            chosen: 'NORMAL', scores: { SLOW: '待命', LEFT: '待命', RIGHT: '待命', WAIT: '待命', BACK: '待命' } })
        : null;
      return { action: 'NORMAL', speedFactor: 1, lateral: null, backUp: false, risk, left, right,
               reason: '通道畅通，保持全局路线', scores: {}, log };
    }

    this.blockedTime += dt;
    const laneNeed = ROBOT_INFLATE + .5;
    // ML 风险数值化：优先用模型输出的 label(0/1/2) 与 score(0..1)，语言无关；
    // 无模型时用启发式 level 字符串。这样 12 树森林真正在线影响五个方案代价。
    const riskHigh = (Number.isFinite(risk?.label) ? risk.label >= 2 : risk?.level === 'High')
      || (Number.isFinite(risk?.score) && risk.score > .66);
    const riskPenalty = riskHigh ? 1.4 : 0;
    const options = [
      // A 减速继续：代价随 TTC 与 ML 风险上升
      { action: 'SLOW', speedFactor: .42, lateral: null, backUp: false,
        cost: 1.0 + (ttc < 2 ? 1.6 : 0) + riskPenalty + ahead * .3,
        label: '减速继续前进' },
      // B 左绕：空间不足则不可用；高风险时更倾向绕行而非硬闯
      { action: 'LEFT', speedFactor: .58, lateral: Math.min(left - .4, 2.1), backUp: false,
        cost: left < laneNeed ? 1e6 : 1.3 + (riskHigh ? 0 : .7), label: '向左绕行' },
      // C 右绕
      { action: 'RIGHT', speedFactor: .58, lateral: -Math.min(right - .4, 2.1), backUp: false,
        cost: right < laneNeed ? 1e6 : 1.3 + (riskHigh ? 0 : .7), label: '向右绕行' },
      // D 等待：短期代价低，但长期升高
      { action: 'WAIT', speedFactor: 0, lateral: null, backUp: false,
        cost: 1.5 + this.waitTime * .25 + ahead * .3, label: '暂时停车等待' },
      // E 后退：仅【前方确实有人 + 堵死>4s + 后方安全 + 冷却结束】才启用。
      // 不再因 ttc<1.6 直接给负折扣——那会让侧向障碍/瞬时低 TTC 误触发大量倒退。
      { action: 'BACK', speedFactor: .32, lateral: null, backUp: true,
        cost: (ahead === 0 || this.blockedTime < 4 || !this.rearClear(ctx.position, ctx.direction, ctx.pedestrians) || this.backCooldown > 0)
          ? 1e6 : 2.2, label: '后退到安全位置再绕行' },
    ];
    // 长时间堵死时，后退优先级上升（避免原地等待振荡）
    if (this.blockedTime > 6 && options[4].cost < 1e5) options[4].cost -= .8;
    if (this.waitTime > 5) options[3].cost += 2;

    let best = options.reduce((a, b) => b.cost < a.cost ? b : a);
    if (best.cost >= 1e5) best = options[3]; // 两侧与后方都不可用 → 停车等待并定期重评

    // 决策滞回：一次非 NORMAL 动作至少保持 hold 秒，紧急状态可立即打断。
    // 避免机器人每个仿真步在 SLOW/BACK 间反复切换（既抖动又刷屏日志）。
    if (this.heldOption && ctx.clock < this.holdUntil && !ctx.emergency) {
      best = this.heldOption;
    } else {
      this.heldOption = best;
      const hold = best.action === 'NORMAL' ? 0 : ['LEFT', 'RIGHT', 'BACK'].includes(best.action) ? .9 : .45;
      this.holdUntil = ctx.clock + hold;
    }
    if (best.action === 'BACK') { this.backCooldown = 6; this.waitTime = 0; }
    if (best.action === 'WAIT') this.waitTime += dt; else this.waitTime = 0;
    this.lastAction = best.action;

    // 日志只在动作真正切换时记录一次，避免每个子步刷屏（一个仿真秒 60 条）。
    let log = null;
    if (best.action !== this.lastLoggedAction) {
      log = this.log.push(ctx.clock, riskHigh ? 'warn' : 'info', 'LocalPlanner',
        `前方 ${ahead} 人 / TTC ${ttc < 90 ? ttc.toFixed(1) + 's' : '∞'} → ${best.label}`,
        { risk: risk.level, left: +left.toFixed(1), right: +right.toFixed(1), chosen: best.action,
          cost: +best.cost.toFixed(2), scores: Object.fromEntries(options.map(o => [o.action, +o.cost.toFixed(2)])) });
      this.lastLoggedAction = best.action;
    }
    return { action: best.action, speedFactor: best.speedFactor, lateral: best.lateral,
             backUp: best.backUp, risk, left, right, reason: best.label,
             scores: Object.fromEntries(options.map(o => [o.action, +o.cost.toFixed(2)])), log };
  }
}
