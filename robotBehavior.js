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
    this.collisionCooldown = 0;
    this.nearMissCooldown = 0;
    this.yieldCooldown = 0;
    this.interventionCooldown = 0;
    this.emergencyTime = 0;
    // V2.5：连续「侧向净空足够但被挡住」的时长，用于判定人机对峙僵局并主动绕行。
    this.bypassTime = 0;
    // V2.9：主动偏出的横向位移（米，带符号）与其保持时间。
    this.steer = 0;
    this.steerHold = 0;
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
    // V2.9：前方有人直挺挺挡在车道上时，机器人自己挑一侧空隙偏出去，
    // 而不是等人让路或者原地干等（steerNeed 单位：米，带符号）。
    let steerNeed = 0;

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

      // 侧向可绕行判断：横向净空大于机器人半宽 + 人体半径 + 0.25 m。
      const clearance = Math.abs(lateral) - (P.width / 2 + radius + .25);
      if (clearance > 0 && along > .4 && !candidate.crossing && d < S.warnDistance + .6) {
        avoidance = avoidance || (lateral > 0 ? -1 : 1);
      }
      // V2.9：人正好压在中线上（净空不足）时，算一算「要偏多少才过得去」，
      // 朝远离这个人的方向偏；横向最多偏 0.45 m（2 m 通道内仍留得下车身与安全间隙）。
      if (along > 1 && along < S.warnDistance + 1.2 && !candidate.crossing) {
        const required = P.width / 2 + radius + .20;       // 与人体中心的最小横向间距
        const shortfall = required - Math.abs(lateral);
        if (shortfall > .04) {
          const side = lateral >= 0 ? -1 : 1;              // 向远离该行人的一侧偏
          const need = side * Math.min(shortfall + .12, .45);
          if (Math.abs(need) > Math.abs(steerNeed)) steerNeed = need;
        }
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
    } else if (worst) {
      this.emergencyTime = Math.max(0, this.emergencyTime - step * 2);
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

    // V2.9：把「选空隙」的横向意图做成带保持时间的平滑量，避免左右来回摆。
    const canSteer = Math.abs(steerNeed) > .02 && speedFactor > .05 && this.state !== 'EMERGENCY_STOP';
    if (canSteer) { this.steer = steerNeed; this.steerHold = .9; }
    else {
      this.steerHold = Math.max(0, this.steerHold - step);
      if (this.steerHold === 0) this.steer += (0 - this.steer) * Math.min(1, step * 2.6);
    }
    const steerShift = this.steer / M;   // 米 → 地图单位

    this.setState(next, reason);
    return {
      state: this.state, speedFactor,
      lateralShift: Math.abs(steerShift) > .05 ? steerShift
        : avoidance ? avoidance * (this.state === 'AVOIDANCE' ? 1.15 : .22) : 0,
      ttc: this.last.ttc, distance: this.last.distance, reason, emergency,
      needsReplan: this.replanPending, collision, nearMiss,
      brakeDistance, targetSpeed: P.maxSpeed * speedFactor,
      safetyStatus: emergency ? '碰撞风险' : worst ? (speedFactor < .2 ? '已让行' : '预警减速') : '安全',
      label: ROBOT_STATE_CN[this.state],
    };
  }
}
