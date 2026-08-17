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
  updateDeckHeightVar();
}
function updateDeckHeightVar() {
  const deck = document.getElementById('controlDeck');
  if (deck && deck.offsetHeight > 0) {
    document.documentElement.style.setProperty('--deckH', deck.offsetHeight + 'px');
  }
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
// kept gentle on purpose (small X offsets) so the corridor stays visible in a
// straight sightline -- shops must never end up hidden around a tight bend
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0.4, 0, -11),
  new THREE.Vector3(-0.5, 0, -23),
  new THREE.Vector3(0.6, 0, -35),
  new THREE.Vector3(-0.3, 0, -47),
  new THREE.Vector3(0.5, 0, -58),
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

  let facePlane = null;
  if (skin.faceTexture) {
    facePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: skin.faceTexture })
    );
    facePlane.position.set(0, 1.55, 0.17);
    body.add(facePlane);
  }

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

  return { group: g, body, leftArm, rightArm, leftLeg, rightLeg, handAttach, head, facePlane };
}

// Tsutomu's face photo. Paste a data:image/... URI here to put his real face on the
// player model and in the face-cam wipe; leave empty to fall back to a flat skin tone.
const TSUTOMU_FACE_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAG0AAACPCAIAAAB/FsKIAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA3dpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDkuMC1jMDAxIDc5LmMwMjA0YjJkZWYsIDIwMjMvMDIvMDItMTI6MTQ6MjQgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6MzY5MWFiY2EtMzZjMi00OGViLTk3NWQtYTUxNTFlMTU4MzVhIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjVFRDJEQjA0OTI3MjExRjFCRDZGOUM5MDEzMTNDMkZFIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjVFRDJEQjAzOTI3MjExRjFCRDZGOUM5MDEzMTNDMkZFIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCAyMDIzIE1hY2ludG9zaCI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOmFmZDBlMmJmLTc0YzItNDhmYy1hMmVlLTRiZjVlY2YzNDEyOCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDozNjkxYWJjYS0zNmMyLTQ4ZWItOTc1ZC1hNTE1MWUxNTgzNWEi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";
let tsutomuFaceTexture = null;
if (TSUTOMU_FACE_DATA_URI) {
  tsutomuFaceTexture = new THREE.TextureLoader().load(TSUTOMU_FACE_DATA_URI);
  tsutomuFaceTexture.encoding = THREE.sRGBEncoding;
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
const playerChar = makeCharacter({ shirt: 0xcf5a3a, pants: 0x2a2a3a, skin: 0xe8b98a, hair: 0x1a1a1a, faceTexture: tsutomuFaceTexture });
scene.add(playerChar.group);

let camYaw = Math.PI;
let camPitch = 0.32;
const camDist = 4.4, camHeight = 2.0;

function playerForward() {
  return new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
}

// ---------------------------------------------------------------
// Face cam wipe: just the raw photo dropped into the frame -- a 3D
// render of the head looked too dark/muddy to read at thumbnail size.
// ---------------------------------------------------------------
const faceCamImgEl = document.getElementById('faceCamImg');
if (TSUTOMU_FACE_DATA_URI) faceCamImgEl.src = TSUTOMU_FACE_DATA_URI;

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
const karaokePos = karaokeFrame.p.clone().addScaledVector(karaokeFrame.right, -(HALF_WIDTH + 0.4));
hotspots.push({ x: karaokePos.x, z: karaokePos.z, r: 1.6, type: 'karaoke', label: 'からおけスナック「まり子」', cooldown: 0 });
const oldman = spawnNpc(karaokePos.x + 0.6, karaokePos.z + 0.4, 'oldman');

const barFrame = pathFrame(uBar);
const barPos = barFrame.p.clone().addScaledVector(barFrame.right, (HALF_WIDTH + 0.4));
hotspots.push({ x: barPos.x, z: barPos.z, r: 1.7, type: 'bar', label: 'ぼったくりBAR「魔界」', cooldown: 0 });
const thug1 = spawnNpc(barPos.x - 0.5, barPos.z + 0.5, 'thug');
const thug2 = spawnNpc(barPos.x + 0.5, barPos.z + 0.7, 'thug');
thug1.homeHotspot = thug2.homeHotspot = hotspots[hotspots.length - 1];

// club prop near the bar
const clubPickupPos = { x: barPos.x + 1.3, z: barPos.z - 0.6 };
const clubPropMesh = makeClub();
clubPropMesh.rotation.x = Math.PI / 2;
clubPropMesh.position.set(clubPickupPos.x, 0.06, clubPickupPos.z);
scene.add(clubPropMesh);
hotspots.push({ x: clubPickupPos.x, z: clubPickupPos.z, r: 1.0, type: 'club', label: '角材が落ちている', cooldown: 0 });

// public toilet nook
const toiletFrame = pathFrame(uToilet);
const toiletPos = toiletFrame.p.clone().addScaledVector(toiletFrame.right, -(HALF_WIDTH + 0.4));
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
hotspots.push({ x: toiletPos.x, z: toiletPos.z - 1.1, r: 1.3, type: 'toilet', label: '公衆トイレ', cooldown: 0 });

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
// Input: D-pad + look pad + buttons + keyboard
// ---------------------------------------------------------------
const input = { action: false, jump: false };
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

const dpad = { up: false, down: false, left: false, right: false };
function bindDpadBtn(id, key) {
  const el = document.getElementById(id);
  const set = v => e => { e.preventDefault(); dpad[key] = v; };
  el.addEventListener('pointerdown', set(true));
  el.addEventListener('pointerup', set(false));
  el.addEventListener('pointercancel', set(false));
  el.addEventListener('pointerleave', set(false));
}
bindDpadBtn('dpadUp', 'up');
bindDpadBtn('dpadDown', 'down');
bindDpadBtn('dpadLeft', 'left');
bindDpadBtn('dpadRight', 'right');

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
  triggerHotspot(currentHotspot);
}

function triggerHotspot(hs) {
  if (hs.type === 'karaoke') openKaraoke();
  else if (hs.type === 'bar') openBar();
  else if (hs.type === 'club') pickupClub();
  else if (hs.type === 'toilet') useToilet();
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
  let mx = 0, my = 0;
  if (keys['KeyW'] || keys['ArrowUp'] || dpad.up) my -= 1;
  if (keys['KeyS'] || keys['ArrowDown'] || dpad.down) my += 1;
  if (keys['KeyA'] || keys['ArrowLeft'] || dpad.left) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight'] || dpad.right) mx += 1;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }

  const moving = len > 0.08 && !state.busy;
  const fwd = playerForward();
  const rightV = new THREE.Vector3(-fwd.z, 0, fwd.x);
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

let lastHotspot = null;
function updateHotspotPrompt() {
  if (state.brawl) { promptBox.classList.add('hidden'); actionBtn.textContent = '殴る'; return; }
  currentHotspot = findNearestHotspot();
  // touching a hotspot (walking into its radius) fires it automatically --
  // no button press needed. Only fires on the outside->inside transition so
  // it doesn't repeat every frame while the player just stands there.
  if (currentHotspot && currentHotspot !== lastHotspot && currentHotspot.cooldown <= 0 && !state.busy) {
    triggerHotspot(currentHotspot);
  }
  lastHotspot = currentHotspot;
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
  updateDeckHeightVar();
  updateHud();
  toast('よいよい爺やチンピラに近づいてAボタン！', 3);
});

})();
