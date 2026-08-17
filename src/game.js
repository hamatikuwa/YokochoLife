/* ============================================================
   よっぱらい横丁 - core game script (three.js r128, no deps)
   ============================================================ */
(function () {
'use strict';

// ---------------------------------------------------------------
// Renderer / Scene / Camera
// ---------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
const SKY_COLOR = 0x141026;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.FogExp2(SKY_COLOR, 0.045);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 200);

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);
onResize();

// lights
scene.add(new THREE.HemisphereLight(0x4a5aa8, 0x1a1420, 0.55));
const moon = new THREE.DirectionalLight(0x8fa0ff, 0.35);
moon.position.set(-10, 20, 5);
scene.add(moon);
scene.add(new THREE.AmbientLight(0x554466, 0.25));

// ---------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function makeCanvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

function signTexture(text, bg, fg) {
  return makeCanvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = fg;
    ctx.font = 'bold 34px "Hiragino Sans","Yu Gothic",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 40));
  });
}

// simple flat-color material cache
const matCache = new Map();
function flatMat(color, emissive) {
  const key = color + '_' + (emissive || 0);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 });
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------
// Collision registries
// ---------------------------------------------------------------
const boxColliders = [];   // {minX,maxX,minZ,maxZ}
const propColliders = [];  // dynamic knockable circle props: {mesh,x,z,r,vx,vz,tipped,tipT,baseY}

function addBoxCollider(cx, cz, halfW, halfD) {
  boxColliders.push({ minX: cx - halfW, maxX: cx + halfW, minZ: cz - halfD, maxZ: cz + halfD });
}

// ---------------------------------------------------------------
// World geometry: the narrow yokocho alley
// ---------------------------------------------------------------
const HALF_WIDTH = 2.25;
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1.4, 0, -11),
  new THREE.Vector3(-1.6, 0, -23),
  new THREE.Vector3(2.1, 0, -35),
  new THREE.Vector3(-1.1, 0, -47),
  new THREE.Vector3(1.6, 0, -58),
  new THREE.Vector3(0, 0, -66),
], false, 'catmullrom', 0.5);

const ALLEY_LEN = curve.getLength();

function pathFrame(u) {
  const p = curve.getPointAt(clamp(u, 0, 1));
  let tan = curve.getTangentAt(clamp(u, 0.001, 0.999));
  tan.y = 0; tan.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tan).normalize().negate();
  return { p, tan, right };
}

// ground strip + sidewalks (follow the curve so the road always fills view)
// built as a manual triangle strip (not THREE.ShapeGeometry) because the offset
// road boundary can self-intersect on tight bends, which breaks earcut triangulation.
(function buildGround() {
  const segs = 40;
  const roadHalf = HALF_WIDTH + 0.35;
  const positions = [];
  const uvs = [];
  for (let i = 0; i <= segs; i++) {
    const { p, right } = pathFrame(i / segs);
    const l = p.clone().addScaledVector(right, -roadHalf);
    const r = p.clone().addScaledVector(right, roadHalf);
    positions.push(l.x, 0, l.z, r.x, 0, r.z);
    uvs.push(l.x * 0.3, l.z * 0.3, r.x * 0.3, r.z * 0.3);
  }
  const index = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const asphaltTex = makeCanvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2b2b30'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: asphaltTex }));
  ground.position.y = 0;
  scene.add(ground);

  // curb lines
  const curbMat = flatMat(0x9a9aa0);
  for (let i = 0; i < segs; i++) {
    const f0 = pathFrame(i / segs), f1 = pathFrame((i + 1) / segs);
    [-1, 1].forEach(side => {
      const a = f0.p.clone().addScaledVector(f0.right, side * HALF_WIDTH);
      const b = f1.p.clone().addScaledVector(f1.right, side * HALF_WIDTH);
      const mid = a.clone().lerp(b, 0.5); mid.y = 0.06;
      const len = a.distanceTo(b) + 0.05;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, len), curbMat);
      box.position.copy(mid);
      box.lookAt(b.x, 0.06, b.z);
      scene.add(box);
    });
  }
})();

// building palette
const WALL_COLORS = [0xd8d0b8, 0xb7c6d6, 0xc9a8a0, 0xdbb84a, 0x8f8f96, 0xe4e0d0, 0x6d5a4a, 0xc2d8c4];
const SIGN_TEXTS = [
  ['スナック\nまり子', '#ff8fc2', '#2a0f1c'],
  ['bar\n55', '#f4e9d8', '#222'],
  ['ぼったくり\nBAR魔界', '#7a1c2b', '#ffe07a'],
  ['からおけ\n千鳥', '#22314a', '#ffd76a'],
  ['呑み処\nみよ', '#e8e2c8', '#333'],
  ['焼鳥\nげんこつ', '#3a2a1c', '#ffcf6a'],
  ['Snack\nひまわり', '#ffd23a', '#5a2d00'],
  ['スタンド\n酒場', '#293a2a', '#dfe8c8'],
];

function makeLantern(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), flatMat(color, color));
  body.scale.set(1, 1.3, 1);
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.08, 6), flatMat(0x1a1a1a));
  cap.position.y = 0.36; g.add(cap);
  const light = new THREE.PointLight(color, 0.9, 4.2, 2);
  light.position.set(0, 0, 0);
  g.add(light);
  return g;
}

function makeAC() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.28), flatMat(0xdedede));
  g.add(box);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), flatMat(0x888888));
  fan.position.set(0, 0, 0.15);
  g.add(fan);
  return g;
}

function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.28, 8), flatMat(0x8a5a3a));
  pot.position.y = 0.14; g.add(pot);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, rand(0.5, 0.9), 5), flatMat(0x3d6b3f));
    leaf.position.set(rand(-0.12, 0.12), 0.3 + rand(0.15, 0.35), rand(-0.12, 0.12));
    leaf.rotation.z = rand(-0.3, 0.3);
    g.add(leaf);
  }
  return g;
}

function makeBike() {
  const g = new THREE.Group();
  const frameMat = flatMat(pick([0xcc3333, 0x2255aa, 0x333333]));
  const wheelMat = flatMat(0x1a1a1a);
  [-0.45, 0.45].forEach(x => {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 6, 14), wheelMat);
    wheel.position.set(x, 0.32, 0);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
  });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), frameMat);
  bar.position.y = 0.55; bar.rotation.z = 0.15; g.add(bar);
  const seatPost = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), frameMat);
  seatPost.position.set(0.28, 0.6, 0); g.add(seatPost);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.22), flatMat(0x555555));
  basket.position.set(-0.5, 0.75, 0); g.add(basket);
  return g;
}

function makeTrashCan() {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.62, 10), flatMat(pick([0x707070, 0x4a6a4a])));
  can.position.y = 0.31; g.add(can);
  return g;
}

function addKnockableProp(mesh, x, z, r) {
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  propColliders.push({ mesh, x, z, r, baseX: x, baseZ: z, vx: 0, vz: 0, tipped: false, tipT: 0, angle: rand(0, Math.PI * 2) });
}

// ---------------------------------------------------------------
// Build the buildings along the path
// ---------------------------------------------------------------
const hotspots = []; // {x,z,r,label,type,data}
const npcs = [];
const streetLanterns = [];

(function buildShops() {
  const spacing = 3.6;
  const count = Math.floor(ALLEY_LEN / spacing);
  let signIdx = 0;

  for (let i = 1; i < count - 1; i++) {
    const u = i / count;
    const { p, tan, right } = pathFrame(u);

    [-1, 1].forEach(side => {
      const depth = rand(2.6, 4.2);
      const width = spacing * 0.94;
      const height = rand(6, 10.5);
      const wallColor = pick(WALL_COLORS);
      const facadeCenter = p.clone().addScaledVector(right, side * (HALF_WIDTH + width * 0 + depth / 2 + 0.02));
      const yaw = Math.atan2(tan.x, tan.z);

      const group = new THREE.Group();
      group.position.set(facadeCenter.x, 0, facadeCenter.z);
      group.rotation.y = yaw;

      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), flatMat(wallColor));
      wall.position.y = height / 2;
      group.add(wall);

      // door / entrance color panel facing the alley
      const doorTex = pick([0xff9fc0, 0x6a4a3a, 0x3a4a6a, 0x8a2a2a, 0xe8e0c0]);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.32, 1.9), flatMat(doorTex));
      door.position.set(0, 0.95, -side * (depth / 2 + 0.01));
      door.rotation.y = side > 0 ? Math.PI : 0;
      group.add(door);

      // sign
      const [txt, bg, fg] = SIGN_TEXTS[signIdx % SIGN_TEXTS.length]; signIdx++;
      const signMat = new THREE.MeshBasicMaterial({ map: signTexture(txt, bg, fg) });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), signMat);
      sign.position.set(width * 0.18, 2.5, -side * (depth / 2 + 0.02));
      sign.rotation.y = side > 0 ? Math.PI : 0;
      group.add(sign);

      // awning
      const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.12, 0.55), flatMat(pick([0x8a2a2a, 0x2a4a6a, 0x2a5a2a])));
      awning.position.set(0, 2.05, -side * (depth / 2 + 0.3));
      awning.rotation.x = -0.25 * side;
      group.add(awning);

      scene.add(group);

      addBoxCollider(facadeCenter.x, facadeCenter.z, width / 2, depth / 2);

      // ground clutter near this shop
      if (Math.random() < 0.6) {
        const ac = makeAC();
        const pos = p.clone().addScaledVector(right, side * (HALF_WIDTH - 0.35));
        ac.position.set(pos.x, 0.45, pos.z);
        ac.rotation.y = yaw + (side > 0 ? Math.PI : 0);
        scene.add(ac);
      }
      if (Math.random() < 0.5) {
        const plant = makePlant();
        const pos = p.clone().addScaledVector(right, side * (HALF_WIDTH - 0.15)).addScaledVector(tan, rand(-1, 1));
        plant.position.set(pos.x, 0, pos.z);
        scene.add(plant);
      }
      if (Math.random() < 0.22) {
        const pos = p.clone().addScaledVector(right, side * (HALF_WIDTH - 0.3)).addScaledVector(tan, rand(-1, 1));
        addKnockableProp(makeTrashCan(), pos.x, pos.z, 0.32);
      }
      if (Math.random() < 0.16) {
        const bike = makeBike();
        const pos = p.clone().addScaledVector(right, side * (HALF_WIDTH - 0.4)).addScaledVector(tan, rand(-1, 1));
        bike.rotation.y = yaw + rand(-0.4, 0.4);
        addKnockableProp(bike, pos.x, pos.z, 0.5);
      }
    });

    // hanging lanterns across the alley every couple of modules
    if (i % 2 === 0) {
      const colorSet = [0xff5a3a, 0xffd23a, 0x4ab0ff];
      for (let k = -1; k <= 1; k++) {
        const lp = p.clone().addScaledVector(right, k * HALF_WIDTH * 0.6);
        lp.y = 3.1 + Math.sin(i + k) * 0.15;
        const lant = makeLantern(colorSet[(i + k + 3) % 3]);
        lant.position.copy(lp);
        scene.add(lant);
        streetLanterns.push(lant);
      }
      // utility pole
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), flatMat(0x555560));
      pole.position.set(p.x + right.x * (HALF_WIDTH + 0.15), 3, p.z + right.z * (HALF_WIDTH + 0.15));
      scene.add(pole);
    }
  }

  // far-end backdrop (opens to "main street")
  const endFrame = pathFrame(1);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2.4, 8, 0.5), new THREE.MeshBasicMaterial({ color: 0x1c2440 }));
  backWall.position.set(endFrame.p.x, 4, endFrame.p.z - 1.5);
  scene.add(backWall);
  addBoxCollider(endFrame.p.x, endFrame.p.z - 1.5, HALF_WIDTH * 1.4, 0.4);

  const startFrame = pathFrame(0);
  const startWall = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2.4, 8, 0.5), flatMat(0x2a2230));
  startWall.position.set(startFrame.p.x, 4, startFrame.p.z + 7);
  scene.add(startWall);
  addBoxCollider(startFrame.p.x, startFrame.p.z + 7, HALF_WIDTH * 1.4, 0.4);
})();

// ---------------------------------------------------------------
// Low-poly character builder
// ---------------------------------------------------------------
function makeCharacter(skin) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), flatMat(skin.shirt));
  torso.position.y = 1.05; body.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), flatMat(skin.skin));
  head.position.y = 1.55; body.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), flatMat(skin.hair));
  hair.position.y = 1.68; body.add(hair);

  function limb(w, h, d, color, x, y) {
    const grp = new THREE.Group();
    grp.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(color));
    mesh.position.y = -h / 2;
    grp.add(mesh);
    body.add(grp);
    return grp;
  }
  const leftArm = limb(0.13, 0.5, 0.13, skin.shirt, -0.29, 1.35);
  const rightArm = limb(0.13, 0.5, 0.13, skin.shirt, 0.29, 1.35);
  const leftLeg = limb(0.16, 0.55, 0.16, skin.pants, -0.13, 0.74);
  const rightLeg = limb(0.16, 0.55, 0.16, skin.pants, 0.13, 0.74);

  const handAttach = new THREE.Group();
  handAttach.position.set(0, -0.5, 0.05);
  rightArm.add(handAttach);

  return { group: g, body, leftArm, rightArm, leftLeg, rightLeg, handAttach, head };
}

const CLUB_GEO = new THREE.CylinderGeometry(0.05, 0.06, 0.85, 6);
function makeClub() {
  const m = new THREE.Mesh(CLUB_GEO, flatMat(0x8a5a2a));
  m.rotation.x = Math.PI / 2.4;
  m.position.set(0, -0.15, 0.15);
  return m;
}

// ---------------------------------------------------------------
// Player
// ---------------------------------------------------------------
const player = {
  x: pathFrame(0).p.x, z: pathFrame(0).p.z - 1.6, y: 0, vy: 0,
  yaw: Math.PI, speed: 0, radius: 0.32,
  hasClub: false, clubMesh: null,
  attackCd: 0, attackSwing: 0,
};
const playerChar = makeCharacter({ shirt: 0xcf5a3a, pants: 0x2a2a3a, skin: 0xe8b98a, hair: 0x1a1a1a });
scene.add(playerChar.group);

let camYaw = Math.PI;
let camPitch = 0.32;
const camDist = 4.4, camHeight = 2.0;

function playerForward() {
  return new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
}

// ---------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------
function spawnNpc(x, z, kind) {
  const skinSets = {
    oldman: { shirt: 0x5a6a3a, pants: 0x3a3a3a, skin: 0xd8b090, hair: 0xcccccc },
    thug: { shirt: 0x222222, pants: 0x111111, skin: 0xe0a878, hair: 0x1a1a1a },
  };
  const ch = makeCharacter(skinSets[kind]);
  ch.group.position.set(x, 0, z);
  scene.add(ch.group);
  const npc = {
    kind, char: ch, x, z, baseX: x, baseZ: z, yaw: 0,
    hp: kind === 'thug' ? 3 : 99, hostile: false, fled: false,
    hitFlash: 0, swayT: rand(0, 10), attackCd: rand(1, 2),
  };
  npcs.push(npc);
  return npc;
}

// ---------------------------------------------------------------
// Hotspots: karaoke / bar / toilet / club pickup
// ---------------------------------------------------------------
const uKaraoke = 0.09;
const uBar = 0.48;
const uToilet = 0.74;

const karaokeFrame = pathFrame(uKaraoke);
const karaokePos = karaokeFrame.p.clone().addScaledVector(karaokeFrame.right, -(HALF_WIDTH + 0.9));
hotspots.push({ x: karaokePos.x, z: karaokePos.z, r: 1.6, type: 'karaoke', label: 'Aボタン: からおけスナックに入る', cooldown: 0 });
const oldman = spawnNpc(karaokePos.x + 0.6, karaokePos.z + 0.4, 'oldman');

const barFrame = pathFrame(uBar);
const barPos = barFrame.p.clone().addScaledVector(barFrame.right, (HALF_WIDTH + 0.9));
hotspots.push({ x: barPos.x, z: barPos.z, r: 1.7, type: 'bar', label: 'Aボタン: チンピラに声をかける', cooldown: 0 });
const thug1 = spawnNpc(barPos.x - 0.5, barPos.z + 0.5, 'thug');
const thug2 = spawnNpc(barPos.x + 0.5, barPos.z + 0.7, 'thug');
thug1.homeHotspot = thug2.homeHotspot = hotspots[hotspots.length - 1];

// club prop near the bar
const clubPickupPos = { x: barPos.x + 1.3, z: barPos.z - 0.6 };
const clubPropMesh = makeClub();
clubPropMesh.rotation.x = Math.PI / 2;
clubPropMesh.position.set(clubPickupPos.x, 0.06, clubPickupPos.z);
scene.add(clubPropMesh);
hotspots.push({ x: clubPickupPos.x, z: clubPickupPos.z, r: 1.0, type: 'club', label: 'Aボタン: 角材を拾う', cooldown: 0 });

// public toilet nook
const toiletFrame = pathFrame(uToilet);
const toiletPos = toiletFrame.p.clone().addScaledVector(toiletFrame.right, -(HALF_WIDTH + 0.9));
(function buildToilet() {
  const g = new THREE.Group();
  g.position.set(toiletPos.x, 0, toiletPos.z);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.1), flatMat(0x3a6a8a));
  box.position.y = 1.05; g.add(box);
  const doorTex = signTexture('公衆\nトイレ', '#e8f4ff', '#1a3a5a');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), new THREE.MeshBasicMaterial({ map: doorTex }));
  sign.position.set(0, 1.6, 0.56);
  g.add(sign);
  scene.add(g);
  addBoxCollider(toiletPos.x, toiletPos.z, 0.6, 0.6);
})();
hotspots.push({ x: toiletPos.x, z: toiletPos.z - 1.1, r: 1.3, type: 'toilet', label: 'Aボタン: トイレを借りる', cooldown: 0 });

// decorative staircase nook (visual reference to the source alley, non-walkable)
(function buildStairsDecor() {
  const f = pathFrame(0.62);
  const base = f.p.clone().addScaledVector(f.right, (HALF_WIDTH + 0.9));
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 0.55), flatMat(0x777777));
    step.position.set(base.x, i * 0.22 + 0.11, base.z - i * 0.5);
    scene.add(step);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 3.2), flatMat(0xaaaaaa));
  rail.position.set(base.x + 0.68, 1.1, base.z - 1.2);
  scene.add(rail);
  addBoxCollider(base.x, base.z - 1.2, 0.9, 1.8);
})();

// ---------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------
function resolveBoxCollisions(pos, radius) {
  for (let i = 0; i < boxColliders.length; i++) {
    const b = boxColliders[i];
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      let d = Math.sqrt(d2);
      let nx, nz;
      if (d < 1e-4) {
        const bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
        nx = pos.x - bcx; nz = pos.z - bcz;
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; d = 0.0001;
      } else { nx = dx / d; nz = dz / d; }
      const push = radius - d;
      pos.x += nx * push;
      pos.z += nz * push;
    }
  }
}

const WORLD_MARGIN = HALF_WIDTH + 3.5;
function clampToWorld(pos) {
  pos.x = clamp(pos.x, -WORLD_MARGIN, WORLD_MARGIN);
  pos.z = clamp(pos.z, -68, 3);
}

// ---------------------------------------------------------------
// Input: touch joystick + look pad + buttons + keyboard
// ---------------------------------------------------------------
const input = { moveX: 0, moveY: 0, action: false, jump: false };
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

const joyBase = document.getElementById('joyBase');
const joyKnob = document.getElementById('joyKnob');
let joyId = null, joyCenter = { x: 0, y: 0 };
const JOY_R = 46;

function joyStart(e) {
  if (joyId !== null) return;
  joyId = e.pointerId;
  const r = joyBase.getBoundingClientRect();
  joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  try { joyBase.setPointerCapture(joyId); } catch (err) {}
}
function joyMove(e) {
  if (e.pointerId !== joyId) return;
  let dx = e.clientX - joyCenter.x, dy = e.clientY - joyCenter.y;
  const len = Math.hypot(dx, dy);
  if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
  joyKnob.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px)`;
  input.moveX = dx / JOY_R; input.moveY = dy / JOY_R;
}
function joyEnd(e) {
  if (e.pointerId !== joyId) return;
  joyId = null; input.moveX = 0; input.moveY = 0;
  joyKnob.style.transform = 'translate(-50%,-50%)';
}
joyBase.addEventListener('pointerdown', joyStart);
joyBase.addEventListener('pointermove', joyMove);
joyBase.addEventListener('pointerup', joyEnd);
joyBase.addEventListener('pointercancel', joyEnd);

const lookPad = document.getElementById('lookPad');
let lookId = null, lastLook = { x: 0, y: 0 };
lookPad.addEventListener('pointerdown', e => {
  if (lookId !== null) return;
  lookId = e.pointerId; lastLook = { x: e.clientX, y: e.clientY };
  try { lookPad.setPointerCapture(lookId); } catch (err) {}
});
lookPad.addEventListener('pointermove', e => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lastLook.x, dy = e.clientY - lastLook.y;
  lastLook = { x: e.clientX, y: e.clientY };
  camYaw -= dx * 0.005;
  camPitch = clamp(camPitch - dy * 0.003, 0.05, 0.75);
});
lookPad.addEventListener('pointerup', e => { if (e.pointerId === lookId) lookId = null; });
lookPad.addEventListener('pointercancel', e => { if (e.pointerId === lookId) lookId = null; });

const actionBtn = document.getElementById('actionBtn');
actionBtn.addEventListener('pointerdown', e => { e.preventDefault(); doAction(); });
const jumpBtn = document.getElementById('jumpBtn');
jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); input.jump = true; });

addEventListener('keydown', e => { if (e.code === 'KeyE') doAction(); if (e.code === 'Space') input.jump = true; });

// ---------------------------------------------------------------
// Game state / stats
// ---------------------------------------------------------------
const state = {
  money: 1500, pee: 0, energy: 100,
  busy: false, // minigame/dialogue open
  brawl: null, // {hotspot, npcs}
};
const moneyEl = document.getElementById('moneyVal');
const peeGaugeEl = document.getElementById('peeGauge');
const energyGaugeEl = document.getElementById('energyGauge');
const promptBox = document.getElementById('promptBox');
const toastEl = document.getElementById('toast');
let toastTimer = 0;

function toast(msg, dur) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastTimer = dur || 2.2;
}
function addMoney(v) { state.money = Math.max(0, state.money + v); }

function updateHud() {
  moneyEl.textContent = state.money.toLocaleString();
  peeGaugeEl.style.width = clamp(state.pee, 0, 100) + '%';
  energyGaugeEl.style.width = clamp(state.energy, 0, 100) + '%';
}

// ---------------------------------------------------------------
// Hotspot proximity + action
// ---------------------------------------------------------------
let currentHotspot = null;

function findNearestHotspot() {
  let best = null, bestD = Infinity;
  for (const h of hotspots) {
    const d = Math.hypot(player.x - h.x, player.z - h.z);
    if (d < h.r && d < bestD) { best = h; bestD = d; }
  }
  return best;
}

function doAction() {
  if (state.brawl) { performAttack(); return; }
  if (state.busy) return;
  if (!currentHotspot) {
    // pee emergency release anywhere
    if (state.pee >= 100) doFieldRelief();
    return;
  }
  if (currentHotspot.cooldown > 0) { toast('少し時間をおいてからにしよう…'); return; }

  if (currentHotspot.type === 'karaoke') openKaraoke();
  else if (currentHotspot.type === 'bar') openBar();
  else if (currentHotspot.type === 'club') pickupClub();
  else if (currentHotspot.type === 'toilet') useToilet();
}

function pickupClub() {
  if (player.hasClub) { toast('もう角材を持っている'); return; }
  player.hasClub = true;
  player.clubMesh = makeClub();
  playerChar.handAttach.add(player.clubMesh);
  toast('角材を拾った。護身用にどうぞ');
}

function useToilet() {
  state.pee = 0;
  updateHud();
  toast('スッキリ…！生き返る〜');
}

function doFieldRelief() {
  state.pee = 0;
  updateHud();
  toast('我慢できず物陰でスッキリ…近所の評判が少し下がった気がする', 2.6);
  spawnPoofEffect(player.x, player.z);
}

function spawnPoofEffect(x, z) {
  const g = new THREE.Group();
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0x6b4a2a, transparent: true, opacity: 0.85 }));
  cloud.position.set(x, 0.2, z);
  g.add(cloud);
  scene.add(g);
  let t = 0;
  const anim = () => {
    t += 0.03;
    cloud.scale.setScalar(1 + t * 1.5);
    cloud.material.opacity = Math.max(0, 0.85 - t);
    cloud.position.y += 0.01;
    if (t < 1) requestAnimationFrame(anim); else scene.remove(g);
  };
  anim();
}

// ---------------------------------------------------------------
// Karaoke minigame
// ---------------------------------------------------------------
const karaokeUI = document.getElementById('karaokeUI');
const rhythmZone = document.getElementById('rhythmZone');
const rhythmMarker = document.getElementById('rhythmMarker');
const rhythmBtn = document.getElementById('rhythmBtn');
const karaokeLine = document.getElementById('karaokeLine');
const karaokeRoundEl = document.getElementById('karaokeRound');
const karaokeScoreEl = document.getElementById('karaokeScore');

const OLDMAN_LINES = [
  'じいさん「おーい、ねーちゃん、一曲入れてくれや〜」',
  'じいさん「あんたぁ、ええ声しとるなぁ、もう一丁！」',
  'じいさん「わしの若い頃はなぁ…（と説教が始まる）」',
];
let karaoke = { round: 0, score: 0, zoneCenter: 50, zoneW: 18, dir: 1, mpos: 0, speed: 60 };

function openKaraoke() {
  state.busy = true;
  karaoke = { round: 1, score: 0, zoneCenter: rand(20, 80), zoneW: 20, dir: 1, mpos: 0, speed: rand(55, 80) };
  layoutZone();
  karaokeLine.textContent = OLDMAN_LINES[0];
  karaokeRoundEl.textContent = `1 / 3 曲目`;
  karaokeScoreEl.textContent = `満足度: 0`;
  karaokeUI.classList.remove('hidden');
}
function layoutZone() {
  rhythmZone.style.left = (karaoke.zoneCenter - karaoke.zoneW / 2) + '%';
  rhythmZone.style.width = karaoke.zoneW + '%';
}
function updateKaraoke(dt) {
  karaoke.mpos += karaoke.dir * karaoke.speed * dt;
  if (karaoke.mpos > 100) { karaoke.mpos = 100; karaoke.dir = -1; }
  if (karaoke.mpos < 0) { karaoke.mpos = 0; karaoke.dir = 1; }
  rhythmMarker.style.left = karaoke.mpos + '%';
}
rhythmBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  const inZone = Math.abs(karaoke.mpos - karaoke.zoneCenter) <= karaoke.zoneW / 2;
  if (inZone) { karaoke.score += 1; toast('いいぞ〜！🎶', 0.9); }
  else toast('あちゃ〜、音外した…', 0.9);
  karaoke.round++;
  if (karaoke.round > 3) {
    finishKaraoke();
  } else {
    karaokeLine.textContent = OLDMAN_LINES[karaoke.round - 1];
    karaokeRoundEl.textContent = `${karaoke.round} / 3 曲目`;
    karaokeScoreEl.textContent = `満足度: ${karaoke.score}`;
    karaoke.zoneCenter = rand(15, 85);
    karaoke.zoneW = rand(14, 22);
    karaoke.speed = rand(55, 90);
    layoutZone();
  }
});
function finishKaraoke() {
  karaokeUI.classList.add('hidden');
  state.busy = false;
  const gain = 300 + karaoke.score * 500 + Math.round(rand(-50, 50));
  addMoney(gain);
  updateHud();
  const hs = hotspots.find(h => h.type === 'karaoke');
  hs.cooldown = 12;
  showResult(karaoke.score >= 2
    ? `じいさん上機嫌で会計！ +${gain}円`
    : `じいさん「まぁ今日はこんなもんか」 +${gain}円`);
}

// ---------------------------------------------------------------
// Bar negotiation + brawl
// ---------------------------------------------------------------
const barUI = document.getElementById('barUI');
document.querySelectorAll('.mgChoiceBtn').forEach(btn => {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    const greed = parseInt(btn.dataset.greed, 10);
    resolveBarChoice(greed);
  });
});
function openBar() {
  state.busy = true;
  barUI.classList.remove('hidden');
}
function resolveBarChoice(greed) {
  barUI.classList.add('hidden');
  state.busy = false;
  const base = 400;
  const mult = [1, 2.2, 4.2][greed - 1];
  const angerChance = [0, 0.28, 0.6][greed - 1];
  const gain = Math.round(base * mult + rand(-40, 40));
  const hs = hotspots.find(h => h.type === 'bar');
  if (Math.random() < angerChance) {
    startBrawl(hs);
    toast('チンピラ「ふざけんな！表出ろ！！」', 2.4);
  } else {
    addMoney(gain);
    updateHud();
    hs.cooldown = 14;
    showResult(`チンピラは気づかず会計。 +${gain}円`);
  }
}
function startBrawl(hs) {
  state.brawl = { hs, list: [thug1, thug2].filter(n => !n.fled) };
  for (const n of state.brawl.list) { n.hostile = true; n.hp = 3; n.fled = false; }
}
function performAttack() {
  if (player.attackCd > 0) return;
  player.attackCd = 0.45;
  player.attackSwing = 1;
  const fwd = playerForward();
  const reach = player.hasClub ? 1.9 : 1.3;
  const dmg = player.hasClub ? 2 : 1;
  for (const n of state.brawl.list) {
    if (n.fled) continue;
    const dx = n.x - player.x, dz = n.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist > reach) continue;
    const dot = (dx * fwd.x + dz * fwd.z) / (dist || 1);
    if (dot < 0.35) continue;
    n.hp -= dmg;
    n.hitFlash = 0.25;
    const nx = dx / (dist || 1), nz = dz / (dist || 1);
    n.vx = (n.vx || 0) + nx * 4.5;
    n.vz = (n.vz || 0) + nz * 4.5;
    if (n.hp <= 0) {
      n.hostile = false; n.fled = true;
      spawnCoin(n.x, n.z);
      toast('チンピラを叩きのめした！');
    }
  }
  const remaining = state.brawl.list.filter(n => !n.fled);
  if (remaining.length === 0) {
    const hs = state.brawl.hs;
    hs.cooldown = 18;
    addMoney(250);
    updateHud();
    toast('チンピラを追い払った！ 財布から +250円', 2.4);
    state.brawl = null;
  }
}

const coins = [];
function spawnCoin(x, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 10), flatMat(0xffd23a, 0x553300));
  mesh.position.set(x, 0.3, z);
  mesh.rotation.x = Math.PI / 2;
  scene.add(mesh);
  coins.push({ mesh, x, z, value: 150 });
}

// ---------------------------------------------------------------
// Result popup
// ---------------------------------------------------------------
const resultUI = document.getElementById('resultUI');
const resultText = document.getElementById('resultText');
document.getElementById('resultCloseBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  resultUI.classList.add('hidden');
});
function showResult(text) {
  resultText.textContent = text;
  resultUI.classList.remove('hidden');
}

// ---------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------
const clock = new THREE.Clock();
let walkT = 0;

function updatePlayer(dt) {
  let mx = input.moveX, my = input.moveY;
  if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) my += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }

  const moving = len > 0.08 && !state.busy;
  const fwd = playerForward();
  const rightV = new THREE.Vector3(fwd.z, 0, -fwd.x);
  let dirX = 0, dirZ = 0;
  if (moving) {
    dirX = rightV.x * mx - fwd.x * my;
    dirZ = rightV.z * mx - fwd.z * my;
    const dl = Math.hypot(dirX, dirZ) || 1;
    dirX /= dl; dirZ /= dl;
    player.yaw = Math.atan2(dirX, dirZ);
  }

  const speedMult = state.energy <= 0 ? 0.55 : 1;
  const targetSpeed = moving ? 3.1 * speedMult : 0;
  player.speed = lerp(player.speed, targetSpeed, clamp(dt * 8, 0, 1));

  const pos = { x: player.x, z: player.z };
  pos.x += dirX * player.speed * dt;
  pos.z += dirZ * player.speed * dt;
  resolveBoxCollisions(pos, player.radius);
  for (const pr of propColliders) {
    if (pr.tipped) continue;
    const dx = pos.x - pr.x, dz = pos.z - pr.z;
    const d = Math.hypot(dx, dz);
    const minD = player.radius + pr.r;
    if (d < minD && d > 1e-4) {
      const push = minD - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
      if (player.speed > 1.5) { pr.vx += (dx / d) * 1.6; pr.vz += (dz / d) * 1.6; pr.tipped = true; }
    }
  }
  clampToWorld(pos);
  player.x = pos.x; player.z = pos.z;

  // jump / gravity (flat ground)
  if (input.jump && player.y <= 0.001) { player.vy = 4.6; }
  input.jump = false;
  player.vy -= 11 * dt;
  player.y += player.vy * dt;
  if (player.y < 0) { player.y = 0; player.vy = 0; }

  // sync visual
  playerChar.group.position.set(player.x, player.y, player.z);
  playerChar.group.rotation.y = player.yaw;

  // walk animation
  if (moving) walkT += dt * 8 * (player.speed / 3.1 + 0.2);
  const swing = moving ? Math.sin(walkT) * 0.6 : Math.sin(walkT) * 0.03;
  playerChar.leftLeg.rotation.x = swing;
  playerChar.rightLeg.rotation.x = -swing;
  playerChar.leftArm.rotation.x = -swing * 0.8;
  if (state.brawl) {
    playerChar.rightArm.rotation.x = -1.6 + Math.sin(player.attackSwing * Math.PI) * 1.4;
  } else {
    playerChar.rightArm.rotation.x = swing * 0.8;
  }
  player.attackSwing = Math.max(0, player.attackSwing - dt * 3.2);
  player.attackCd = Math.max(0, player.attackCd - dt);
}

function updateCamera(dt) {
  const fwd = playerForward();
  let desired = new THREE.Vector3(
    player.x - fwd.x * camDist,
    player.y + camHeight + camPitch * 2.4,
    player.z - fwd.z * camDist
  );
  // pull camera in if the sightline from player to desired camera pos would clip a wall
  for (let iter = 0; iter < 5; iter++) {
    let blocked = false;
    for (let s = 0.3; s <= 1.0 && !blocked; s += 0.1) {
      const sx = lerp(player.x, desired.x, s), sz = lerp(player.z, desired.z, s);
      for (const b of boxColliders) {
        if (sx > b.minX - 0.3 && sx < b.maxX + 0.3 && sz > b.minZ - 0.3 && sz < b.maxZ + 0.3) { blocked = true; break; }
      }
    }
    if (!blocked) break;
    desired.x = lerp(desired.x, player.x, 0.4);
    desired.z = lerp(desired.z, player.z, 0.4);
  }
  camera.position.lerp(desired, clamp(dt * 9, 0, 1));
  const lookAt = new THREE.Vector3(player.x, player.y + 1.3, player.z);
  camera.lookAt(lookAt);
}

function updateNpcs(dt) {
  for (const n of npcs) {
    n.swayT += dt;
    n.hitFlash = Math.max(0, n.hitFlash - dt);
    if (n.fled) {
      const dx = n.x - (n.homeHotspot ? n.homeHotspot.x : n.baseX);
      const dz = n.z - (n.homeHotspot ? n.homeHotspot.z : n.baseZ);
      const dist = Math.hypot(dx, dz);
      if (dist < 6) { n.x += dx / (dist || 1) * dt * 2.4; n.z += dz / (dist || 1) * dt * 2.4; }
      n.char.group.position.set(n.x, 0, n.z);
      n.char.group.rotation.y = Math.atan2(dx, dz);
      continue;
    }
    if (n.hostile) {
      const dx = player.x - n.x, dz = player.z - n.z;
      const dist = Math.hypot(dx, dz);
      n.yaw = Math.atan2(dx, dz);
      if (dist > 1.3) { n.x += dx / dist * dt * 1.7; n.z += dz / dist * dt * 1.7; }
      n.char.leftLeg.rotation.x = Math.sin(n.swayT * 6) * 0.4;
      n.char.rightLeg.rotation.x = -Math.sin(n.swayT * 6) * 0.4;
    } else {
      n.x = lerp(n.x, n.baseX + Math.sin(n.swayT * 0.5) * 0.15, dt);
      n.z = lerp(n.z, n.baseZ, dt);
      n.char.body.position.y = Math.sin(n.swayT * 1.6) * 0.03;
    }
    // knockback velocity
    if (n.vx || n.vz) {
      n.x += n.vx * dt; n.z += n.vz * dt;
      n.vx *= Math.max(0, 1 - dt * 6); n.vz *= Math.max(0, 1 - dt * 6);
      if (Math.abs(n.vx) < 0.02) n.vx = 0;
      if (Math.abs(n.vz) < 0.02) n.vz = 0;
    }
    n.char.group.position.set(n.x, 0, n.z);
    n.char.group.rotation.y = n.yaw;
    const mat = n.char.body.children[0].material;
    if (n.hitFlash > 0) mat.emissive.setHex(0xff3333); else mat.emissive.setHex(0x000000);
  }
}

function updateProps(dt) {
  for (const pr of propColliders) {
    if (!pr.tipped) continue;
    pr.tipT = Math.min(1, pr.tipT + dt * 2.2);
    pr.mesh.rotation.z = pr.tipT * (Math.PI / 2) * (pr.vx >= 0 ? 1 : -1);
    pr.x += pr.vx * dt; pr.z += pr.vz * dt;
    pr.vx *= 0.9; pr.vz *= 0.9;
    pr.mesh.position.set(pr.x, pr.tipT * 0.15, pr.z);
  }
}

function updateCoins(dt) {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.mesh.rotation.z += dt * 4;
    c.mesh.position.y = 0.3 + Math.sin(performance.now() * 0.003 + i) * 0.05;
    const d = Math.hypot(player.x - c.x, player.z - c.z);
    if (d < 0.7) {
      addMoney(c.value);
      updateHud();
      toast(`+${c.value}円`, 0.8);
      scene.remove(c.mesh);
      coins.splice(i, 1);
    }
  }
}

function updateLanterns(t) {
  for (let i = 0; i < streetLanterns.length; i++) {
    const l = streetLanterns[i];
    l.children[2] && (l.children[2].intensity = 0.75 + Math.sin(t * 2 + i) * 0.15);
  }
}

function updateHotspotPrompt() {
  if (state.brawl) { promptBox.classList.add('hidden'); actionBtn.textContent = '殴る'; return; }
  currentHotspot = findNearestHotspot();
  if (state.busy) { promptBox.classList.add('hidden'); return; }
  if (currentHotspot && currentHotspot.cooldown <= 0) {
    promptBox.textContent = currentHotspot.label;
    promptBox.classList.remove('hidden');
    actionBtn.textContent = ({ karaoke: '歌う', bar: '話す', club: '拾う', toilet: 'トイレ' })[currentHotspot.type];
  } else if (state.pee >= 100) {
    promptBox.textContent = 'ガマン限界…！Aボタンでその場にしゃがむ';
    promptBox.classList.remove('hidden');
    actionBtn.textContent = 'ガマン限界';
  } else {
    promptBox.classList.add('hidden');
    actionBtn.textContent = '話す';
  }
}

function tickStats(dt) {
  if (!state.busy) {
    state.pee = clamp(state.pee + dt * (100 / 150), 0, 100);
    state.energy = clamp(state.energy + dt * 2.2, 0, 100);
  }
  for (const h of hotspots) if (h.cooldown > 0) h.cooldown = Math.max(0, h.cooldown - dt);
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.add('hidden'); }
  updateHud();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (!document.getElementById('titleScreen').classList.contains('hidden')) { renderer.render(scene, camera); return; }

  updatePlayer(dt);
  updateCamera(dt);
  updateNpcs(dt);
  updateProps(dt);
  updateCoins(dt);
  updateLanterns(t);
  updateHotspotPrompt();
  tickStats(dt);
  if (!karaokeUI.classList.contains('hidden')) updateKaraoke(dt);

  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------
// Title screen -> start
// ---------------------------------------------------------------
document.getElementById('startBtn').addEventListener('pointerdown', () => {
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touchLayer').classList.remove('hidden');
  updateHud();
  toast('よいよい爺やチンピラに近づいてAボタン！', 3);
});

})();
