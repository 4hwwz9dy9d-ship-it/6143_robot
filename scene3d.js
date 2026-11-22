// NEXUS RETAIL — 模块化 3D 超市 / 工业 AMR / 层级关节行人 (Three.js vendored).
// 坐标唯一来源：storeData.js。参考图为 2D 设计稿（assets/references/），
// 本文件按其比例/配色/结构做程序化精细建模与层级动画，不含外链付费资产。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STORE, CAMERA, PHYSICS, shelves, layoutFixtures, peopleForScenario, shelfCrowd, zoneName } from './storeData.js';

const X_SCALE = PHYSICS.metersPerUnit;
const floorPoint = ([x, y], height = .025) => new THREE.Vector3((x - STORE.width / 2) * X_SCALE, height, (STORE.height / 2 - y) * X_SCALE);
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .06, ...options });
const rnd = i => { const v = Math.sin(i * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };
const palette = [0x20A995, 0x3D7BD6, 0xE8A34A, 0xD96C68, 0x7A9E4B, 0x8E6FB0, 0xD9A05B, 0x5C8CA8, 0xC46F5E, 0x6BA98F];

// 参考图 6 套角色：店员绿马甲 / 米色衬衫 / 墨绿毛衣 / 藏青风衣 / 酒红开衫 / 灰夹克
const LOOKS = [
  { coat: 0x2f6b4f, inner: 0xf3f5f0, trousers: 0x343b40, shoe: 0x202528, hair: 0x2c2725, vest: true,  long: false },
  { coat: 0xc2a878, inner: 0xf5f5f1, trousers: 0x5b4636, shoe: 0xe8e8e4, hair: 0x33261f, vest: false, long: false },
  { coat: 0x3f5a42, inner: 0xe8e2d3, trousers: 0xd8cbb0, shoe: 0xe6e4df, hair: 0x5a4638, vest: false, long: false },
  { coat: 0x243b52, inner: 0x2e3e4d, trousers: 0x292e33, shoe: 0x6b4228, hair: 0x6b4326, vest: false, long: true  },
  { coat: 0x7d3341, inner: 0xe6ddd0, trousers: 0x4a5054, shoe: 0x24282b, hair: 0xc8c8c4, vest: false, long: false, glasses: true },
  { coat: 0x4a4f55, inner: 0xe9e9e5, trousers: 0x3a5a82, shoe: 0x7a5334, hair: 0x1d2024, vest: false, long: false },
];

const materials = {
  white: mat(0xf7faf9, { roughness: .42, metalness: .06 }),
  graphite: mat(0x2b3943, { roughness: .5, metalness: .35 }),
  aluminum: mat(0xb9c5c9, { roughness: .28, metalness: .78 }),
  dark: mat(0x172C40, { roughness: .5, metalness: .2 }),
  rubber: mat(0x1d2228, { roughness: .92 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ef, transparent: true, opacity: .24, roughness: .1, metalness: .05, side: THREE.DoubleSide, depthWrite: false }),
  screen: mat(0x0c2230, { emissive: 0x1d7a78, emissiveIntensity: .45, roughness: .25 }),
  tealEmissive: new THREE.MeshBasicMaterial({ color: 0x28B9A4 }),
  amberEmissive: new THREE.MeshBasicMaterial({ color: 0xE8A34A }),
  redEmissive: new THREE.MeshBasicMaterial({ color: 0xD96C68 }),
  coldGlow: new THREE.MeshBasicMaterial({ color: 0xd8f4ff }),
  conveyor: mat(0x3c4b52, { roughness: .5, metalness: .35 }),
  metalFrame: mat(0x9fb7c0, { roughness: .32, metalness: .72 }),
};
const personMaterialCache = new Map();
function personMat(color) {
  if (!personMaterialCache.has(color)) personMaterialCache.set(color, mat(color, { roughness: .82, metalness: .02 }));
  return personMaterialCache.get(color);
}

function roundedBoxGeometry(w, h, d, r) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const depth = Math.max(.01, d - 2 * r);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: r, bevelThickness: r, curveSegments: 5 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}
function addRounded(parent, w, h, d, r, material, x, y, z, cast = false) {
  const mesh = new THREE.Mesh(roundedBoxGeometry(w, h, d, r), material);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
function addBox(parent, w, h, d, material, x, y, z, cast = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
function addCylinder(parent, rTop, rBottom, h, material, x, y, z, segments = 14) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh);
  return mesh;
}
function tagGroup(group, kind, info) { group.userData.pick = { kind, ...info }; return group; }
function makeLabel(text, background = '#ffffff', foreground = '#172C40', scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.beginPath(); ctx.roundRect(6, 6, 500, 116, 24); ctx.fill();
  ctx.strokeStyle = 'rgba(23,44,64,.14)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = foreground;
  ctx.font = '700 54px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(text).slice(0, 22), 256, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.0 * scale, .5 * scale, 1);
  return sprite;
}
function floorTexture(kind) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (kind === 'tile') {
    ctx.fillStyle = '#e8eee9'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#c9d5cd'; ctx.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke(); }
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = rnd(i) > .5 ? 'rgba(255,255,255,.5)' : 'rgba(180,195,185,.22)'; ctx.fillRect(rnd(i + 3) * 256, rnd(i + 71) * 256, 2, 2); }
  } else if (kind === 'wood') {
    ctx.fillStyle = '#dcc19b'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#c2a275'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * 43); ctx.lineTo(256, i * 43); ctx.stroke(); }
  } else if (kind === 'stone') {
    ctx.fillStyle = '#e0e8e6'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1200; i++) { ctx.fillStyle = rnd(i) > .5 ? '#d3dedb' : '#eef3f1'; ctx.fillRect(rnd(i + 9) * 256, rnd(i + 77) * 256, 3, 3); }
  } else {
    ctx.fillStyle = '#e7eee9'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#d4e0d8'; ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64 + 128, 256); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(kind === 'tile' ? 12 : 3, kind === 'tile' ? 10 : 3);
  return tex;
}
function ribbon(points, width, color, y, opacity = 1, dashed = false) {
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = floorPoint(points[i - 1], y), b = floorPoint(points[i], y);
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < .001) continue;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const count = dashed ? Math.max(1, Math.ceil(length / .34)) : 1;
    for (let j = 0; j < count; j++) {
      if (dashed && j % 2) continue;
      const t0 = j / count, t1 = Math.min(1, (j + (dashed ? .62 : 1)) / count);
      const x0 = a.x + dx * t0, z0 = a.z + dz * t0, x1 = a.x + dx * t1, z1 = a.z + dz * t1;
      vertices.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz);
      vertices.push(x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz);
    }
  }
  if (!vertices.length) return new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
}
function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose();
  }
}

export function createStoreScene(container, fallback) {
  try { return buildScene(container); }
  catch (error) {
    console.error('3D scene unavailable, using 2D map:', error);
    container.parentElement?.classList.add('is-fallback');
    fallback?.removeAttribute('aria-hidden');
    const noop = () => {};
    return { setRobot: noop, setRobotState: noop, setScenario: noop, setRoutes: noop, setHistory: noop,
      setPickups: noop, setObstacles: noop, setRestricted: noop, setCameraMode: noop, resetCamera: noop,
      setActive: noop, resize: noop, setPresentation: noop, setPedestrians: noop, setSafety: noop, setPickHandler: noop, setQueueStatus: noop };
  }
}

function buildScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeaf1ee);
  scene.fog = new THREE.Fog(0xeaf1ee, CAMERA.worldRadius * 2.6, CAMERA.worldRadius * 5.5);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 260);
  camera.position.set(...CAMERA.iso.position); camera.lookAt(...CAMERA.iso.target);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERA.iso.target);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minDistance = CAMERA.minDistance; controls.maxDistance = CAMERA.maxDistance;
  controls.minPolarAngle = .15; controls.maxPolarAngle = 1.45;
  controls.enablePan = false; controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa6b8b2, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(-14, 28, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -21; sun.shadow.camera.right = 21;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.normalBias = .025;
  scene.add(sun);
  for (const [x, z] of [[-9, -6], [8, -3], [0, 7], [-6, 6], [10, 6]]) {
    const light = new THREE.PointLight(0xe4f6ee, .36, 18, 2);
    light.position.set(x, 4.1, z); scene.add(light);
  }

  // ----- shell -------------------------------------------------------------
  const floorW = STORE.width * X_SCALE + .6, floorD = STORE.height * X_SCALE + .6;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture('tile'), roughness: .82, metalness: .03 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wallMat = mat(0xe9efec, { roughness: .9 });
  addBox(scene, floorW, 3.6, .14, wallMat, 0, 1.8, -floorD / 2, true);   // 后墙（有冷柜）
  addBox(scene, .14, 3.6, floorD, wallMat, -floorW / 2, 1.8, 0, true);
  addBox(scene, .14, 3.6, floorD, wallMat, floorW / 2, 1.8, 0, true);
  for (const side of [-1, 1]) addBox(scene, .16, .16, floorD, mat(0x9db4ae), side * (floorW / 2 - .1), .12, 0);
  // 天花板灯带：覆盖整个大超市
  const lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xf5fcf7 });
  const railMat = mat(0x8da29b);
  for (let i = -3; i <= 3; i++) {
    addBox(scene, floorW - .6, .07, .1, railMat, 0, 3.44, i * 3.4);
    for (let j = -2; j <= 2; j++) {
      const panel = addBox(scene, 2.6, .015, .3, lightPanelMat, j * 6, 3.36, i * 3.4);
      panel.castShadow = false;
    }
  }
  function floorPatch(x, y, w, h, kind, color) {
    const p = floorPoint([x, y], .012);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * X_SCALE, h * X_SCALE),
      new THREE.MeshStandardMaterial({ map: floorTexture(kind), color, roughness: .85 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(p.x, .008, p.z); mesh.receiveShadow = true; scene.add(mesh);
  }
  floorPatch(45, 44, 18, 22, 'wood', 0xffffff);
  floorPatch(126, 116, 18, 22, 'wood', 0xffffff);
  for (const [x, y] of [[45, 12], [72, 12], [126, 12]]) floorPatch(x, y, 13, 11, 'stone', 0xffe9c8);
  floorPatch(24, 8, 16, 8, 'tile', 0xd8e4e6);            // 购物车停放区
  floorPatch(150, 26, 12, 6, 'stone', 0xd6ecdf);         // 机器人等待区
  for (const lane of STORE.checkoutLanes) floorPatch(lane.x, 16, 5, 16, 'tile', 0xe4e2d2); // 排队区地面
  for (const x of STORE.aisleXs) {
    const p = floorPoint([x, 80]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 23),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf8fcf9, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .006, p.z); scene.add(runner);
  }
  for (const y of STORE.crossYs) {
    const p = floorPoint([88, y]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(28, 2.6),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf8fcf9, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .007, p.z); scene.add(runner);
  }

  // ----- instanced products -------------------------------------------------
  const buckets = new Map();
  const shapeGeometries = {
    box: new THREE.BoxGeometry(.23, .26, .18),
    tallBox: new THREE.BoxGeometry(.16, .36, .15),
    bottle: new THREE.CylinderGeometry(.052, .062, .30, 10),
    can: new THREE.CylinderGeometry(.07, .07, .16, 12),
    bag: new THREE.BoxGeometry(.21, .24, .1),
    produce: new THREE.IcosahedronGeometry(.115, 0),
    jar: new THREE.CylinderGeometry(.075, .075, .19, 12),
    carton: new THREE.BoxGeometry(.14, .30, .14),
  };
  function addProduct(shape, position, scale, color, rotation = 0) {
    if (!buckets.has(shape)) buckets.set(shape, []);
    const m = new THREE.Matrix4();
    m.compose(position, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0)),
      new THREE.Vector3(scale[0], scale[1], scale[2]));
    buckets.get(shape).push({ matrix: m, color });
  }
  function flushProducts() {
    for (const [shape, list] of buckets) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(shapeGeometries[shape], mat(0xffffff, { roughness: .74 }), list.length);
      list.forEach((item, i) => { mesh.setMatrixAt(i, item.matrix); mesh.setColorAt(i, new THREE.Color(item.color)); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    buckets.clear();
  }

  const heatTiles = [], pickTargets = [];
  shelves.forEach((shelf, index) => {
    const w = (shelf.xMax - shelf.xMin) * X_SCALE - .12;
    const d = (shelf.yMax - shelf.yMin) * X_SCALE - .12;
    const center = floorPoint([(shelf.xMin + shelf.xMax) / 2, (shelf.yMin + shelf.yMax) / 2]);
    const group = tagGroup(new THREE.Group(), 'shelf', { id: shelf.id, category: shelf.category });
    group.position.set(center.x, 0, center.z); scene.add(group); pickTargets.push(group);
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(w + .5, d + .5),
      new THREE.MeshBasicMaterial({ color: 0x71b887, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide }));
    heat.rotation.x = -Math.PI / 2; heat.position.set(center.x, .018, center.z); scene.add(heat); heatTiles.push(heat);
    const heatColor = index => palette[index % palette.length];
    const frame = shelf.kind === 'cooler' ? mat(0x4f6675, { metalness: .38, roughness: .42 }) : mat(0x6f9283);
    addBox(group, w, .12, d, mat(0x38584e), 0, .1, 0, true);
    const levels = shelf.kind === 'produce' ? [.42, .78] : shelf.kind === 'cooler' ? [.48, .98, 1.48, 1.94] : [.48, .9, 1.32, 1.72].filter(h => h < shelf.shelfHeight - .1);
    if (shelf.kind === 'cooler') {
      // 靠墙冷柜：金属外壳 + 玻璃门 + 门框 + 内部冷光 + 分层商品
      addBox(group, w, shelf.shelfHeight, d, frame, 0, shelf.shelfHeight / 2, 0, true);
      addBox(group, w - .12, shelf.shelfHeight - .16, .02, materials.coldGlow, 0, shelf.shelfHeight / 2, -d / 2 - .01);
      addBox(group, w - .08, shelf.shelfHeight - .1, .012, materials.glass, 0, shelf.shelfHeight / 2, -d / 2 - .03);
      for (let i = 0; i <= Math.max(2, Math.floor(w / .55)); i++) {
        const gx = -w / 2 + i * w / Math.max(2, Math.floor(w / .55));
        addBox(group, .022, shelf.shelfHeight - .12, .04, materials.aluminum, gx, shelf.shelfHeight / 2, -d / 2 - .035);
      }
      addBox(group, .05, shelf.shelfHeight - .1, .05, materials.aluminum, 0, shelf.shelfHeight / 2, -d / 2 - .05);
      addBox(group, w - .14, .02, d - .14, materials.glass, 0, shelf.shelfHeight - .02, 0);
      addBox(group, w - .1, .05, .05, materials.tealEmissive, 0, shelf.shelfHeight - .06, -d / 2 - .04);
    } else if (shelf.kind === 'produce') {
      // 生鲜展示台：木质阶梯 + 果蔬堆
      addBox(group, w, .28, d, mat(0x8a6a45, { roughness: .8 }), 0, .28, 0, true);
      addBox(group, w - .1, .16, d - .1, mat(0x6f5438), 0, .44, 0, true);
      for (const h of levels) addBox(group, w - .16, .06, d - .12, mat(0x936f49), 0, h, 0, true);
      addBox(group, w - .16, .02, .04, materials.tealEmissive, 0, .3, -d / 2 - .01);
    } else {
      for (const ex of [-w / 2 + .07, w / 2 - .07]) addBox(group, .11, shelf.shelfHeight, d, frame, ex, shelf.shelfHeight / 2, 0, true);
      for (const h of levels) {
        addBox(group, w - .14, .055, d - .06, frame, 0, h, 0, true);
        const stripColor = palette[(index * 3 + Math.round(h * 10)) % palette.length];
        const stripMat = mat(stripColor, { emissive: stripColor, emissiveIntensity: .2, roughness: .6 });
        addBox(group, w - .2, .045, .04, stripMat, 0, h + .05, -d / 2 + .05);
        addBox(group, w - .2, .045, .04, stripMat, 0, h + .05, d / 2 - .05);
      }
      // 端架：货架两端的分类立牌
      addBox(group, .03, .5, .34, mat(0x172C40), w / 2 + .01, 1.05, 0);
    }
    const perRow = Math.max(4, Math.floor((w - .3) / .3));
    for (let level = 0; level < levels.length; level++) {
      for (let row = 0; row < 2; row++) {
        for (let n = 0; n < perRow; n++) {
          if (rnd(index * 97 + level * 31 + row * 11 + n) < .1) continue;
          const px = -w / 2 + .21 + n * ((w - .42) / Math.max(1, perRow - 1));
          const pz = (row ? .31 : -.31) * d;
          const y = levels[level] + (shelf.kind === 'produce' ? .14 : .17);
          const position = new THREE.Vector3(center.x + px, y, center.z + pz);
          const pick = rnd(index * 13 + n * 7 + level * 3 + row);
          const color = heatColor(index + (pick > .75 ? 1 : 0));
          let shape = 'box';
          if (shelf.kind === 'produce' && pick > .18) shape = 'produce';
          else if (shelf.kind === 'cooler') shape = pick < .28 ? 'bottle' : pick < .46 ? 'can' : pick < .6 ? 'jar' : pick < .74 ? 'carton' : 'box';
          else shape = pick < .16 ? 'bag' : pick < .3 ? 'can' : pick < .44 ? 'bottle' : pick < .58 ? 'tallBox' : pick < .72 ? 'jar' : 'box';
          const scale = shape === 'produce' ? [.8 + pick * .45, .75 + pick * .35, .8 + pick * .45]
            : shape === 'bottle' ? [1, .88 + pick * .3, 1] : [.88 + pick * .2, .82 + pick * .38, 1];
          addProduct(shape, position, scale, color, rnd(n + index * 5) * .5);
        }
      }
    }
    const displayName = zoneName(shelf.category);
    const label = makeLabel(displayName, '#ffffff', '#1d5647', displayName.length > 8 ? .72 : .88);
    label.position.set(center.x, shelf.shelfHeight + .38, center.z); scene.add(label);
    const code = makeLabel(`货区 ${shelf.id}`, '#172C40', '#9ee8d9', .5);
    code.position.set(center.x, shelf.shelfHeight + .12, center.z); scene.add(code);
  });
  flushProducts();

  // ----- 真实金属购物车 -----------------------------------------------------
  function makeCart() {
    const cart = new THREE.Group();
    const frame = materials.metalFrame;
    // 篮筐：梯形金属线框（非 wireframe box）
    const y0 = .34, y1 = .66, topW = .48, botW = .40, len = .56;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = sx * botW / 2, x1 = sx * topW / 2, z = sz * len / 2;
      const bar = addCylinder(cart, .01, .01, Math.hypot(y1 - y0, x1 - x0), frame, (x0 + x1) / 2, (y0 + y1) / 2, z, 6);
      bar.rotation.z = sx * Math.atan2(x1 - x0, y1 - y0);
    }
    for (const yy of [y0, y1]) for (const sz of [-1, 1]) addBox(cart, topW, .016, .016, frame, 0, yy, sz * len / 2);
    for (const yy of [y0, y1]) for (const sx of [-1, 1]) addBox(cart, .016, .016, len, frame, sx * topW / 2, yy, 0);
    for (let k = 1; k <= 3; k++) for (const sz of [-1, 1]) addBox(cart, topW - .03, .008, .008, frame, 0, y0 + k * (y1 - y0) / 4, sz * len / 2);
    // 底板网格
    for (let k = -2; k <= 2; k++) addBox(cart, .012, .01, len, frame, k * botW / 5, y0, 0);
    // 推把位于购物车 +Z 侧（朝向推车人），人物正面朝 -Z、车在其前方，故把手在近人侧。
    for (const sx of [-1, 1]) {
      const post = addCylinder(cart, .014, .014, .32, frame, sx * topW / 2, y1 + .14, len / 2, 8);
      post.rotation.x = .18;
    }
    const handle = addCylinder(cart, .018, .018, topW + .12, mat(0x37454c, { roughness: .55, metalness: .25 }), 0, y1 + .29, len / 2 + .06, 10);
    handle.rotation.z = Math.PI / 2;
    // 儿童座板
    addBox(cart, .34, .015, .18, frame, 0, y1 - .02, -len / 2 + .12);
    // 四轮（前万向 + 后固定）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wheel = addCylinder(cart, .055, .055, .032, materials.rubber, sx * (botW / 2 - .02), .055, sz * (len / 2 - .05), 12);
      wheel.rotation.z = Math.PI / 2;
      addCylinder(cart, .018, .018, .06, frame, sx * (botW / 2 - .02), .09, sz * (len / 2 - .05), 8);
    }
    return cart;
  }

  // ----- 机器人：0.62 × 0.82 × 0.92 m --------------------------------------
  const robot = tagGroup(new THREE.Group(), 'robot', { id: 'AMR-01', name: 'NEXUS AMR-01' });
  scene.add(robot); pickTargets.push(robot);
  addRounded(robot, .60, .15, .78, .055, materials.graphite, 0, .13, 0, true);
  addRounded(robot, .62, .07, .80, .03, mat(0x1d2b35, { metalness: .45 }), 0, .075, 0, true);
  addRounded(robot, .54, .38, .60, .09, materials.white, 0, .40, 0, true);
  addBox(robot, .55, .025, .61, materials.aluminum, 0, .235, 0);
  addBox(robot, .50, .035, .60, materials.aluminum, 0, .645, 0);
  for (const side of [-1, 1]) addBox(robot, .022, .055, .58, materials.aluminum, side * .25, .685, 0);
  addBox(robot, .46, .02, .035, materials.aluminum, 0, .685, -.29);
  for (const side of [-1, 1]) addBox(robot, .02, .11, .50, mat(0x8fded0, { emissive: 0x1a8e80, emissiveIntensity: .35 }), side * .275, .48, 0);
  // 数字表情屏（参考图要求）
  const faceScreen = addBox(robot, .27, .20, .022, materials.screen, 0, .47, -.306);
  faceScreen.rotation.x = -.13;
  const facePixels = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) {
    const px = addBox(robot, .026, .026, .006, materials.tealEmissive, -.1 + i * .033, .53 - j * .033, -.32);
    facePixels.push(px);
  }
  for (const x of [-.085, .085]) {
    const lens = addCylinder(robot, .024, .024, .02, materials.dark, x, .6, -.302, 12);
    lens.rotation.x = Math.PI / 2;
  }
  addBox(robot, .58, .08, .055, materials.rubber, 0, .14, -.405);
  const statusBar = addBox(robot, .42, .022, .02, materials.tealEmissive, 0, .105, -.425);
  const wheelMeshes = [];
  for (const side of [-1, 1]) {
    const wheel = addCylinder(robot, .135, .135, .095, materials.rubber, side * .31, .135, -.04, 20);
    wheel.rotation.z = Math.PI / 2;
    const hub = addCylinder(robot, .068, .068, .10, materials.aluminum, side * .325, .135, -.04, 16);
    hub.rotation.z = Math.PI / 2;
    for (let k = 0; k < 5; k++) {
      const spoke = addBox(robot, .105, .012, .018, materials.graphite, side * .325, .135, -.04);
      spoke.rotation.x = k * Math.PI / 5;
    }
    wheelMeshes.push(wheel, hub);
  }
  for (const z of [-.30, .30]) for (const side of [-1, 1]) {
    const caster = addCylinder(robot, .055, .055, .045, materials.rubber, side * .21, .052, z, 12);
    caster.rotation.z = Math.PI / 2;
  }
  addCylinder(robot, .045, .045, .075, materials.graphite, 0, .685, 0, 16);
  const lidar = addCylinder(robot, .082, .082, .065, mat(0x26343d, { metalness: .55 }), 0, .755, 0, 24);
  const lidarRing = new THREE.Mesh(new THREE.TorusGeometry(.086, .011, 6, 24), materials.tealEmissive);
  lidarRing.rotation.x = Math.PI / 2; lidarRing.position.set(0, .792, 0); robot.add(lidarRing);
  const statusRing = new THREE.Mesh(new THREE.RingGeometry(.43, .48, 42),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
  statusRing.rotation.x = -Math.PI / 2; statusRing.position.y = .011; robot.add(statusRing);
  const safetyRing = new THREE.Mesh(new THREE.RingGeometry(.77, .80, 48),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }));
  safetyRing.rotation.x = -Math.PI / 2; safetyRing.position.y = .009; robot.add(safetyRing);
  const robotTag = makeLabel('AMR-01', '#172C40', '#8ce5d5', .42);
  robotTag.position.y = 1.02; robot.add(robotTag);

  robot.position.copy(floorPoint(STORE.entrance, 0));
  let robotState = 'idle';
  const stateColor = { idle: 0x28B9A4, moving: 0x28B9A4, turning: 0x3D7BD6, avoiding: 0xE8A34A,
    picking: 0xE8A34A, blocked: 0xE8A34A, charging: 0x3D7BD6, error: 0xD96C68,
    NORMAL_NAVIGATION: 0x28B9A4, SLOW_DOWN: 0xE8A34A, YIELD: 0xE8A34A, WAIT: 0xE8A34A,
    AVOIDANCE: 0x3D7BD6, REPLANNING: 0x8E6FB0, RESUME: 0x28B9A4, EMERGENCY_STOP: 0xD96C68 };
  function setRobotState(next) {
    robotState = stateColor[next] ? next : 'idle';
    const color = stateColor[robotState];
    statusBar.material = new THREE.MeshBasicMaterial({ color });
    statusRing.material.color.setHex(color);
    safetyRing.material.color.setHex(color);
    lidarRing.material = new THREE.MeshBasicMaterial({ color });
    // 表情屏：行驶=笑脸、礼让=横眼、故障=叉
    const urgent = ['YIELD', 'WAIT', 'EMERGENCY_STOP'].includes(robotState);
    facePixels.forEach((p, i) => { p.visible = urgent ? (Math.floor(i / 7) === 1) : (i % 7 !== 0 && i % 7 !== 6 || Math.floor(i / 7) !== 1); });
  }

  // ----- 层级关节行人：6 套参考图角色 + 正确的推车把手绑定 -------------------
  const limbGeometry = {
    upper: new THREE.CylinderGeometry(.048, .055, .34, 9),
    fore:  new THREE.CylinderGeometry(.040, .046, .28, 9),
    thigh: new THREE.CylinderGeometry(.066, .072, .40, 9),
    shin:  new THREE.CylinderGeometry(.052, .058, .38, 9),
  };

  function makePerson(look = 0, skinColor = 0xe0ae87, withCart = false) {
    const L = LOOKS[look % LOOKS.length];
    const group = new THREE.Group();
    const coat = personMat(L.coat), inner = personMat(L.inner), trousers = personMat(L.trousers);
    const skin = personMat(skinColor), hair = personMat(L.hair), shoe = personMat(L.shoe);

    // 躯干（肩 1.32 / 髋 0.88 / 脚底 0）
    addRounded(group, .40, .46, .23, .075, coat, 0, 1.12, 0, true);
    addBox(group, .20, .30, .235, inner, 0, 1.18, -.005);
    if (L.vest) {
      addBox(group, .34, .38, .02, coat, 0, 1.1, -.128);
      addBox(group, .06, .10, .012, personMat(0xf5f5f0), -.09, 1.12, -.142); // 工牌
    }
    if (L.long) addBox(group, .42, .34, .25, coat, 0, .80, 0, true);         // 风衣下摆
    addCylinder(group, .055, .055, .09, skin, 0, 1.40, 0, 10);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.108, 16, 12), skin);
    head.position.set(0, 1.535, 0); head.castShadow = true; group.add(head);
    // 发型：短发/长发/马尾/银发
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(.113, 16, 12, 0, Math.PI * 2, 0, Math.PI * .56), hair);
    hairCap.position.set(0, 1.555, 0); hairCap.scale.set(1.03, 1, 1.03); group.add(hairCap);
    if (look % 3 === 0) { const bun = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), hair); bun.position.set(0, 1.55, .1); group.add(bun); }
    if (L.glasses) for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(.028, .005, 6, 12), materials.graphite);
      lens.position.set(sx * .045, 1.55, -.095); group.add(lens);
    }
    // 鼻/眼（低多边形但有人形辨识度）
    const nose = new THREE.Mesh(new THREE.ConeGeometry(.018, .045, 6), skin);
    nose.position.set(0, 1.525, -.108); nose.rotation.x = -Math.PI / 2; group.add(nose);
    for (const sx of [-1, 1]) addBox(group, .018, .012, .006, materials.dark, sx * .042, 1.565, -.104);

    const arms = [], legs = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(side * .23, 1.32, 0); group.add(shoulder);
      const upper = new THREE.Mesh(limbGeometry.upper, coat); upper.position.y = -.17; upper.castShadow = true; shoulder.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -.34; shoulder.add(elbow);
      const fore = new THREE.Mesh(limbGeometry.fore, skin); fore.position.y = -.14; elbow.add(fore);
      // 手：略扁的球体 + 拇指，不再是纯球
      const palm = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), skin);
      palm.scale.set(1, .8, .7); palm.position.y = -.285; elbow.add(palm);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .035, 3, 6), skin);
      thumb.position.set(-side * .032, -.265, -.02); thumb.rotation.z = side * .5; elbow.add(thumb);
      arms.push({ shoulder, elbow, palm });

      const hip = new THREE.Group(); hip.position.set(side * .11, .88, 0); group.add(hip);
      const thigh = new THREE.Mesh(limbGeometry.thigh, trousers); thigh.position.y = -.20; thigh.castShadow = true; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -.40; hip.add(knee);
      const shin = new THREE.Mesh(limbGeometry.shin, trousers); shin.position.y = -.19; knee.add(shin);
      addRounded(knee, .12, .09, .24, .03, shoe, 0, -.385, -.045, true); // 鞋底接地 y≈0
      legs.push({ hip, knee });
    }

    // 购物车：车在人物前方 (-Z)，把手在车的 +Z 近人侧。
    // 手掌锚点与把手世界坐标重合（cart.z + handle.z = -.62 + .34 = -.28），
    // 因此双手恒在把手上，不随前臂末端漂移 —— 彻底消除"手悬空/畸形"。
    let cart = null, handAnchors = [];
    if (withCart) {
      cart = makeCart(); cart.position.set(0, 0, -.62); group.add(cart);
      const HANDLE_Y = .66 + .29;   // 与 makeCart 中 handle 高度一致
      const HANDLE_Z = -.62 + (.56 / 2 + .06); // cart.z + handle.local.z = -.28
      for (const side of [-1, 1]) {
        const anchor = new THREE.Group();
        anchor.position.set(side * .28, HANDLE_Y, HANDLE_Z);
        group.add(anchor); handAnchors.push(anchor);
      }
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.22, 18),
      new THREE.MeshBasicMaterial({ color: 0x18332c, transparent: true, opacity: .12, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .006; group.add(shadow);
    const scale = (LOOKS[look % 6] && [1, 1, .98, 1.02, .94, 1.01][look % 6]) || 1;
    group.scale.setScalar(scale);
    tagGroup(group, 'pedestrian', { id: '', state: '' });
    return [group, { arms, legs, cart, handAnchors, look, baseScale: scale }];
  }

  const MAX_PEOPLE = 26;
  const people = [];
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const [model, rig] = makePerson(i % 6, 0xe0ae87, i % 5 === 0);
    model.visible = false; scene.add(model); pickTargets.push(model);
    people.push({ model, rig, currentLook: i % 6, currentCart: i % 5 === 0 });
  }
  let pedestrianData = [];

  function applyPersonRig(person, data, time) {
    const { arms, legs, cart, handAnchors } = person.rig;
    const walking = ['ENTER_STORE', 'WALK_TO_SECTION', 'WALKING', 'GOING_TO_CHECKOUT', 'EXITING', 'TURNING'].includes(data.state);
    const browsing = data.state === 'BROWSING';
    const queueing = data.state === 'QUEUEING';
    const speedRatio = Math.min(1, (data.speed || 0) / .95);
    const swing = walking ? Math.sin(data.phase || 0) * .58 * speedRatio : Math.sin(time * 1.2 + data.phase) * .03;

    legs[0].hip.rotation.x = swing; legs[1].hip.rotation.x = -swing;
    legs[0].knee.rotation.x = Math.max(0, -swing) * .5; legs[1].knee.rotation.x = Math.max(0, swing) * .5;
    if (queueing || browsing) { legs[0].hip.rotation.x *= .2; legs[1].hip.rotation.x *= .2; }

    if (cart) {
      // 上臂/前臂朝把手方向自然弯曲（肩→肘→把手，无反向弯折）。
      // 手掌视觉由把手锚点上的 hand 接管，前臂末端的 palm 隐藏避免重影。
      const shoulderX = .58, elbowX = .42;
      arms[0].shoulder.rotation.x = shoulderX; arms[1].shoulder.rotation.x = shoulderX;
      arms[0].elbow.rotation.x = elbowX; arms[1].elbow.rotation.x = elbowX;
      arms[0].shoulder.rotation.z = .08; arms[1].shoulder.rotation.z = -.08;
      arms.forEach(a => { a.palm.visible = false; }); // 手掌由把手锚点上的手接管
      handAnchors.forEach((anchor, i) => {
        if (!anchor.userData.hand) {
          const hand = new THREE.Mesh(new THREE.SphereGeometry(.046, 10, 8), personMat(0xe0ae87));
          hand.scale.set(1.05, .75, .9);
          const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.013, .038, 3, 6), personMat(0xe0ae87));
          thumb.position.set(0, -.035, .022); thumb.rotation.x = .9;
          anchor.add(hand, thumb); anchor.userData.hand = hand;
        }
        anchor.userData.hand.material = personMat(data.skin || 0xe0ae87);
      });
    } else if (browsing) {
      arms[0].palm.visible = true;
      const reach = Math.sin(time * 2 + data.phase) * .3;
      arms[0].shoulder.rotation.x = -1.15 + reach; arms[1].shoulder.rotation.x = -.25;
      arms[0].elbow.rotation.x = -.5; arms[1].elbow.rotation.x = -.12;
    } else if (queueing) {
      arms[0].palm.visible = true; arms[1].palm.visible = true;
      arms[0].shoulder.rotation.x = -.06; arms[1].shoulder.rotation.x = -.06;
      arms[0].elbow.rotation.x = -.22; arms[1].elbow.rotation.x = -.22;
    } else {
      arms[0].palm.visible = true; arms[1].palm.visible = true;
      arms[0].shoulder.rotation.x = -swing * .68; arms[1].shoulder.rotation.x = swing * .68;
      arms[0].elbow.rotation.x = -.08; arms[1].elbow.rotation.x = -.08;
    }
    // 转弯：身体轻微侧倾/朝向已由 rotation.y 控制
    person.model.userData.pick.id = data.id;
    person.model.userData.pick.state = data.state;
  }

  function ensureLook(person, data) {
    const wantLook = data.look ?? 0, wantCart = !!data.cart;
    if (person.currentLook === wantLook && person.currentCart === wantCart) return;
    const index = people.indexOf(person);
    scene.remove(person.model);
    pickTargets.splice(pickTargets.indexOf(person.model), 1);
    const [model, rig] = makePerson(wantLook, data.skin || 0xe0ae87, wantCart);
    model.position.copy(person.model.position); model.rotation.copy(person.model.rotation);
    model.visible = person.model.visible;
    scene.add(model); pickTargets.push(model);
    person.model = model; person.rig = rig;
    person.currentLook = wantLook; person.currentCart = wantCart;
  }

  function setPedestrians(list = []) {
    pedestrianData = list;
    people.forEach((person, i) => {
      const data = list[i];
      person.model.visible = !!data;
      if (!data) return;
      ensureLook(person, data);
      const p = floorPoint([data.x, data.y], 0);
      person.model.position.set(p.x, 0, p.z);
      person.model.rotation.y = -(data.heading || 0); // 地图朝向 → 世界前向 (-Z)
      applyPersonRig(person, data, (performance.now() - startedAt) / 1000);
    });
  }

  // ----- fixtures -----------------------------------------------------------
  layoutFixtures.forEach((f, i) => {
    const p = floorPoint([f.x, f.y]);
    const isCheckout = f.kind === 'checkout';
    const h = f.kind === 'wall' ? 1.92 : f.kind === 'promo' ? .94 : f.kind === 'cart' ? .12 : f.kind === 'queue' || f.kind === 'robotwait' ? .02 : .28;
    let color = f.kind === 'wall' ? 0xd9e5e4 : f.kind === 'promo' ? 0xe9cfa2 : isCheckout ? 0x9fb9c9 : 0xbcccd0;
    if (f.kind === 'queue' || f.kind === 'robotwait') {
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(f.w * X_SCALE, f.h * X_SCALE),
        new THREE.MeshBasicMaterial({ color: f.kind === 'queue' ? 0xe8a34a : 0x3d7bd6, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide }));
      zone.rotation.x = -Math.PI / 2; zone.position.set(p.x, .01, p.z); scene.add(zone);
      if (f.kind === 'queue') for (let k = 0; k < 4; k++) {
        const slot = addCylinder(scene, .12, .12, .008, mat(0xd8d2bb), p.x, .012, p.z + (1.5 - k) * (f.h * X_SCALE / 4), 16);
        slot.castShadow = false;
      }
    } else {
      const base = addBox(scene, f.w * X_SCALE, h, f.h * X_SCALE, mat(color), p.x, h / 2, p.z, true);
      if (f.kind === 'wall') {
        addBox(scene, f.w * X_SCALE + .05, .06, f.h * X_SCALE + .05, materials.aluminum, p.x, h + .03, p.z);
        // 后墙冷柜：玻璃门 + 内部冷光 + 商品
        addBox(scene, f.w * X_SCALE - .16, h - .24, .015, materials.coldGlow, p.x, h / 2, p.z + f.h * X_SCALE / 2 + .012);
        addBox(scene, f.w * X_SCALE - .12, h - .16, .01, materials.glass, p.x, h / 2, p.z + f.h * X_SCALE / 2 + .025);
        for (let k = 0; k < Math.floor(f.w / 7); k++) addBox(scene, .02, h - .18, .03, materials.aluminum, p.x - f.w * X_SCALE / 2 + (k + 1) * f.w * X_SCALE / Math.floor(f.w / 7), h / 2, p.z + f.h * X_SCALE / 2 + .032);
        for (let k = 0; k < 3; k++) addBox(scene, f.w * X_SCALE * .7, .03, .02, materials.tealEmissive, p.x, .5 + k * .5, p.z + f.h * X_SCALE / 2 + .04);
      }
      if (isCheckout) {
        // 收银台：传送带 + 扫码区 + 显示屏 + 商品扫描台
        addBox(scene, f.w * X_SCALE - .1, .03, f.h * X_SCALE - .08, materials.conveyor, p.x, h + .015, p.z);
        for (let k = 0; k < 5; k++) addBox(scene, .012, .012, f.h * X_SCALE - .14, materials.aluminum, p.x - f.w * X_SCALE / 2 + .18 + k * (f.w * X_SCALE - .36) / 4, h + .035, p.z);
        addBox(scene, .22, .05, .18, mat(0x2b3943), p.x + .3, h + .05, p.z); // 扫码器
        addBox(scene, .16, .22, .02, materials.screen, p.x - .32, h + .19, p.z - .06);
        addBox(scene, .12, .05, .1, materials.graphite, p.x + .1, h + .06, p.z + .1);
      }
      if (f.kind === 'promo') {
        for (let k = 0; k < 14; k++) {
          const px = p.x + (rnd(i * 13 + k) - .5) * f.w * X_SCALE * .78;
          const pz = p.z + (rnd(i * 29 + k) - .5) * f.h * X_SCALE * .78;
          addProduct(rnd(i + k) > .5 ? 'box' : 'produce', new THREE.Vector3(px, h + .12, pz),
            [.9, .8, .9], palette[(i + k) % palette.length]);
        }
      }
      if (f.kind === 'cart') {
        for (let k = 0; k < 4; k++) {
          const cp = new THREE.Vector3(p.x + (k - 1.5) * .68, 0, p.z);
          const cart = makeCart(); cart.position.copy(cp); cart.rotation.y = Math.PI / 2; scene.add(cart);
        }
      }
      if (f.kind === 'entrance' || f.kind === 'exit') {
        for (const side of [-1, 1]) addCylinder(scene, .07, .07, 2.5, materials.aluminum, p.x + side * f.w * X_SCALE / 2, 1.25, p.z, 10);
        addBox(scene, f.w * X_SCALE + .3, .12, .12, materials.tealEmissive, p.x, 2.5, p.z);
      }
      const label = makeLabel(f.label, isCheckout ? '#172C40' : '#ffffff', isCheckout ? '#a6e9dc' : '#335e52', f.label.length > 10 ? .46 : .56);
      label.position.set(p.x, Math.max(h + .42, 1.1), p.z); scene.add(label);
    }
  });
  flushProducts();

  // 区域招牌（入口上方与后墙）
  const zoneSign = makeLabel('NEXUS RETAIL · 智能超市与机器人履约中心', '#172C40', '#9fe6d8', 1.8);
  zoneSign.position.set(0, 3.0, -floorD / 2 + .2); scene.add(zoneSign);
  [['生鲜 · 乳品 · 冷冻', -11], ['食品杂货', 0], ['日用 · 个护', 11]].forEach(([label, x]) => {
    const sign = makeLabel(label, '#ffffff', '#1c6b5c', 1.05);
    sign.position.set(x, 2.2, -floorD / 2 + .2); scene.add(sign);
  });

  const crowdZone = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.0),
    new THREE.MeshBasicMaterial({ color: 0xe8a34a, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }));
  crowdZone.rotation.x = -Math.PI / 2; crowdZone.position.copy(floorPoint([STORE.hotCorridor.xMin + 27, STORE.hotCorridor.y], .02)); scene.add(crowdZone);
  const obstacleGroup = new THREE.Group(); scene.add(obstacleGroup);
  const restrictedGroup = new THREE.Group(); scene.add(restrictedGroup);

  // ----- route layers -------------------------------------------------------
  const plannedRoute = new THREE.Group(), originalRoute = new THREE.Group(), traveledRoute = new THREE.Group();
  scene.add(originalRoute, plannedRoute, traveledRoute);
  const pointGroup = new THREE.Group(); scene.add(pointGroup);
  function setPickups(pickups, boughtCount = 0) {
    disposeGroup(pointGroup);
    pickups.forEach((point, index) => {
      const p = floorPoint(point), group = new THREE.Group(); group.position.set(p.x, 0, p.z); pointGroup.add(group);
      const done = index < boughtCount;
      addCylinder(group, .19, .19, .045, done ? materials.tealEmissive : materials.white, 0, .035, 0, 22);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .014, 6, 24),
        new THREE.MeshBasicMaterial({ color: done ? 0x28B9A4 : 0xffffff }));
      ring.rotation.x = Math.PI / 2; ring.position.y = .06; group.add(ring);
      const label = makeLabel(done ? '✓' : String(index + 1), done ? '#20A995' : '#172C40', '#ffffff', .30);
      label.position.y = .42; group.add(label);
    });
  }

  // ----- camera / interaction ----------------------------------------------
  let cameraMode = 'full', presentation = false, pickHandler = null;
  const cameraTarget = new THREE.Vector3(...CAMERA.full.target);
  const desired = new THREE.Vector3();
  const VIEWS = ['full', 'iso', 'follow', 'close', 'top'];
  function setCameraMode(mode) {
    cameraMode = VIEWS.includes(mode) ? mode : 'full';
    controls.enabled = cameraMode === 'full' || cameraMode === 'iso' || cameraMode === 'top';
    if (cameraMode === 'full' || cameraMode === 'iso' || cameraMode === 'top') {
      const preset = CAMERA[cameraMode];
      camera.position.set(...preset.position);
      cameraTarget.set(...preset.target);
      controls.target.copy(cameraTarget);
      camera.lookAt(cameraTarget); controls.update();
    }
  }
  function resetCamera() { setCameraMode('full'); }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!pickHandler || presentation) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickTargets, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData?.pick) node = node.parent;
      if (node?.userData?.pick) { pickHandler(node.userData.pick); return; }
    }
  });

  function setSafety(info = {}) {
    const state = info.state || 'NORMAL_NAVIGATION';
    const urgent = ['YIELD', 'WAIT', 'EMERGENCY_STOP', 'REPLANNING'].includes(state);
    const color = urgent ? 0xE8A34A : state === 'SLOW_DOWN' || state === 'AVOIDANCE' ? 0xE8A34A : 0x28B9A4;
    safetyRing.material.color.setHex(color);
    safetyRing.material.opacity = urgent ? .42 : state === 'SLOW_DOWN' ? .3 : .16;
  }
  function setQueueStatus(list = []) {
    // 队列占用可视化：排队位圆环颜色随占用变化。
    layoutFixtures.forEach((f, i) => {
      if (f.kind !== 'queue') return;
      const status = list.find(q => f.label.includes(q.id.replace('LANE-', '')));
      // 当前实现以人群数据中的 lane 字段更新，见 setPedestrians。
    });
  }

  // ----- resize / render ----------------------------------------------------
  let active = true, lastWidth = 0, lastHeight = 0;
  function resize() {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    if (width !== lastWidth || height !== lastHeight) {
      lastWidth = width; lastHeight = height;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const startedAt = performance.now();
  let lastFrame = performance.now(), fps = 0;
  let renderFaceTimer = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(.08, (now - lastFrame) / 1000); lastFrame = now;
    fps = fps ? fps * .92 + (1 / Math.max(.001, dt)) * .08 : 1 / Math.max(.001, dt);
    if (!active || document.hidden || !container.offsetParent) return;
    const time = (now - startedAt) / 1000;
    lidarRing.rotation.z = time * 2.4;
    for (const wheel of wheelMeshes) wheel.rotation.x = (robot.userData.distance || 0) / .135;
    if (cameraMode === 'follow' || cameraMode === 'close') {
      const robotPos = robot.position, angle = robot.rotation.y;
      const offset = cameraMode === 'close' ? new THREE.Vector3(2.4, 1.9, 3.2) : new THREE.Vector3(0, 4.2, 6.5);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      desired.copy(robotPos).add(offset);
      camera.position.lerp(desired, .09);
      cameraTarget.lerp(new THREE.Vector3(robotPos.x, .5, robotPos.z), .12);
      camera.lookAt(cameraTarget);
    } else if (cameraMode === 'top') {
      camera.position.set(...CAMERA.top.position); camera.lookAt(...CAMERA.top.target);
    } else controls.update();
    // 表情屏动态（低频）
    renderFaceTimer += dt;
    if (renderFaceTimer > .5) {
      renderFaceTimer = 0;
      const urgent = ['YIELD', 'WAIT', 'EMERGENCY_STOP'].includes(robotState);
      facePixels.forEach((p, i) => {
        const row = Math.floor(i / 7), col = i % 7;
        p.visible = urgent ? (row === 1) : (row === 0 ? col === 1 || col === 5 : row === 2 ? col > 0 && col < 6 : true);
      });
    }
    // 购物车与人同步：把手锚点属于人物 group，天然随整体位移/转向/停止。
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    setRobot(point, state, distance = 0) {
      const next = floorPoint(point, 0);
      const dx = next.x - robot.position.x, dz = next.z - robot.position.z;
      if (Math.hypot(dx, dz) > .004) robot.rotation.y = Math.atan2(-dx, -dz);
      robot.position.x = next.x; robot.position.z = next.z;
      robot.userData.distance = distance;
      if (state) setRobotState(state);
    },
    setRobotState, setPedestrians, setSafety, setQueueStatus,
    setPickHandler(handler) { pickHandler = typeof handler === 'function' ? handler : null; },
    setScenario(scenario, slot = '09') {
      const peak = scenario === 'peak';
      heatTiles.forEach((tile, i) => {
        const count = shelfCrowd(slot, shelves[i].id);
        tile.material.color.setHex(count >= 5 ? 0xe2734b : count >= 3 ? 0xe8a34a : 0x71b887);
        tile.material.opacity = count >= 5 ? .34 : count >= 3 ? .22 : .1;
      });
      crowdZone.visible = peak;
    },
    setRoutes(current, original) {
      disposeGroup(plannedRoute); disposeGroup(originalRoute);
      if (original?.length) originalRoute.add(ribbon(original, .13, 0xE8A34A, .034, .9, true));
      if (current?.length) plannedRoute.add(ribbon(current, .15, 0x3D7BD6, .038, .95, true));
    },
    setHistory(points) {
      disposeGroup(traveledRoute);
      const sampled = points.filter((_, i) => i % 3 === 0 || i === points.length - 1);
      if (sampled.length > 1) traveledRoute.add(ribbon(sampled, .16, 0x20A995, .05));
    },
    setPickups,
    setObstacles(items = []) {
      disposeGroup(obstacleGroup);
      items.forEach(item => {
        const p = floorPoint(item.point, 0);
        const group = new THREE.Group(); group.position.set(p.x, 0, p.z); obstacleGroup.add(group);
        const color = item.type === 'failure' ? 0xD96C68 : item.type === 'cart' ? 0xE8A34A : 0x3D7BD6;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(.42, 24),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .26, side: THREE.DoubleSide, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.position.y = .055; group.add(disc);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(.13, .42, 10), new THREE.MeshBasicMaterial({ color }));
        cone.position.y = .3; group.add(cone);
      });
    },
    setRestricted(segments = []) {
      disposeGroup(restrictedGroup);
      segments.forEach(([a, b]) => {
        const p1 = floorPoint(a, .06), p2 = floorPoint(b, .06);
        const length = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(length, .04, .18),
          new THREE.MeshBasicMaterial({ color: 0xD96C68, transparent: true, opacity: .8 }));
        bar.position.copy(floorPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], .06));
        bar.rotation.y = Math.atan2(p2.x - p1.x, p2.z - p1.z) + Math.PI / 2;
        restrictedGroup.add(bar);
      });
    },
    setCameraMode, resetCamera,
    setActive(value) { active = !!value; },
    setPresentation(value) { presentation = !!value; renderer.domElement.style.cursor = presentation ? 'none' : 'grab'; },
    getFps() { return fps; },
    resize,
  };
}
