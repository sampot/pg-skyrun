// scene.js — Three.js 視覺層：山谷飛行（規則參數仍來自 rules.js；不碰 window.PG）
import { RULES } from "./rules.js";

const SEG_LEN = 14;
const SEG_COUNT = 14; // 覆蓋 196 單位，約等於地平線深度
const STAR_COUNT = 520;
const STAR_SPAN = 360;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由 id 產生穩定的偽隨機角度（避免同場岩柱形狀跳動） */
function hashAngle(id, salt) {
  let h = (id * 2654435761 + salt * 97) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h / 4294967296) * Math.PI * 2;
}

function buildTerrain(THREE, r, kind) {
  // kind: "mountain"（側山脊，朝走廊中心下降）| "ground"（地面山丘）
  const rng = mulberry32(kind === "mountain" ? 0x5eed : 0x1a2b);
  const width = kind === "mountain" ? r.halfW + 4 : r.halfW * 2 + 8;
  const geo = new THREE.PlaneGeometry(width, SEG_LEN, 22, 3);
  geo.rotateX(-Math.PI / 2); // 朝上
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); // 本地 -width/2..width/2
    const z = pos.getZ(i);
    if (kind === "mountain") {
      // 內緣（x=-width/2）低，朝外緣（x=+width/2）上升
      const u = (x + width / 2) / width; // 0=內 .. 1=外
      const fall = Math.pow(u, 1.4);
      const y =
        (rng() * 5 + 3.5) * fall +
        (rng() - 0.5) * 2.2 * fall +
        Math.sin(x * 0.3 + z * 0.4) * 0.7 * fall;
      pos.setY(i, y);
    } else {
      const y =
        (rng() - 0.5) * 1.4 +
        Math.sin(x * 0.18 + z * 0.45) * 0.5 +
        Math.sin(z * 0.9) * 0.3;
      pos.setY(i, y);
    }
  }
  geo.computeVertexNormals();
  return geo;
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
    starPos[i * 3] = (Math.random() * 2 - 1) * 220;
    starPos[i * 3 + 1] = Math.random() * 160; // 地平線以上
    starPos[i * 3 + 2] = -STAR_SPAN + Math.random() * STAR_SPAN;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xbfd0ff, size: 1.0, sizeAttenuation: true, transparent: true, opacity: 0.85 })
  );
  scene.add(stars);

  // ── 地平線霧光（太陽在遠方）────────────────────────────
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(9, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: 0.9 })
  );
  sunGlow.position.set(-26, 10, -r.horizonZ + 6);
  scene.add(sunGlow);
  const horizonHaze = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2a3a7a,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    })
  );
  horizonHaze.scale.set(120, 14, 120);
  horizonHaze.position.set(0, 4, -r.horizonZ + 2);
  scene.add(horizonHaze);

  // ── 山谷地形（分節循環：側山脊＋地面山丘）───────────────
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x232c4a, roughness: 0.95, metalness: 0.05, flatShading: true });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x1d2440, roughness: 0.97, metalness: 0.03, flatShading: true });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x7d95ff, emissive: 0x2c46b8, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.3 });
  const ridgeGeo = buildTerrain(THREE, r, "mountain");
  const groundGeo = buildTerrain(THREE, r, "ground");

  // 側山脊：高緣朝外，內緣（走廊側）貼著壁面低下去
  const ridgeGeoL = ridgeGeo.clone();
  ridgeGeoL.scale(-1, 1, 1); // 左側鏡射（高緣在外）
  const ridgeGeoR = ridgeGeo; // 右側原向（高緣在 +x 外緣）

  const segs = [];
  for (let i = 0; i < SEG_COUNT; i++) {
    const g = new THREE.Group();

    const ridgeL = new THREE.Mesh(ridgeGeoL, ridgeMat);
    ridgeL.position.set(-(r.halfW + 2) - (r.halfW + 4) / 2 + 1.5, -(r.halfH + 1), 0);
    g.add(ridgeL);
    const ridgeR = new THREE.Mesh(ridgeGeoR, ridgeMat);
    ridgeR.position.set(r.halfW + 2 + (r.halfW + 4) / 2 - 1.5, -(r.halfH + 1), 0);
    g.add(ridgeR);

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -(r.halfH + 1), 0);
    g.add(ground);

    // 內緣導引燈帶（山脊底緣＋地面邊緣）
    const stripL = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, SEG_LEN - 0.4), edgeMat);
    stripL.position.set(-(r.halfW - 0.5), -(r.halfH - 0.6), 0);
    g.add(stripL);
    const stripR = stripL.clone();
    stripR.position.x = r.halfW - 0.5;
    g.add(stripR);
    const stripC = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, SEG_LEN - 0.4), edgeMat);
    stripC.position.set(0, -(r.halfH - 0.55), 0);
    g.add(stripC);

    g.position.z = -r.horizonZ + (i / SEG_COUNT) * SEG_COUNT * SEG_LEN;
    segs.push(g);
    scene.add(g);
  }

  // ── 高空霧氣帶（視覺化頂部邊界，不影響規則）─────────────
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0x39456e,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    flatShading: true,
  });
  const clouds = [];
  {
    const crng = mulberry32(0xc10d);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + crng() * 2.2, 0), cloudMat);
      m.position.set((crng() * 2 - 1) * (r.halfW - 2), r.halfH + 1 + crng() * 2.5, -r.horizonZ + crng() * (SEG_COUNT * SEG_LEN));
      m.scale.set(1.6 + crng(), 0.8, 1.2 + crng());
      clouds.push(m);
      scene.add(m);
    }
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

    // 地形循環推進
    for (const g of segs) {
      g.position.z += move;
      if (g.position.z > r.removeZ + SEG_LEN / 2) g.position.z -= SEG_COUNT * SEG_LEN;
    }
    // 高雲循環（稍慢＝視差）
    for (const m of clouds) {
      m.position.z += move * 0.82;
      if (m.position.z > r.removeZ + 10) m.position.z -= SEG_COUNT * SEG_LEN;
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
