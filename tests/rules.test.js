import { describe, it, expect } from "vitest";
import {
  RULES,
  createRun,
  stepFlight,
  scoreForRun,
  mergeHigh,
  parseScore,
  makeRng,
  speedAt,
  fuelAfter,
  hitTest,
  spawnType,
  spawnPosition,
} from "../rules.js";

const idle = { mx: 0, my: 0, boost: false };
const DT = 1 / 60;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

describe("mergeHigh / parseScore", () => {
  it("keeps the larger value", () => {
    expect(mergeHigh(3, 10)).toBe(10);
    expect(mergeHigh(12, 10)).toBe(12);
  });

  it("parses non-negative numbers", () => {
    expect(parseScore("7")).toBe(7);
    expect(parseScore(null)).toBe(0);
    expect(parseScore("nope")).toBe(0);
    expect(parseScore("-3")).toBe(0);
  });
});

describe("makeRng", () => {
  it("is deterministic per seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const c = makeRng(43);
    const s1 = Array.from({ length: 8 }, () => a());
    const s2 = Array.from({ length: 8 }, () => b());
    expect(s1).toEqual(s2);
    for (const v of s1) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of s1) expect(v).toBeLessThan(1);
    expect(Array.from({ length: 8 }, () => c())).not.toEqual(s1);
  });
});

describe("speedAt", () => {
  it("ramps from base to max and clamps", () => {
    expect(speedAt(0)).toBe(RULES.baseSpeed);
    expect(speedAt(RULES.rampSec)).toBeCloseTo(RULES.maxSpeed, 5);
    expect(speedAt(RULES.rampSec * 3)).toBe(RULES.maxSpeed);
    expect(speedAt(RULES.rampSec / 2)).toBe(
      RULES.baseSpeed + (RULES.maxSpeed - RULES.baseSpeed) / 2
    );
  });
});

describe("fuelAfter", () => {
  it("drains linearly and clamps at 0", () => {
    expect(fuelAfter(100, 1, false)).toBeCloseTo(100 - RULES.drainPerSec, 5);
    expect(fuelAfter(0.1, 10, false)).toBe(0);
    expect(fuelAfter(50, 1, true)).toBeLessThan(fuelAfter(50, 1, false));
    expect(fuelAfter(10, 0, false)).toBe(10);
  });
});

describe("hitTest", () => {
  it("is a circle distance test", () => {
    expect(hitTest(0, 0, 1, 1, 0, 1)).toBe(true); // touching
    expect(hitTest(0, 0, 1, 2.1, 0, 1)).toBe(false);
    expect(hitTest(3, 4, 0.5, 0, 0, 0.5)).toBe(false);
    expect(hitTest(3, 4, 0.5, 0, 0, 5.6)).toBe(true);
  });
});

describe("spawn pattern", () => {
  it("gives 5 rings, 2 obstacles, 1 fuel per 8 slots", () => {
    const types = Array.from({ length: 8 }, (_, i) => spawnType(i));
    expect(types.filter((t) => t === "ring").length).toBe(5);
    expect(types.filter((t) => t === "obstacle").length).toBe(2);
    expect(types.filter((t) => t === "fuel").length).toBe(1);
  });

  it("keeps spawn positions inside the corridor with margin", () => {
    const rng = makeRng(9);
    for (let slot = 0; slot < 96; slot++) {
      const type = spawnType(slot);
      const { x, y } = spawnPosition(type, rng);
      expect(Math.abs(x)).toBeLessThanOrEqual(RULES.halfW - 2);
      expect(Math.abs(y)).toBeLessThanOrEqual(RULES.halfH - 2);
      if (type === "obstacle") {
        expect(Math.abs(x)).toBeLessThanOrEqual(RULES.halfW - 3);
        expect(Math.abs(y)).toBeLessThanOrEqual(RULES.halfH - 3);
      }
    }
  });
});

describe("scoreForRun", () => {
  it("awards finish + time bonus only on a win", () => {
    const run = { ringsGot: 5, hits: 1, timeSec: 30, won: true };
    expect(scoreForRun(run)).toBe(
      5 * RULES.ringScore +
        RULES.finishBonus +
        (RULES.parSec - 30) * RULES.timeBonusPerSec -
        RULES.hitPenalty
    );
    expect(scoreForRun({ ...run, won: false })).toBe(
      5 * RULES.ringScore - RULES.hitPenalty
    );
  });

  it("clamps at zero and drops time bonus past par", () => {
    expect(scoreForRun({ ringsGot: 0, hits: 10, timeSec: 5, won: false })).toBe(0);
    expect(scoreForRun({ ringsGot: 0, hits: 0, timeSec: RULES.parSec + 50, won: true })).toBe(
      RULES.finishBonus
    );
  });
});

describe("createRun", () => {
  it("starts fresh and centered", () => {
    const sim = createRun({ rng: makeRng(1) });
    expect(sim.fuel).toBe(RULES.startFuel);
    expect(sim.hull).toBe(RULES.hullMax);
    expect(sim.ringsGot).toBe(0);
    expect(sim.hits).toBe(0);
    expect(sim.t).toBe(0);
    expect(sim.over).toBeNull();
    expect(sim.plane.x).toBe(0);
    expect(sim.plane.y).toBe(0);
    expect(sim.objects).toEqual([]);
  });

  it("accepts seeded initial objects", () => {
    const sim = createRun({
      rng: makeRng(1),
      objects: [{ type: "ring", x: 1, y: 2, z: -3 }],
    });
    expect(sim.objects).toHaveLength(1);
    expect(sim.objects[0].dead).toBe(false);
  });
});

describe("stepFlight movement", () => {
  it("steers toward input and clamps inside the corridor", () => {
    const sim = createRun({ rng: makeRng(1) });
    for (let i = 0; i < 90; i++) stepFlight(sim, DT, { mx: 1, my: 0, boost: false });
    expect(sim.plane.x).toBeGreaterThan(5);
    expect(Math.abs(sim.plane.x)).toBeLessThanOrEqual(RULES.halfW - RULES.planeRadius + 1e-6);
  });

  it("moves objects toward the player at run speed", () => {
    const sim = createRun({
      rng: makeRng(2),
      objects: [{ type: "ring", x: 0, y: 0, z: -10 }],
    });
    stepFlight(sim, DT, idle);
    expect(sim.objects[0].z).toBeGreaterThan(-10);
    expect(sim.objects[0].z).toBeLessThanOrEqual(-10 + RULES.baseSpeed * DT + 0.01);
  });

  it("despawns objects that pass behind the camera", () => {
    const sim = createRun({
      rng: makeRng(3),
      objects: [{ type: "ring", x: 9, y: 9, z: RULES.removeZ - 1 }],
    });
    stepFlight(sim, DT * 10, idle);
    expect(sim.objects.find((o) => o.z >= RULES.removeZ - 1)).toBeUndefined();
  });

  it("spawns new objects as the run travels", () => {
    const sim = createRun({ rng: makeRng(4) });
    for (let i = 0; i < 60 * 5; i++) stepFlight(sim, DT, idle);
    expect(sim.objects.length).toBeGreaterThan(0);
    for (const o of sim.objects) {
      expect(o.z).toBeLessThan(RULES.removeZ);
      expect(o.z).toBeGreaterThanOrEqual(-RULES.horizonZ - 1e-6);
    }
  });
});

describe("stepFlight collisions", () => {
  it("collects rings the plane flies through", () => {
    const sim = createRun({
      rng: makeRng(5),
      fuel: 60,
      objects: [{ type: "ring", x: 0, y: 0, z: 1 }],
    });
    const ev = stepFlight(sim, DT, idle);
    expect(ev.collected).toBe(1);
    expect(sim.ringsGot).toBe(1);
    expect(sim.fuel).toBeCloseTo(
      Math.min(RULES.fuelMax, 60 + RULES.ringFuel - RULES.drainPerSec * DT),
      4
    );
    expect(sim.objects.filter((o) => !o.dead)).toEqual([]);
  });

  it("collects fuel cans and clamps at max", () => {
    const sim = createRun({
      rng: makeRng(6),
      fuel: 99,
      objects: [{ type: "fuel", x: 0, y: 0, z: 0 }],
    });
    const ev = stepFlight(sim, DT, idle);
    expect(ev.collected).toBe(1);
    expect(sim.fuel).toBe(100);
  });

  it("damages hull on obstacle hit with an invulnerability window", () => {
    const sim = createRun({
      rng: makeRng(7),
      objects: [{ type: "obstacle", x: 0, y: 0, z: 0 }],
    });
    const ev1 = stepFlight(sim, DT, idle);
    expect(ev1.hit).toBe(true);
    expect(sim.hull).toBe(RULES.hullMax - 1);
    // 無敵窗內：同一碰撞不再受損
    sim.lastHitT = sim.t;
    const ev2 = stepFlight(sim, DT, idle);
    expect(ev2.hit).toBe(false);
    expect(sim.hull).toBe(RULES.hullMax - 1);
    // 窗口過後：再次受損
    sim.lastHitT = sim.t - RULES.invulnSec - 0.01;
    const ev3 = stepFlight(sim, DT, idle);
    expect(ev3.hit).toBe(true);
    expect(sim.hull).toBe(RULES.hullMax - 2);
  });

  it("damages hull on wall contact and pushes the plane back inside", () => {
    const sim = createRun({ rng: makeRng(8) });
    sim.plane.x = RULES.halfW - RULES.planeRadius + 1;
    const ev = stepFlight(sim, DT, idle);
    expect(ev.hit).toBe(true);
    expect(sim.hull).toBe(RULES.hullMax - 1);
    expect(Math.abs(sim.plane.x)).toBeLessThanOrEqual(RULES.halfW - RULES.planeRadius + 1e-6);
  });
});

describe("stepFlight end states", () => {
  it("crashes when hull reaches zero", () => {
    const sim = createRun({
      rng: makeRng(9),
      objects: [{ type: "obstacle", x: 0, y: 0, z: 0 }],
    });
    sim.hull = 1;
    const ev = stepFlight(sim, DT, idle);
    expect(ev.lost).toBe(true);
    expect(sim.over).toMatchObject({ won: false, reason: "crash" });
    expect(sim.hull).toBe(0);
  });

  it("fails when fuel runs out", () => {
    const sim = createRun({ rng: makeRng(10), fuel: 0.2 });
    const ev = stepFlight(sim, 1, idle);
    expect(ev.lost).toBe(true);
    expect(sim.over).toMatchObject({ won: false, reason: "fuel" });
    expect(sim.fuel).toBe(0);
  });

  it("wins when the ring goal is reached", () => {
    const sim = createRun({
      rng: makeRng(11),
      objects: [{ type: "ring", x: 0, y: 0, z: 0 }],
    });
    sim.ringsGot = RULES.ringGoal - 1;
    const ev = stepFlight(sim, DT, idle);
    expect(ev.won).toBe(true);
    expect(sim.ringsGot).toBe(RULES.ringGoal);
    expect(sim.over).toMatchObject({ won: true, reason: "win" });
  });

  it("stores the final score on the run", () => {
    const sim = createRun({
      rng: makeRng(12),
      objects: [{ type: "ring", x: 0, y: 0, z: 0 }],
    });
    sim.ringsGot = RULES.ringGoal - 1;
    stepFlight(sim, DT, idle);
    expect(sim.over.score).toBe(scoreForRun(sim));
    expect(typeof sim.over.score).toBe("number");
  });

  it("freezes the simulation once over", () => {
    const sim = createRun({ rng: makeRng(13), fuel: 0.2 });
    stepFlight(sim, 1, idle);
    const t0 = sim.t;
    const fuel0 = sim.fuel;
    stepFlight(sim, 1, { mx: 1, my: 1, boost: true });
    expect(sim.t).toBe(t0);
    expect(sim.fuel).toBe(fuel0);
  });
});

describe("full run integration", () => {
  it("a simple autopilot always terminates with a consistent end state", () => {
    const sim = createRun({ rng: makeRng(777) });
    let guard = 0;
    while (!sim.over && guard++ < 60 * 300) {
      const candidates = sim.objects
        .filter(
          (o) =>
            !o.dead &&
            o.z < 0 &&
            (o.type === "ring" || (sim.fuel < 45 && o.type === "fuel"))
        )
        .sort((a, b) => b.z - a.z);
      const want = candidates[0];
      let mx = want ? clamp((want.x - sim.plane.x) * 0.3, -1, 1) : 0;
      const my = want ? clamp((want.y - sim.plane.y) * 0.3, -1, 1) : 0;
      const threat = sim.objects.find(
        (o) =>
          !o.dead &&
          o.type === "obstacle" &&
          o.z > -34 &&
          o.z < 8 &&
          Math.abs(o.x - sim.plane.x) < 5.5
      );
      if (threat) mx = threat.x > sim.plane.x ? -0.9 : 0.9;
      stepFlight(sim, DT, { mx, my, boost: false });
    }
    expect(sim.over).toBeTruthy();
    if (sim.over.won) {
      expect(sim.ringsGot).toBeGreaterThanOrEqual(RULES.ringGoal);
    } else if (sim.over.reason === "crash") {
      expect(sim.hull).toBe(0);
    } else if (sim.over.reason === "fuel") {
      expect(sim.fuel).toBe(0);
    }
  });
});
