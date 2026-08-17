// scene.js — Three.js 視覺層。只依賴傳入的 THREE namespace；不碰 window.PG／DOM 邏輯。
import { RULES } from "./rules.js";

const SEG_LEN = 14;
const SEG_COUNT = 14; // 覆蓋 196 單位，約等於地平線深度
const STAR_COUNT = 420;
const STAR_SPAN = 360;

/** 由 id 產生穩定的偽隨機角度（避免 Math.random 讓同場岩柱形狀跳動） */
function hashAngle(id, salt) {
  let h = (id * 2654435761 + salt * 97) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h / 4294967296) * Math.PI * 2;
}

export function createScene(THREE, hostEl) {
  const r = RULES;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  hostEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f24);
  scene.fog = new THREE.Fog(0x0a0f24, 30, r.horizonZ);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
  camera.position.set(0, 3.1, 9.5);

  scene.add(new THREE.AmbientLight(0x9fb0ff, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(-6, 12, 6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x5f7cff, 0.55);
  rim.position.set(6, -8, -4);
  scene.add(rim);

  // ── 星空 ────────────────────────────────────────────────
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * 180;
    starPos[i * 3 + 1] = (Math.random() * 2 - 1) * 140;
    starPos[i * 3 + 2] = -STAR_SPAN + Math.random() * STAR_SPAN;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xbfd0ff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.85 })
  );
  scene.add(stars);

  // ── 走廊（分節循環）─────────────────────────────────────
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x232c4a, roughness: 0.92, metalness: 0.12, flatShading: true });
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x7d95ff, emissive: 0x2c46b8, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3 });
  const segs = [];
  for (let i = 0; i < SEG_COUNT; i++) {
    const g = new THREE.Group();
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(4, 26, SEG_LEN), wallMat);
    wallL.position.set(-(r.halfW + 2), 0, 0);
    g.add(wallL);
    const wallR = wallL.clone();
    wallR.position.x = r.halfW + 2;
    g.add(wallR);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.halfW * 2 + 8, 2, SEG_LEN), wallMat);
    floor.position.y = -(r.halfH + 1);
    g.add(floor);
    const ceil = floor.clone();
    ceil.position.y = r.halfH + 1;
    g.add(ceil);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, SEG_LEN - 0.4), stripMat);
    strip.position.set(-(r.halfW - 0.55), r.halfH - 0.55, 0);
    g.add(strip);
    const strip2 = strip.clone();
    strip2.position.x = r.halfW - 0.55;
    g.add(strip2);
    const strip3 = strip.clone();
    strip3.position.set(0, -(r.halfH - 0.55), 0);
    g.add(strip3);
    g.position.z = -r.horizonZ + (i / SEG_COUNT) * SEG_COUNT * SEG_LEN;
    segs.push(g);
    scene.add(g);
  }

  // ── 自機 ────────────────────────────────────────────────
  const plane = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ff, metalness: 0.6, roughness: 0.32 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff5d3a, emissive: 0x8a2410, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.4 });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 12), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.5;
  plane.add(nose);
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.72, 2.3), bodyMat);
  plane.add(fuselage);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.16, 0.95), accentMat);
  wing.position.z = 0.15;
  plane.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.5), accentMat);
  tail.position.set(0, 0.5, 1.2);
  plane.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.72), accentMat);
  fin.position.set(0, 0.62, 1.2);
  plane.add(fin);
  const engineGlow = new THREE.PointLight(0x66aaff, 2.4, 14);
  engineGlow.position.set(0, 0, -1.9);
  plane.add(engineGlow);
  scene.add(plane);

  // ── 場上物件 ────────────────────────────────────────────
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffc24a, emissive: 0x9a5b00, emissiveIntensity: 1.0, metalness: 0.6, roughness: 0.35 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a3b30, emissive: 0x2a0f0a, emissiveIntensity: 0.5, roughness: 0.85, metalness: 0.1, flatShading: true });
  const fuelMat = new THREE.MeshStandardMaterial({ color: 0x37d67a, emissive: 0x0f6b34, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
  const objectMeshes = new Map(); // id → { group, spin }

  function addObject(o) {
    if (objectMeshes.has(o.id)) return;
    let group;
    if (o.type === "ring") {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r.ringRadius, 0.34, 12, 36), ringMat);
      group = new THREE.Group();
      group.add(torus);
    } else if (o.type === "fuel") {
      group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 1.3), fuelMat);
      group.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bodyMat);
      cap.position.y = 1.2;
      group.add(cap);
    } else {
      group = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r.obstacleRadius, 0), rockMat);
      rock.rotation.set(hashAngle(o.id, 1), hashAngle(o.id, 2), hashAngle(o.id, 3));
      group.add(rock);
    }
    group.position.set(o.x, o.y, o.z);
    scene.add(group);
    objectMeshes.set(o.id, { group, spin: o.type === "ring" ? 1.4 : o.type === "fuel" ? 1.8 : 0.25 });
  }

  function removeObject(id) {
    const entry = objectMeshes.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    objectMeshes.delete(id);
  }

  function clearObjects() {
    for (const id of [...objectMeshes.keys()]) removeObject(id);
  }

  // ── 主循環 ──────────────────────────────────────────────
  const camPos = { x: 0, y: 3.1, z: 9.5 };

  function resize() {
    const w = hostEl.clientWidth || 1;
    const h = hostEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function update(sim, dt, input, active) {
    const speed = active && sim ? sim.speed : 24;
    const move = speed * dt;

    // 走廊循環推進
    for (const g of segs) {
      g.position.z += move;
      if (g.position.z > r.removeZ + SEG_LEN / 2) g.position.z -= SEG_COUNT * SEG_LEN;
    }
    // 星空慢速流（平移一個完整跨度後無縫循環）
    stars.position.z += move * 0.25;
    if (stars.position.z >= STAR_SPAN) stars.position.z -= STAR_SPAN;

    // 自機姿態
    const p = sim ? sim.plane : { x: 0, y: 0 };
    const mx = active ? input.mx : 0;
    const my = active ? input.my : 0;
    const boost = active && input.boost;
    plane.position.x += (p.x - plane.position.x) * Math.min(1, dt * 10);
    plane.position.y += (p.y - plane.position.y) * Math.min(1, dt * 10);
    const targetRoll = -mx * 0.55;
    const targetPitch = -my * 0.4;
    const kr = Math.min(1, dt * 8);
    plane.rotation.z += (targetRoll - plane.rotation.z) * kr;
    plane.rotation.x += (targetPitch - plane.rotation.x) * kr;
    engineGlow.intensity = boost ? 4.2 : 2.4;

    // 場上物件
    if (sim) {
      for (const o of sim.objects) addObject(o);
      for (const [id, entry] of objectMeshes) {
        if (!sim.objects.some((o) => o.id === id)) removeObject(id);
      }
      for (const entry of objectMeshes.values()) {
        entry.group.rotation.y += entry.spin * dt;
      }
    }

    // 追隨鏡頭
    const cx = p.x * 0.55;
    const cy = p.y * 0.55 + 3.0;
    const kc = Math.min(1, dt * 6);
    camPos.x += (cx - camPos.x) * kc;
    camPos.y += (cy - camPos.y) * kc;
    camera.position.set(camPos.x, camPos.y, 9.5);
    camera.lookAt(p.x * 0.85, p.y * 0.85, -8);

    renderer.render(scene, camera);
  }

  return {
    renderer,
    scene,
    camera,
    update,
    addObject,
    removeObject,
    clearObjects,
    resize,
    dispose() {
      clearObjects();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
