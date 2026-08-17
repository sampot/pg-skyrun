// app.js — 啟動、輸入、遊戲循環、KV 分數、頁內 UI（無 alert/confirm/prompt）
import { createRun, stepFlight, mergeHigh, parseScore, RULES } from "./rules.js";
import { createScene } from "./scene.js";
import { waitForPg } from "./pg.js";

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"),
  hud: $("hud"),
  fuelBar: $("fuel-bar"),
  hull: $("hull"),
  rings: $("rings"),
  ringGoal: $("ring-goal"),
  speed: $("speed"),
  score: $("score"),
  pauseBtn: $("pause-btn"),
  touch: $("touch"),
  stickZone: $("stick-zone"),
  boostBtn: $("boost-btn"),
  menu: $("menu"),
  menuBest: $("menu-best"),
  startBtn: $("start-btn"),
  over: $("over"),
  overTitle: $("over-title"),
  overScore: $("over-score"),
  overBest: $("over-best"),
  overNew: $("over-new"),
  retryBtn: $("retry-btn"),
  paused: $("paused"),
  resumeBtn: $("resume-btn"),
  fatal: $("fatal"),
  fatalMsg: $("fatal-msg"),
  booting: $("booting"),
  toast: $("toast"),
};

const clamp01 = (v) => Math.max(-1, Math.min(1, v));

let scene = null;
let sim = null;
let state = "menu"; // menu | fly | paused | over
let high = 0;
let runStartHigh = 0;
let audio = null;
let toastTimer = 0;

const kb = { mx: 0, my: 0, boost: false };
const touch = { mx: 0, my: 0, boost: false };
const input = { mx: 0, my: 0, boost: false };

function refreshInput() {
  input.mx = clamp01(kb.mx + touch.mx);
  input.my = clamp01(kb.my + touch.my);
  input.boost = kb.boost || touch.boost;
}

function zeroInput() {
  kb.mx = kb.my = 0;
  kb.boost = false;
  touch.mx = touch.my = 0;
  touch.boost = false;
  refreshInput();
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function showFatal(msg) {
  els.fatalMsg.textContent = msg;
  els.fatal.hidden = false;
  els.menu.hidden = true;
}

// ── 音訊（WebAudio 合成；失敗不影響遊戲）────────────────
function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  function env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function blip(freq0, freq1, dur, type, peak) {
    try {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t0 + dur);
      env(g, t0, 0.012, peak, dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      /* 音訊失敗不中斷遊戲 */
    }
  }

  // 加速風聲（循環雜音＋低通）
  let boostSrc = null;
  let boostGain = null;
  try {
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    boostSrc = ctx.createBufferSource();
    boostSrc.buffer = buf;
    boostSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    boostSrc.connect(lp).connect(boostGain).connect(master);
    boostSrc.start();
  } catch {
    boostSrc = null;
  }

  return {
    ensure() {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    ring() {
      blip(660, 990, 0.16, "sine", 0.5);
    },
    hit() {
      blip(150, 55, 0.28, "sawtooth", 0.55);
      blip(90, 40, 0.3, "square", 0.3);
    },
    boost(on) {
      if (!boostGain) return;
      try {
        boostGain.gain.setTargetAtTime(on ? 0.16 : 0, ctx.currentTime, 0.08);
      } catch {
        /* noop */
      }
    },
    win() {
      blip(523, 523, 0.12, "triangle", 0.4);
      setTimeout(() => blip(659, 659, 0.12, "triangle", 0.4), 130);
      setTimeout(() => blip(784, 784, 0.22, "triangle", 0.45), 260);
    },
    lose() {
      blip(220, 110, 0.5, "triangle", 0.45);
    },
  };
}

function sfx(fn) {
  if (audio) {
    try {
      audio[fn]();
    } catch {
      /* noop */
    }
  }
}

// ── 輸入：鍵盤 ───────────────────────────────────────
const KEY_DIRS = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

function rebuildKb() {
  const active = (d) =>
    (d === "up" && (keys.has("up") ? 1 : 0)) - (d === "down" && (keys.has("down") ? 1 : 0));
  kb.my = active("up");
  kb.mx = active("right") - active("left");
}

const keys = new Set();

function onKeyDown(e) {
  if (e.repeat) return;
  if (KEY_DIRS[e.code]) {
    e.preventDefault();
    keys.add(KEY_DIRS[e.code]);
    rebuildKb();
    refreshInput();
  } else if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
    e.preventDefault();
    kb.boost = true;
    refreshInput();
  } else if (e.code === "KeyP" || e.code === "Escape") {
    togglePause();
  }
}

function onKeyUp(e) {
  if (KEY_DIRS[e.code]) {
    keys.delete(KEY_DIRS[e.code]);
    rebuildKb();
    refreshInput();
  } else if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
    kb.boost = false;
    refreshInput();
  }
}

// ── 輸入：觸控（Pointer Events；放開必歸零）────────────
function setupTouch(nipplejs) {
  const manager = nipplejs.create({
    zone: els.stickZone,
    mode: "dynamic",
    size: 96,
    restOpacity: 0.4,
  });
  manager.on("move", (_evt, data) => {
    let f = data.force > 1 ? 1 : data.force;
    if (f < 0.15) f = 0; // 死區
    const a = data.angle.radian;
    touch.mx = Math.cos(a) * f;
    touch.my = -Math.sin(a) * f;
    refreshInput();
  });
  manager.on("end", () => {
    touch.mx = 0;
    touch.my = 0;
    refreshInput();
  });

  const b = els.boostBtn;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (audio) audio.ensure();
    touch.boost = true;
    b.classList.add("hold");
    refreshInput();
  });
  const release = () => {
    touch.boost = false;
    b.classList.remove("hold");
    refreshInput();
  };
  b.addEventListener("pointerup", release);
  b.addEventListener("pointercancel", release);
  b.addEventListener("lostpointercapture", release);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

function enableTouchLayer() {
  els.touch.classList.add("on");
  els.touch.setAttribute("aria-hidden", "false");
}

if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
  enableTouchLayer();
}
document.addEventListener("touchstart", enableTouchLayer, { once: true, passive: true });

// ── 暫停／恢復 ───────────────────────────────────────
function togglePause() {
  if (state === "fly") {
    state = "paused";
    els.paused.hidden = false;
    zeroInput();
  } else if (state === "paused") {
    resume();
  }
}

function resume() {
  if (state !== "paused") return;
  state = "fly";
  els.paused.hidden = true;
  lastFrame = performance.now();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "fly") togglePause();
  zeroInput();
});
window.addEventListener("blur", () => {
  if (state === "fly") togglePause();
  zeroInput();
});

// ── HUD ─────────────────────────────────────────────
function updateHud() {
  if (!sim) return;
  const frac = Math.max(0, Math.min(1, sim.fuel / RULES.fuelMax));
  els.fuelBar.style.width = `${(frac * 100).toFixed(1)}%`;
  els.fuelBar.classList.toggle("low", frac < 0.28);
  const pips = els.hull.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].classList.toggle("off", i >= sim.hull);
  }
  els.rings.textContent = String(sim.ringsGot);
  els.speed.textContent = String(Math.round(sim.speed));
  els.score.textContent = String(sim.ringsGot * RULES.ringScore);
}

// ── 分數（PG.kv 為權威；無 PG 時僅記憶體）───────────────
async function loadHigh() {
  if (!window.PG) return 0;
  try {
    return parseScore(await window.PG.kv.get("highscore"));
  } catch {
    toast("讀取最高分失敗，仍可遊玩");
    return 0;
  }
}

async function saveHigh(value) {
  if (!window.PG) return;
  try {
    await window.PG.kv.put("highscore", String(value));
  } catch {
    toast("最高分同步失敗（不影響遊玩）");
  }
}

// ── 局流程 ───────────────────────────────────────────
function startRun() {
  sim = createRun({ rng: Math.random });
  state = "fly";
  if (scene) scene.clearObjects();
  runStartHigh = high;
  els.menu.hidden = true;
  els.over.hidden = true;
  els.paused.hidden = true;
  els.hud.hidden = false;
  zeroInput();
  lastFrame = performance.now();
  if (audio) audio.ensure();
  updateHud();
}

function finishRun(over) {
  state = "over";
  const score = over.score;
  const isNew = score > runStartHigh && score > 0;
  const nextHigh = mergeHigh(score, high);
  if (nextHigh !== high) {
    high = nextHigh;
    void saveHigh(score);
  }
  if (audio) audio.boost(false);
  if (over.won) sfx("win");
  else sfx("lose");
  els.overTitle.textContent =
    over.reason === "win"
      ? "任務完成！"
      : over.reason === "crash"
        ? "機體損毀…"
        : "燃料耗盡…";
  els.overScore.textContent = String(score);
  els.overBest.textContent = `最高分 ${high}`;
  els.overNew.hidden = !isNew;
  els.over.hidden = false;
  els.menuBest.textContent = `最高分 ${high}`;
  zeroInput();
}

// ── 主循環 ───────────────────────────────────────────
let lastFrame = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.25) dt = 0.25;

  if (state === "fly" && sim) {
    const ev = stepFlight(sim, dt, input);
    if (ev.collected > 0) sfx("ring");
    if (ev.hit) sfx("hit");
    if (audio) audio.boost(!!input.boost && sim.fuel > 0);
    updateHud();
    if (ev.won || ev.lost) finishRun(sim.over);
  }

  if (scene) {
    scene.update(
      sim,
      dt,
      { mx: input.mx, my: input.my, boost: input.boost && state === "fly" },
      state === "fly"
    );
  }
}

// ── 啟動 ─────────────────────────────────────────────
async function boot() {
  els.ringGoal.textContent = String(RULES.ringGoal);

  // Do not snapshot !!window.PG at module load — host may still be mounting
  // sdk.js (especially go memory canvas).
  const PG = await waitForPg();
  if (!PG) {
    showFatal("偵測不到 window.PG——請經 Playgrounds 場殼或 go 開啟（直接開檔案無法載入 three）。");
    return;
  }

  try {
    await PG.ready;
  } catch (e) {
    showFatal(`PG.ready 失敗：${e && e.message ? e.message : "unknown"}`);
    return;
  }

  let THREE;
  let nipplejs;
  try {
    [THREE, nipplejs] = await Promise.all([
      PG.libs.load("three"),
      PG.libs.load("nipple"),
    ]);
  } catch (e) {
    const code = e && e.code ? `（${e.code}）` : "";
    showFatal(`載入函式庫失敗${code}，請稍後再試。`);
    return;
  }

  try {
    scene = createScene(THREE, els.stage);
  } catch (e) {
    showFatal(`建立 3D 場景失敗：${e && e.message ? e.message : "WebGL 不可用？"}`);
    return;
  }

  setupTouch(nipplejs);

  high = await loadHigh();
  els.menuBest.textContent = `最高分 ${high}`;
  els.booting.hidden = true;
  els.startBtn.disabled = false;

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", () => scene && scene.resize());
  window.addEventListener("orientationchange", () =>
    setTimeout(() => scene && scene.resize(), 250)
  );

  els.startBtn.addEventListener("click", startRun);
  els.retryBtn.addEventListener("click", startRun);
  els.pauseBtn.addEventListener("click", togglePause);
  els.resumeBtn.addEventListener("click", resume);

  sim = createRun({ rng: Math.random }); // 選單背景慢速飛行
  requestAnimationFrame(frame);
}

void boot();
