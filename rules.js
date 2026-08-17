// rules.js — Sky Run 飛行規則（純函式、無 DOM；供 app.js 與測試共用）

export const RULES = {
  // 目標
  ringGoal: 12,
  // 走廊（半寬／半高）
  halfW: 14,
  halfH: 9,
  // 機體
  planeRadius: 1.6,
  hullMax: 3,
  invulnSec: 1.5,
  // 燃料
  startFuel: 100,
  fuelMax: 100,
  drainPerSec: 3.2,
  boostDrainMult: 2.4,
  ringFuel: 12,
  fuelCanFuel: 30,
  // 速度
  baseSpeed: 52,
  maxSpeed: 88,
  rampSec: 70,
  boostSpeedMult: 1.55,
  // 操控
  maxStrafeX: 30,
  maxStrafeY: 22,
  steerLerp: 7,
  // 生成
  spawnSpacing: 42,
  firstSpawnAt: 90,
  horizonZ: 170,
  removeZ: 26,
  collideZ: 4,
  // 物件半徑
  ringRadius: 3.4,
  obstacleRadius: 2.4,
  fuelRadius: 2.6,
  // 分數
  ringScore: 100,
  finishBonus: 500,
  hitPenalty: 50,
  timeBonusPerSec: 8,
  parSec: 80,
  maxDt: 0.25,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** @param {number} current @param {number} high */
export function mergeHigh(current, high) {
  const c = Number(current);
  const h = Number(high);
  if (!Number.isFinite(c) || c < 0) return h;
  if (!Number.isFinite(h) || h < 0) return c;
  return c > h ? c : h;
}

/** @param {string | null | undefined} raw */
export function parseScore(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** mulberry32 — 可重現 RNG（供測試與可选重播） */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 基礎前飛速度（隨時間提升並收斂） */
export function speedAt(t, r = RULES) {
  const k = clamp(t / r.rampSec, 0, 1);
  return r.baseSpeed + (r.maxSpeed - r.baseSpeed) * k;
}

/** 燃料消耗（boost 加倍耗損），收斂於 [0, fuelMax] */
export function fuelAfter(fuel, dt, boosting, r = RULES) {
  const drain = r.drainPerSec * (boosting ? r.boostDrainMult : 1);
  return clamp(fuel - dt * drain, 0, r.fuelMax);
}

/** 圓對圓碰撞 */
export function hitTest(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

const TYPE_CYCLE = ["ring", "obstacle", "ring", "fuel", "ring", "obstacle", "ring", "ring"];

/** 依槽位決定類型（每 8 槽：5 環、2 岩、1 燃料） */
export function spawnType(slot) {
  return TYPE_CYCLE[((slot % 8) + 8) % 8];
}

/** 生成位置（rng 注入；皆在走廊內並留邊界） */
export function spawnPosition(type, rng, r = RULES) {
  const span = (s) => (rng() * 2 - 1) * s;
  if (type === "ring") return { x: span(8), y: span(5) };
  if (type === "fuel") return { x: span(7), y: span(4) };
  return { x: span(r.halfW - 4), y: span(r.halfH - 3) }; // obstacle
}

/** 最終分數（胜利才有完成獎＋時間獎；扣撞擊罰分；下限 0） */
export function scoreForRun(run, r = RULES) {
  const { ringsGot, hits, timeSec, won } = run;
  let s = (ringsGot || 0) * r.ringScore;
  if (won) {
    s += r.finishBonus + Math.max(0, (r.parSec - (timeSec || 0)) * r.timeBonusPerSec);
  }
  s -= (hits || 0) * r.hitPenalty;
  return Math.max(0, Math.round(s));
}

let NEXT_ID = 1;

/**
 * 建立一局。
 * @param {{rng?: () => number, fuel?: number, objects?: Array<{type:string,x:number,y:number,z:number}>}} [opts]
 */
export function createRun(opts = {}) {
  const r = RULES;
  return {
    t: 0,
    fuel: opts.fuel ?? r.startFuel,
    hull: r.hullMax,
    ringsGot: 0,
    hits: 0,
    speed: r.baseSpeed,
    traveled: 0,
    lastHitT: -Infinity,
    nextSpawnDist: r.firstSpawnAt,
    slot: 0,
    rng: opts.rng || Math.random,
    over: null, // { won, reason: "win"|"crash"|"fuel", score }
    plane: { x: 0, y: 0, vx: 0, vy: 0 },
    objects: (opts.objects || []).map((o) => ({ ...o, id: o.id ?? NEXT_ID++, dead: false })),
  };
}

function applyHit(sim, r, ev) {
  if (sim.over) return;
  if (sim.t - sim.lastHitT < r.invulnSec) return;
  sim.lastHitT = sim.t;
  sim.hull -= 1;
  sim.hits += 1;
  ev.hit = true;
}

/**
 * 推進一步（純規則；不碰 DOM／THREE）。
 * @param {ReturnType<typeof createRun>} sim
 * @param {number} dtRaw 秒
 * @param {{mx:number, my:number, boost:boolean}} input
 * @returns {{collected:number, hit:boolean, won:boolean, lost:boolean}}
 */
export function stepFlight(sim, dtRaw, input, r = RULES) {
  const ev = { collected: 0, hit: false, won: false, lost: false };
  if (sim.over) return ev;
  const dt = Math.min(Math.max(dtRaw, 0), r.maxDt);
  sim.t += dt;

  const boosting = !!input.boost && sim.fuel > 0;
  sim.speed = speedAt(sim.t, r) * (boosting ? r.boostSpeedMult : 1);
  sim.fuel = fuelAfter(sim.fuel, dt, boosting, r);

  // 操控（平滑趨近目標橫移速度）
  const p = sim.plane;
  const k = Math.min(1, r.steerLerp * dt);
  p.vx += (input.mx * r.maxStrafeX - p.vx) * k;
  p.vy += (input.my * r.maxStrafeY - p.vy) * k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // 世界向玩家推進
  const move = sim.speed * dt;
  sim.traveled += move;
  for (const o of sim.objects) o.z += move;

  // 依里程在地平線外生成新物件
  while (sim.traveled >= sim.nextSpawnDist) {
    const type = spawnType(sim.slot);
    const { x, y } = spawnPosition(type, sim.rng, r);
    sim.objects.push({
      id: NEXT_ID++,
      type,
      x,
      y,
      z: -r.horizonZ + (sim.nextSpawnDist - sim.traveled),
      dead: false,
    });
    sim.slot += 1;
    sim.nextSpawnDist += r.spawnSpacing;
  }

  // 碰撞（僅在穿越窗口內判定一次）
  for (const o of sim.objects) {
    if (o.dead || Math.abs(o.z) > r.collideZ) continue;
    if (o.type === "ring") {
      if (hitTest(p.x, p.y, 0, o.x, o.y, r.ringRadius)) {
        o.dead = true;
        sim.ringsGot += 1;
        sim.fuel = clamp(sim.fuel + r.ringFuel, 0, r.fuelMax);
        ev.collected += 1;
      }
    } else if (o.type === "fuel") {
      if (hitTest(p.x, p.y, r.planeRadius, o.x, o.y, r.fuelRadius)) {
        o.dead = true;
        sim.fuel = clamp(sim.fuel + r.fuelCanFuel, 0, r.fuelMax);
        ev.collected += 1;
      }
    } else if (o.type === "obstacle") {
      if (hitTest(p.x, p.y, r.planeRadius, o.x, o.y, r.obstacleRadius)) {
        applyHit(sim, r, ev);
      }
    }
  }

  // 撞牆
  const limX = r.halfW - r.planeRadius;
  const limY = r.halfH - r.planeRadius;
  if (Math.abs(p.x) > limX || Math.abs(p.y) > limY) {
    p.x = clamp(p.x, -limX, limX);
    p.y = clamp(p.y, -limY, limY);
    applyHit(sim, r, ev);
  }

  // 終局
  if (!sim.over) {
    if (sim.hull <= 0) {
      sim.over = { won: false, reason: "crash", score: scoreForRun(sim, r) };
      ev.lost = true;
    } else if (sim.fuel <= 0) {
      sim.over = { won: false, reason: "fuel", score: scoreForRun(sim, r) };
      ev.lost = true;
    } else if (sim.ringsGot >= r.ringGoal) {
      sim.over = { won: true, reason: "win", score: scoreForRun(sim, r) };
      ev.won = true;
    }
  }

  // 清掉已收集／已越過鏡頭的物件
  sim.objects = sim.objects.filter((o) => !o.dead && o.z < r.removeZ);
  return ev;
}
