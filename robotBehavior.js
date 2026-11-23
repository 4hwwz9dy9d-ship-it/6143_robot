// NEXUS RETAIL — human-aware local navigation: behaviour state machine and
// predictive collision detection. SIMULATION / rule-driven, not a certified
// safety system. A* still owns the global route; this module only modulates
// longitudinal speed and requests a replan when the corridor is blocked.
import { PHYSICS } from './storeData.js';

const M = PHYSICS.metersPerUnit;
const P = PHYSICS.robot, S = PHYSICS.safety;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = v => { const d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };

export const ROBOT_STATES = Object.freeze([
  'NORMAL_NAVIGATION', 'SLOW_DOWN', 'YIELD', 'WAIT',
  'AVOIDANCE', 'REPLANNING', 'RESUME', 'EMERGENCY_STOP',
]);

export const ROBOT_STATE_CN = Object.freeze({
  NORMAL_NAVIGATION: '正常行驶', SLOW_DOWN: '减速', YIELD: '礼让行人', WAIT: '等待通行',
  AVOIDANCE: '绕行避让', REPLANNING: '重新规划', RESUME: '恢复行驶', EMERGENCY_STOP: '紧急停车',
});

export class RobotBehavior {
  constructor() { this.reset(); }

  reset() {
    this.state = 'NORMAL_NAVIGATION';
    this.previousState = 'NORMAL_NAVIGATION';
    this.blockedTime = 0;
    this.clearTime = 0;
    this.replanPending = false;
    this.replanCooldown = 0;
    // V3.4 蠕行停滞检测窗口
    this.progressClock = 0; this.progressAnchor = null; this.crawlWindows = 0;
    this.collisionCooldown = 0;
    this.nearMissCooldown = 0;
    this.yieldCooldown = 0;
    this.interventionCooldown = 0;
    this.emergencyTime = 0;
    this.backupLeft = 0;    // V3.8：紧急死锁倒车剩余量
    // V2.5：连续「侧向净空足够但被挡住」的时长，用于判定人机对峙僵局并主动绕行。
    this.bypassTime = 0;
    this.metrics = {
      collisions: 0, nearMisses: 0, yields: 0, replannings: 0, bypasses: 0,
      waitSeconds: 0, humanInterventions: 0, minDistance: Infinity, minTtc: Infinity,
    };
    this.last = { ttc: Infinity, distance: Infinity, pedestrian: null, reason: '通道畅通' };
    this.transitions = [];
  }

  acknowledgeReplan() { this.replanPending = false; this.replanCooldown = 6; this.blockedTime = 0; }

  setState(next, reason) {
    if (next === this.state) return;
    this.previousState = this.state;
    this.state = next;
    this.transitions.push({ state: next, reason });
    if (this.transitions.length > 80) this.transitions.shift();
    if ((next === 'YIELD' || next === 'WAIT') && this.yieldCooldown === 0) {
      this.metrics.yields++; this.yieldCooldown = 1.5;
    }
    if (next === 'REPLANNING') { this.metrics.replannings++; this.replanPending = true; }
    if (next === 'AVOIDANCE') this.metrics.bypasses++;
    if (next === 'EMERGENCY_STOP' && this.interventionCooldown === 0) {
      this.metrics.humanInterventions++; this.interventionCooldown = 4;
    }
  }

  /**
   * @param {object} input
   * @param {number[]} input.position       地图坐标
   * @param {number[]} input.velocity       地图单位/秒
   * @param {number[]} input.direction      当前路段前向单位向量
   * @param {Array} input.pedestrians       行人快照（x,y,vx,vy,radius）
   * @param {Array} input.obstacles         静态障碍（x,y,radius）
   * @param {number} input.dt               秒
   */
  evaluate({ position, velocity = [0, 0], direction = [1, 0], pedestrians = [], obstacles = [], dt = .016 }) {
    const step = clamp(dt, 0, .08);
    this.yieldCooldown = Math.max(0, this.yieldCooldown - step);
    this.interventionCooldown = Math.max(0, this.interventionCooldown - step);
    this.replanCooldown = Math.max(0, this.replanCooldown - step);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - step);
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - step);
    const robotPos = [position[0] * M, position[1] * M];
    const robotVel = [velocity[0] * M, velocity[1] * M];
    const forward = norm(direction);
    const speed = Math.hypot(robotVel[0], robotVel[1]);
    const brakeDistance = speed * speed / (2 * P.brake);
    const horizon = S.warnDistance + brakeDistance;

    let worst = null;
    let emergency = false, nearMiss = false, collision = false;
    let avoidance = 0;
    // V3.6 意图修正：机器人是自主决策体，不是会被推着走的物体——
    // 行人靠近时机器人只做「纵向调速 + 停车礼让 + 数据驱动换路」三件事，
    // 不再做任何侧向平移（旧的「绕行偏移」「停车让位」观感上就是被行人挤走，已全部移除）。
    // 通道内的固定位置由 LANE_KEEP 靠右偏置决定（与行人无关，永远平行于路线）。
    // V3.1：不再「挤缝」——人挡在车道上时机器人选择停车等待或改道，
    // 而是横着蹭过去（那既像推人，也会左右抖）。只有人本来就站在车道边缘、
    // 净空明确足够时才低速绕过。

    const consider = (obj, radius, isPerson) => {
      const rel = [obj.x * M - robotPos[0], obj.y * M - robotPos[1]];
      const rv = [(obj.vx || 0) * M - robotVel[0], (obj.vy || 0) * M - robotVel[1]];
      const d = Math.hypot(rel[0], rel[1]);
      if (d > horizon + radius + S.buffer) return;
      const rv2 = dot(rv, rv);
      const tStar = rv2 > 1e-6 ? clamp(-dot(rel, rv) / rv2, 0, horizon) : 0;
      const closest = Math.hypot(rel[0] + rv[0] * tStar, rel[1] + rv[1] * tStar);
      const safety = P.radius + radius + S.buffer;
      const critical = P.radius + radius + S.emergencyGap;
      const along = dot(rel, forward);
      const lateral = -rel[0] * forward[1] + rel[1] * forward[0];
      const closing = d > .001 ? -dot(rel, rv) / d : 0;
      const ttc = closing > .01 && closest < safety
        ? Math.max(0, (d - critical) / closing) : closest < safety ? tStar : Infinity;
      const pedUnit = norm([obj.vx || 0, obj.vy || 0]);
      const relativeHeading = dot(pedUnit, forward);
      const pedSpeed = Math.hypot(obj.vx || 0, obj.vy || 0) * M;

      if (d <= critical) emergency = true;                    // 预留制动/安全间隙即停车
      if (d <= P.radius + radius) collision = true;           // 真实几何侵入才计为碰撞
      if (closest < critical + .12 && tStar <= horizon) { nearMiss = true; }
      if (closest >= safety || along < -.6 || Math.abs(lateral) > 1.8) return;
      // 已明确远离且距离足够：不占用通行决策，避免无意义反复减速。
      const away = isPerson && relativeHeading > .45;
      if (away && d > P.radius + radius + .75) return;
      // V2.2：行人已主动侧移让行（yieldToRobot>0）时放宽决策阈值，
      // 让机器人保持通行，避免双方互相等待形成"围住机器人"的观感。
      const yielding = isPerson && (obj.avoiding || obj.yieldToRobot > 0);
      if (yielding && d > P.radius + radius + .55) return;

      const candidate = {
        id: obj.id || 'obstacle', distance: d, ttc, closest, safety, along, lateral,
        pedSpeed, relativeHeading, isPerson, radius,
        crossing: isPerson && pedSpeed > .12 && Math.abs(relativeHeading) < .62 && Math.abs(lateral) > .18,
        headOn: isPerson && relativeHeading < -.45,
        away, tStar,
      };
      if (!worst || candidate.ttc < worst.ttc || candidate.distance < worst.distance * .8) worst = candidate;

      // 侧向可绕行判断：人已经在车道边缘（横向净空 > 半车宽 + 人体半径 + 0.25 m）
      // 才算「可以绕过去」；人站在车道中间时这里不会给绕行信号，机器人会停下等待。
      const clearance = Math.abs(lateral) - (P.width / 2 + radius + .25);
      if (clearance > 0 && along > .4 && !candidate.crossing && d < S.warnDistance + .6) {
        avoidance = avoidance || (lateral > 0 ? -1 : 1);
      }
    };

    for (const person of pedestrians) consider(person, person.radius ?? .26, true);
    for (const obstacle of obstacles) consider(obstacle, obstacle.radius ?? .3, false);

    if (collision && this.collisionCooldown === 0) {
      this.metrics.collisions++; this.collisionCooldown = 1.5;
    }
    if (nearMiss && this.nearMissCooldown === 0) {
      this.metrics.nearMisses++; this.nearMissCooldown = 1.5;
    }
    if (worst) {
      this.last = {
        ttc: worst.ttc, distance: worst.distance, pedestrian: worst.id,
        reason: worst.crossing ? '行人横穿预测路径' : worst.headOn ? '迎面相遇' : worst.away ? '行人远离' : '前方行人',
      };
      this.metrics.minDistance = Math.min(this.metrics.minDistance, worst.distance);
      this.metrics.minTtc = Math.min(this.metrics.minTtc, worst.ttc);
    } else {
      this.last = { ttc: Infinity, distance: Infinity, pedestrian: null, reason: '安全区域已清空' };
    }

    let speedFactor = 1;
    let next = this.state;
    let reason = this.last.reason;

    if (emergency) {
      // 物理安全边界侵入：立即停车，记录事件并请求人工确认。
      this.emergencyTime += step;
      next = 'EMERGENCY_STOP'; speedFactor = 0;
      reason = '检测到侵入安全边界，立即停车并请求人工确认';
      // V3.8 死锁破解：行人被楔在 hull 边（碰撞钳制恰好压在安全边界上，排斥力与
      // 行进意图抵消、人无法自行离开）时，EMERGENCY_STOP 会永远保持——实测可死锁
      // 3000+ 仿真秒。紧急持续 >6 s：机器人沿车头反方向**倒车**让出空间（自主决策、
      // 不偏离航道、不是被人挤走），把楔住的人放出来。倒车一段后若仍被占，休息
      // 4 s 再倒一轮（循环武装，直到人离开或人工介入）。
      if (this.emergencyTime > 6) {
        if ((this.backupLeft ?? 0) > 0) { /* 正在倒车，倒完再休息 */ }
        else {
          this.backupRest = Math.max(0, (this.backupRest ?? 0) - step);
          if (this.backupRest <= 0) this.backupLeft = 2.2;
        }
      }
    } else if (worst) {
      this.emergencyTime = Math.max(0, this.emergencyTime - step * 2);
      if (this.emergencyTime <= 0) this.backupLeft = 0;
      const { distance, ttc, crossing, headOn, away } = worst;
      // V2.5：侧向净空足够时机器人「绕过人」继续通行，而不是长时间停车等对峙。
      // 只要不是行人横穿/迎面窄道，且已出现减速停滞，就主动进入绕行（速度不大幅下降）。
      const canBypass = worst.isPerson && avoidance !== 0 && worst.along > .3 && !crossing && !headOn && distance > .9;
      this.bypassTime = canBypass ? this.bypassTime + step : 0;
      const stalled = this.blockedTime > 1.0 || ['WAIT', 'YIELD', 'SLOW_DOWN', 'REPLANNING'].includes(this.state);
      if (canBypass && (stalled || this.bypassTime > .8)) {
        // 低速绕行：净空足够才加速通过，人仍很近时进一步降速，避免高峰人群里高速切入造成几何侵入。
        next = 'AVOIDANCE';
        speedFactor = distance < 1.3 ? .32 : .55;
        reason = '侧向净空足够，机器人低速主动绕行通过行人';
      } else if (crossing && ttc < 3.2) {
        next = 'YIELD'; speedFactor = 0; reason = '行人正在横穿，停车礼让';
      } else if (headOn && distance < S.yieldDistance + P.radius + worst.radius) {
        next = 'WAIT'; speedFactor = 0; reason = '窄通道迎面相遇，等待行人通过';
      } else if (!avoidance && !away && distance < 1.5) {
        // V3.1：人挡在车道上、绕行净空不足——停车等待，不挤行、不推人。
        // 持续受阻会由 blockedTime 触发重新规划（换一条人少的路，必要时倒车换向）。
        next = 'WAIT'; speedFactor = 0; reason = '行人挡住通道，停车等待（不挤行）';
      } else if (away) {
        if (distance < 1.1) { next = 'SLOW_DOWN'; speedFactor = .3; reason = '行人刚离开，低速确认'; }
        else {
          next = ['SLOW_DOWN', 'YIELD', 'WAIT'].includes(this.state) ? 'RESUME' : 'NORMAL_NAVIGATION';
          speedFactor = 1;
        }
      } else if (distance < S.warnDistance || ttc < 3.4) {
        next = 'SLOW_DOWN';
        speedFactor = clamp(.28 + (distance - S.yieldDistance) / (S.warnDistance - S.yieldDistance) * .52, .18, .8);
        if (ttc < 1.8) speedFactor = Math.min(speedFactor, .25);
      } else if (avoidance && this.state !== 'WAIT') {
        next = 'AVOIDANCE'; speedFactor = .45; reason = '侧向净空足够，低速绕行';
      }
    } else if (this.state === 'YIELD' || this.state === 'WAIT' || this.state === 'EMERGENCY_STOP') {
      next = 'RESUME'; speedFactor = .5; reason = '安全区域已清空，重新检查后恢复';
    } else if (this.state === 'REPLANNING') {
      next = 'RESUME'; speedFactor = .5;
    } else if (this.state === 'RESUME') {
      this.clearTime += step;
      if (this.clearTime > .8) { next = 'NORMAL_NAVIGATION'; this.clearTime = 0; }
      else speedFactor = .6;
    } else {
      this.emergencyTime = Math.max(0, this.emergencyTime - step * 2);
      next = 'NORMAL_NAVIGATION';
    }

    // 长时间无法通行：请求 A* 重新规划；若仍无解，保持停车并请求人工介入。
    if (speedFactor < .2 && !emergency) {
      this.blockedTime += step;
      this.metrics.waitSeconds += step;
      if (this.blockedTime > 4.0 && this.replanCooldown === 0) {
        next = 'REPLANNING'; reason = '通道持续受阻超过 4 秒，请求重新规划';
        speedFactor = .12;
      } else if (this.blockedTime > 9.0) {
        next = 'WAIT'; reason = '无法安全绕行，保持停车并请求人工介入';
        if (this.metrics.humanInterventions === 0 || this.blockedTime - step <= 9.0) this.metrics.humanInterventions++;
      }
    } else {
      this.blockedTime = Math.max(0, this.blockedTime - step * 1.6);
      if (this.state !== 'RESUME') this.clearTime = 0;
    }

    // V3.4 蠕行停滞检测：AVOIDANCE/SLOW_DOWN 以 0.2–0.8 倍速蠕动时 speedFactor ≥0.2，
    // 上面的 blockedTime 永远不累计——高峰人群里机器人能以 ≈0.05 m/s 蠕行上百秒，
    // 课堂上看起来就是「机器人卡死」。用固定窗口的净进度兜底：
    // 5 s 窗口位移 < 1.5 单位（≈0.26 m）视为受阻 → 请求换路；连续 3 窗仍无解才请求人工介入。
    // 取货暂停/结账等待在 stepSimulation 更早处返回，不会进入本逻辑。
    this.progressClock = (this.progressClock || 0) + step;
    if (this.progressClock >= 5) {
      const moved = position && this.progressAnchor
        ? Math.hypot(position[0] - this.progressAnchor[0], position[1] - this.progressAnchor[1]) : Infinity;
      this.progressAnchor = position ? [...position] : null;
      this.progressClock = 0;
      if (moved < 1.5) {
        this.crawlWindows = (this.crawlWindows || 0) + 1;
        this.metrics.crawlStalls = (this.metrics.crawlStalls || 0) + 1;
        if (this.crawlWindows < 3 && this.replanCooldown === 0) {
          next = 'REPLANNING';
          reason = '蠕动停滞：5 秒净进度不足，请求换路绕行';
          speedFactor = .12;
          this.blockedTime = Math.max(this.blockedTime, 4.5);
        } else if (this.crawlWindows >= 3) {
          next = 'WAIT';
          reason = '持续蠕动停滞，保持停车并请求人工介入';
          if (this.metrics.humanInterventions === 0 || this.crawlWindows === 3) this.metrics.humanInterventions++;
        }
      } else this.crawlWindows = 0;
    }

    // V3.6：侧向平移已移除——AVOIDANCE 状态只表示「低速从行人旁边通过」，
    // 车体始终贴自己的靠右车道线，不横移。avoidSide/avoidHold 的防抖记忆随之不再需要。
    // 停车时也不再「让位平移」：机器人原地停在自己的车道上，行人绕行（行人让行规则不变）。

    this.setState(next, reason);
    // V3.8：紧急停车超 6 s 且安全边界仍被占据 → 输出倒车指令（app.js 沿车头反方向平移）。
    const backing = emergency && (this.backupLeft ?? 0) > 0;
    if (backing) {
      this.backupLeft -= step;
      if (this.backupLeft <= 0) { this.backupLeft = 0; this.backupRest = 4; }
    }
    return {
      state: this.state, speedFactor,
      backUp: backing,       // 沿自身路线倒车脱困（车道保持不变，只是纵向后退）
      parkShift: 0,           // V3.6：停车不再侧移让位（保持车道线，行人绕行）
      lateralShift: 0,        // V3.6：不再有行人触发的侧向偏移（靠右行驶由 LANE_KEEP 常量承担）
      ttc: this.last.ttc, distance: this.last.distance, reason, emergency,
      needsReplan: this.replanPending, collision, nearMiss,
      brakeDistance, targetSpeed: P.maxSpeed * speedFactor,
      safetyStatus: emergency ? '碰撞风险' : worst ? (speedFactor < .2 ? '已让行' : '预警减速') : '安全',
      label: ROBOT_STATE_CN[this.state],
    };
  }
}
