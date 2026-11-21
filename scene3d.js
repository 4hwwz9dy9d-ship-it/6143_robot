// NEXUS RETAIL — modular 3D store, premium AMR, articulated pedestrians.
// Geometry is generated from storeData.js; no paid or external 3D assets.
// IMPORTANT: the supplied images are 2D design references (turnaround sheets),
// not rigged GLB/GLTF files. Models below follow their proportions, palette
// and structure, with hierarchical joints for walk / idle / browse / push.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STORE, PHYSICS, shelves, layoutFixtures, peopleForScenario, shelfCrowd, zoneName } from './storeData.js';

const X_SCALE = PHYSICS.metersPerUnit; // 1 map unit = 0.17 m everywhere
const floorPoint = ([x, y], height = .025) => new THREE.Vector3((x - STORE.width / 2) * X_SCALE, height, (STORE.height / 2 - y) * X_SCALE);
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, metalness: .05, ...options });
const rnd = i => { const v = Math.sin(i * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };
const palette = [0x20A995, 0x3D7BD6, 0xE8A34A, 0xD96C68, 0x7A9E4B, 0x8E6FB0, 0xD9A05B, 0x5C8CA8, 0xC46F5E, 0x6BA98F];
const skinTones = [0xf0c9a8, 0xe0ae87, 0xc98d68, 0x8d5c42, 0xf5d7b8];
const hairTones = [0x2c2725, 0x4a3529, 0x6b6159, 0x1d2024, 0x8a7b66];

const materials = {
  white: mat(0xf7faf9, { roughness: .42, metalness: .06 }),
  graphite: mat(0x2b3943, { roughness: .5, metalness: .35 }),
  aluminum: mat(0xb9c5c9, { roughness: .28, metalness: .78 }),
  dark: mat(0x172C40, { roughness: .5, metalness: .2 }),
  rubber: mat(0x1d2228, { roughness: .92 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ef, transparent: true, opacity: .28, roughness: .12, metalness: .05, side: THREE.DoubleSide }),
  screen: mat(0x0c2230, { emissive: 0x1d7a78, emissiveIntensity: .45, roughness: .25 }),
  tealEmissive: new THREE.MeshBasicMaterial({ color: 0x28B9A4 }),
  amberEmissive: new THREE.MeshBasicMaterial({ color: 0xE8A34A }),
  redEmissive: new THREE.MeshBasicMaterial({ color: 0xD96C68 }),
};
const personMaterialCache = new Map();
function personMat(color) {
  const key = color;
  if (!personMaterialCache.has(key)) personMaterialCache.set(key, mat(color, { roughness: .82, metalness: .02 }));
  return personMaterialCache.get(key);
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
    ctx.fillStyle = '#e2e9e4'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#c2cec7'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke(); }
  } else if (kind === 'wood') {
    ctx.fillStyle = '#dfc8a5'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#c6a980'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * 43); ctx.lineTo(256, i * 43); ctx.stroke(); }
  } else if (kind === 'stone') {
    ctx.fillStyle = '#dfe7e7'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = rnd(i) > .5 ? '#d3dedd' : '#e8eeee'; ctx.fillRect(rnd(i + 9) * 256, rnd(i + 77) * 256, 3, 3); }
  } else {
    ctx.fillStyle = '#e7eee9'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#d4e0d8'; ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64 + 128, 256); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(kind === 'tile' ? 8 : 3, kind === 'tile' ? 5 : 3);
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
      setActive: noop, resize: noop, setPresentation: noop, setPedestrians: noop, setSafety: noop, setPickHandler: noop };
  }
}

function buildScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9f0ed);
  scene.fog = new THREE.Fog(0xe9f0ed, 40, 78);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  const cameraHome = new THREE.Vector3(8.5, 12.5, 17);
  camera.position.copy(cameraHome); camera.lookAt(0, .4, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .45, 0);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minDistance = 8; controls.maxDistance = 44;
  controls.minPolarAngle = .22; controls.maxPolarAngle = 1.44;
  controls.enablePan = false; controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa6b8b2, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.75);
  sun.position.set(-8, 18, 11); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
  sun.shadow.normalBias = .025;
  scene.add(sun);
  for (const [x, z] of [[-5, -3], [4, -1], [0, 5]]) {
    const light = new THREE.PointLight(0xdff4ee, .45, 15, 2);
    light.position.set(x, 3.2, z); scene.add(light);
  }

  // ----- shell -------------------------------------------------------------
  const floorW = STORE.width * X_SCALE + .6, floorD = STORE.height * X_SCALE + .6;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture('tile'), roughness: .82, metalness: .03 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wallMat = mat(0xe9efec, { roughness: .9 });
  addBox(scene, floorW, 3.5, .14, wallMat, 0, 1.75, -floorD / 2, true);
  addBox(scene, .14, 3.5, floorD, wallMat, -floorW / 2, 1.75, 0, true);
  addBox(scene, .14, 3.5, floorD, wallMat, floorW / 2, 1.75, 0, true);
  for (const side of [-1, 1]) addBox(scene, .16, .16, floorD, mat(0x9db4ae), side * (floorW / 2 - .1), .12, 0);
  const lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xf2fbf5 });
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
    const panel = addBox(scene, 1.5, .015, .22, lightPanelMat, j * 5.4, 3.32, i * 2.75);
    panel.castShadow = false;
  }
  function floorPatch(x, y, w, h, kind, color) {
    const p = floorPoint([x, y], .012);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * X_SCALE, h * X_SCALE),
      new THREE.MeshStandardMaterial({ map: floorTexture(kind), color, roughness: .85 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(p.x, .008, p.z); mesh.receiveShadow = true; scene.add(mesh);
  }
  floorPatch(29, 69, 12, 14, 'wood', 0xffffff);
  floorPatch(11, 18, 9, 9, 'stone', 0xffe9c8);
  floorPatch(11, 66, 9, 9, 'stone', 0xffe9c8);
  floorPatch(129, 35, 8, 8, 'stone', 0xffe9c8);
  floorPatch(13, 3, 12, 4, 'tile', 0xd8e4e6);
  for (const x of STORE.aisleXs) {
    const p = floorPoint([x, 45]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 12.8),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf7fbf8, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .006, p.z); scene.add(runner);
  }
  for (const y of STORE.crossYs) {
    const p = floorPoint([70, y]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(21.6, 2.4),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf7fbf8, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .007, p.z); scene.add(runner);
  }

  // ----- instanced products -------------------------------------------------
  const buckets = new Map();
  const shapeGeometries = {
    box: new THREE.BoxGeometry(.23, .26, .18),
    tallBox: new THREE.BoxGeometry(.16, .34, .15),
    bottle: new THREE.CylinderGeometry(.058, .066, .29, 9),
    can: new THREE.CylinderGeometry(.07, .07, .16, 10),
    bag: new THREE.BoxGeometry(.21, .23, .1),
    produce: new THREE.IcosahedronGeometry(.115, 0),
    jar: new THREE.CylinderGeometry(.075, .075, .18, 10),
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
      const mesh = new THREE.InstancedMesh(shapeGeometries[shape], mat(0xffffff, { roughness: .78 }), list.length);
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
      new THREE.MeshBasicMaterial({ color: 0x71b887, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide }));
    heat.rotation.x = -Math.PI / 2; heat.position.set(center.x, .018, center.z); scene.add(heat); heatTiles.push(heat);
    const heatColor = index => palette[index % palette.length];
    const frame = shelf.kind === 'cooler' ? mat(0x4f6675, { metalness: .35, roughness: .45 }) : mat(0x6f9283);
    addBox(group, w, .11, d, mat(0x38584e), 0, .1, 0, true);
    const levels = shelf.kind === 'produce' ? [.42, .74] : shelf.kind === 'cooler' ? [.48, .99, 1.5, 1.9] : [.48, .9, 1.3, 1.7].filter(h => h < shelf.shelfHeight - .1);
    if (shelf.kind === 'cooler') {
      addBox(group, w, shelf.shelfHeight, d, frame, 0, shelf.shelfHeight / 2, 0, true);
      addBox(group, w - .1, shelf.shelfHeight - .12, .02, new THREE.MeshBasicMaterial({ color: 0xbfe0ea }), 0, shelf.shelfHeight / 2, -d / 2 - .012);
      for (let i = 0; i < Math.max(2, Math.floor(w / .55)); i++) {
        addBox(group, .025, shelf.shelfHeight - .16, .03, materials.aluminum, -w / 2 + (i + 1) * w / (Math.max(2, Math.floor(w / .55)) + 1), shelf.shelfHeight / 2, -d / 2 - .03);
      }
      addBox(group, w - .14, .02, d - .14, materials.glass, 0, shelf.shelfHeight - .02, 0);
      addBox(group, w - .1, .05, .05, materials.tealEmissive, 0, shelf.shelfHeight - .06, -d / 2 - .03);
    } else {
      for (const ex of [-w / 2 + .06, w / 2 - .06]) addBox(group, .11, shelf.shelfHeight, d, frame, ex, shelf.shelfHeight / 2, 0, true);
      for (const h of levels) {
        addBox(group, w - .14, .055, d - .06, frame, 0, h, 0, true);
        const stripColor = palette[(index * 3 + Math.round(h * 10)) % palette.length];
        const stripMat = mat(stripColor, { emissive: stripColor, emissiveIntensity: .22, roughness: .6 });
        addBox(group, w - .2, .05, .045, stripMat, 0, h + .05, -d / 2 + .05);
        addBox(group, w - .2, .05, .045, stripMat, 0, h + .05, d / 2 - .05);
      }
    }
    const perRow = Math.max(3, Math.floor((w - .3) / .34));
    for (let level = 0; level < levels.length; level++) {
      for (let row = 0; row < 2; row++) {
        for (let n = 0; n < perRow; n++) {
          if (rnd(index * 97 + level * 31 + row * 11 + n) < .12) continue;
          const px = -w / 2 + .21 + n * ((w - .42) / Math.max(1, perRow - 1));
          const pz = (row ? .32 : -.32) * d;
          const y = levels[level] + (shelf.kind === 'produce' ? .13 : .16);
          const position = new THREE.Vector3(center.x + px, y, center.z + pz);
          const pick = rnd(index * 13 + n * 7 + level * 3 + row);
          const color = heatColor(index + (pick > .75 ? 1 : 0));
          let shape = 'box';
          if (shelf.kind === 'produce' && pick > .22) shape = 'produce';
          else if (shelf.kind === 'cooler') shape = pick < .32 ? 'bottle' : pick < .52 ? 'can' : pick < .68 ? 'jar' : 'box';
          else shape = pick < .18 ? 'bag' : pick < .34 ? 'can' : pick < .5 ? 'bottle' : pick < .64 ? 'tallBox' : pick < .78 ? 'jar' : 'box';
          const scale = shape === 'produce' ? [.85 + pick * .4, .8 + pick * .3, .85 + pick * .4]
            : shape === 'bottle' ? [1, .9 + pick * .25, 1] : [.9 + pick * .18, .85 + pick * .35, 1];
          addProduct(shape, position, scale, color, rnd(n + index * 5) * .5);
        }
      }
    }
    const displayName = zoneName(shelf.category);
    const label = makeLabel(displayName, '#ffffff', '#1d5647', displayName.length > 8 ? .72 : .88);
    label.position.set(center.x, shelf.shelfHeight + .36, center.z); scene.add(label);
    const code = makeLabel(`货区 ${shelf.id}`, '#172C40', '#9ee8d9', .48);
    code.position.set(center.x, shelf.shelfHeight + .09, center.z); scene.add(code);
  });
  flushProducts();

  // ----- fixtures -----------------------------------------------------------
  layoutFixtures.forEach((f, i) => {
    const p = floorPoint([f.x, f.y]);
    const isCheckout = f.kind === 'checkout';
    const h = f.kind === 'wall' ? 1.85 : f.kind === 'promo' ? .92 : f.kind === 'cart' ? .16 : .25;
    let color = f.kind === 'wall' ? 0xd9e5e4 : f.kind === 'promo' ? 0xe9cfa2 : isCheckout ? 0x9fb9c9 : 0xbcccd0;
    const base = addBox(scene, f.w * X_SCALE, h, f.h * X_SCALE, mat(color), p.x, h / 2, p.z, true);
    if (f.kind === 'wall') {
      addBox(scene, f.w * X_SCALE + .05, .06, f.h * X_SCALE + .05, materials.aluminum, p.x, h + .03, p.z);
      for (let k = 0; k < 3; k++) addBox(scene, f.w * X_SCALE * .8, .04, .02, materials.tealEmissive, p.x, .5 + k * .45, p.z - f.h * X_SCALE / 2 - .01);
    }
    if (isCheckout) {
      addBox(scene, f.w * X_SCALE - .1, .03, f.h * X_SCALE - .08, mat(0x385766), p.x, h + .015, p.z);
      addBox(scene, .18, .22, .02, materials.screen, p.x - .2, h + .18, p.z);
      addBox(scene, .12, .05, .1, materials.graphite, p.x + .18, h + .05, p.z);
    }
    if (f.kind === 'promo') {
      for (let k = 0; k < 8; k++) {
        const px = p.x + (rnd(i * 13 + k) - .5) * f.w * X_SCALE * .8;
        const pz = p.z + (rnd(i * 29 + k) - .5) * f.h * X_SCALE * .8;
        addProduct(rnd(i + k) > .5 ? 'box' : 'produce', new THREE.Vector3(px, h + .09, pz),
          [.9, .8, .9], palette[(i + k) % palette.length]);
      }
    }
    if (f.kind === 'cart') {
      for (let k = 0; k < 3; k++) {
        const cp = new THREE.Vector3(p.x + (k - 1) * .55, .3, p.z);
        const cart = makeCart(); cart.position.copy(cp); cart.rotation.y = Math.PI / 2; scene.add(cart);
      }
    }
    if (f.kind === 'entrance' || f.kind === 'exit') {
      for (const side of [-1, 1]) addCylinder(scene, .07, .07, 2.3, materials.aluminum, p.x + side * f.w * X_SCALE / 2, 1.15, p.z, 10);
      addBox(scene, f.w * X_SCALE + .3, .12, .12, materials.tealEmissive, p.x, 2.3, p.z);
    }
    const label = makeLabel(f.label, isCheckout ? '#172C40' : '#ffffff', isCheckout ? '#a6e9dc' : '#335e52', f.label.length > 10 ? .46 : .56);
    label.position.set(p.x, h + .42, p.z); scene.add(label);
  });
  flushProducts();
  const zoneSign = makeLabel('生鲜果蔬  ·  乳制品  ·  冷冻食品  ·  饮品', '#172C40', '#9fe6d8', 1.5);
  zoneSign.position.set(0, 2.75, -floorD / 2 + .18); scene.add(zoneSign);
  [['生鲜与冷藏', -5.5], ['食品杂货', 0], ['家庭日用', 5.5]].forEach(([label, x]) => {
    const sign = makeLabel(label, '#ffffff', '#1c6b5c', .95);
    sign.position.set(x, 1.65, -floorD / 2 + .18); scene.add(sign);
  });

  // ----- robot: 0.62 m wide × 0.82 m long × 0.90 m tall (real proportions) ----
  const robot = tagGroup(new THREE.Group(), 'robot', { id: 'AMR-01', name: 'NEXUS AMR-01' });
  scene.add(robot); pickTargets.push(robot);
  addRounded(robot, .60, .15, .78, .055, materials.graphite, 0, .13, 0, true);
  addRounded(robot, .62, .07, .80, .03, mat(0x1d2b35, { metalness: .45 }), 0, .075, 0, true);
  addRounded(robot, .54, .38, .60, .09, materials.white, 0, .40, 0, true);
  addBox(robot, .55, .025, .61, materials.aluminum, 0, .235, 0);
  addBox(robot, .50, .035, .60, materials.aluminum, 0, .645, 0);      // cargo platform
  for (const side of [-1, 1]) addBox(robot, .022, .055, .58, materials.aluminum, side * .25, .685, 0);
  addBox(robot, .46, .02, .035, materials.aluminum, 0, .685, -.29);
  for (const side of [-1, 1]) addBox(robot, .02, .11, .50, mat(0x8fded0, { emissive: 0x1a8e80, emissiveIntensity: .35 }), side * .275, .48, 0);
  const screenPanel = addBox(robot, .25, .19, .022, materials.screen, 0, .45, -.305);
  screenPanel.rotation.x = -.13;
  for (const x of [-.07, .07]) {
    const lens = addCylinder(robot, .026, .026, .02, materials.dark, x, .585, -.302, 12);
    lens.rotation.x = Math.PI / 2;
  }
  addBox(robot, .58, .08, .055, materials.rubber, 0, .14, -.405);      // safety bumper
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
  addCylinder(robot, .045, .045, .075, materials.graphite, 0, .685, 0, 16); // LiDAR mast
  const lidar = addCylinder(robot, .082, .082, .065, mat(0x26343d, { metalness: .55 }), 0, .755, 0, 24);
  const lidarRing = new THREE.Mesh(new THREE.TorusGeometry(.086, .011, 6, 24), materials.tealEmissive);
  lidarRing.rotation.x = Math.PI / 2; lidarRing.position.set(0, .792, 0); robot.add(lidarRing);
  const statusRing = new THREE.Mesh(new THREE.RingGeometry(.43, .48, 42),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
  statusRing.rotation.x = -Math.PI / 2; statusRing.position.y = .011; robot.add(statusRing);
  // 0.8 m safety buffer visualisation, colour follows behaviour state.
  const safetyRing = new THREE.Mesh(new THREE.RingGeometry(.77, .80, 48),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false }));
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
  }

  // ----- articulated pedestrians -------------------------------------------
  const limbGeometry = {
    upper: new THREE.CylinderGeometry(.048, .055, .32, 8),
    fore: new THREE.CylinderGeometry(.040, .046, .28, 8),
    thigh: new THREE.CylinderGeometry(.066, .072, .40, 8),
    shin: new THREE.CylinderGeometry(.052, .058, .38, 8),
  };
  function makeCart() {
    const cartGroup = new THREE.Group();
    const wire = new THREE.MeshStandardMaterial({ color: 0xa9bec6, metalness: .65, roughness: .35, wireframe: true });
    const basket = addBox(cartGroup, .50, .28, .38, wire, 0, .55, -.20);
    basket.castShadow = false;
    addBox(cartGroup, .50, .025, .05, materials.graphite, 0, .70, -.40);
    for (const x of [-.19, .19]) addCylinder(cartGroup, .012, .012, .42, materials.aluminum, x, .42, -.38, 8);
    for (const x of [-.19, .19]) for (const z of [-.34, -.06]) {
      const w = addCylinder(cartGroup, .055, .055, .035, materials.rubber, x, .055, z, 10);
      w.rotation.z = Math.PI / 2;
    }
    return cartGroup;
  }
  function makePerson(style = 0, color = 0xc47a58, withCart = false) {
    const group = new THREE.Group();
    const coat = personMat(color);
    const trousers = personMat([0x37424b, 0x4b4a45, 0x5a5f66, 0x2f3a45, 0x6b6257][style % 5]);
    const skin = personMat(skinTones[style % skinTones.length]);
    const hair = personMat(hairTones[style % hairTones.length]);
    const shoe = personMat(0x23282c);
    addRounded(group, .40, .50, .23, .075, coat, 0, 1.13, 0, true);          // torso
    addBox(group, .20, .30, .235, personMat(0xf0f2ed), 0, 1.16, -.005);       // shirt
    addCylinder(group, .055, .055, .09, skin, 0, 1.43, 0, 10);                 // neck
    const head = new THREE.Mesh(new THREE.SphereGeometry(.108, 14, 10), skin);
    head.position.set(0, 1.545, 0); head.castShadow = true; group.add(head);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(.113, 14, 10, 0, Math.PI * 2, 0, Math.PI * .58), hair);
    hairCap.position.set(0, 1.565, 0); hairCap.scale.set(1.02, 1, 1.02); group.add(hairCap);
    const arms = [], legs = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(side * .225, 1.34, 0); group.add(shoulder);
      const upper = new THREE.Mesh(limbGeometry.upper, coat); upper.position.y = -.16; upper.castShadow = true; shoulder.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -.32; shoulder.add(elbow);
      const fore = new THREE.Mesh(limbGeometry.fore, skin); fore.position.y = -.14; elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.042, 8, 6), skin); hand.position.y = -.29; elbow.add(hand);
      arms.push({ shoulder, elbow });
      const hip = new THREE.Group(); hip.position.set(side * .11, .86, 0); group.add(hip);
      const thigh = new THREE.Mesh(limbGeometry.thigh, trousers); thigh.position.y = -.20; thigh.castShadow = true; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -.40; hip.add(knee);
      const shin = new THREE.Mesh(limbGeometry.shin, trousers); shin.position.y = -.19; knee.add(shin);
      addBox(knee, .115, .055, .22, shoe, 0, -.37, -.045);
      legs.push({ hip, knee });
    }
    let cart = null;
    if (withCart) { cart = makeCart(); cart.position.set(0, 0, -.62); group.add(cart); }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.20, 16),
      new THREE.MeshBasicMaterial({ color: 0x18332c, transparent: true, opacity: .12, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .006; group.add(shadow);
    tagGroup(group, 'pedestrian', { id: '', state: '' });
    return [group, { arms, legs, cart }];
  }
  const MAX_PEOPLE = 26;
  const people = [];
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const [model, rig] = makePerson(i % 5, [0xc47a58, 0xd7a16c, 0x936b61, 0x5e7f99, 0x9e8a6b][i % 5], i % 4 === 0);
    model.visible = false; scene.add(model); pickTargets.push(model);
    people.push({ model, rig });
  }
  let pedestrianData = [];
  function applyPersonRig(person, data, time) {
    const { arms, legs, cart } = person.rig;
    const walking = ['ENTER_STORE', 'WALK_TO_SECTION', 'WALKING', 'GOING_TO_CHECKOUT', 'EXITING', 'TURNING'].includes(data.state);
    const speedRatio = Math.min(1, (data.speed || 0) / .95);
    const swing = walking ? Math.sin(data.phase || 0) * .62 * speedRatio : Math.sin(time * 1.3 + data.phase) * .035;
    legs[0].hip.rotation.x = swing; legs[1].hip.rotation.x = -swing;
    legs[0].knee.rotation.x = Math.max(0, -swing) * .55; legs[1].knee.rotation.x = Math.max(0, swing) * .55;
    if (cart) {
      arms[0].shoulder.rotation.x = -1.05; arms[1].shoulder.rotation.x = -1.05;
      arms[0].elbow.rotation.x = -.18; arms[1].elbow.rotation.x = -.18;
    } else if (data.state === 'BROWSING') {
      const reach = Math.sin(time * 2.1 + data.phase) * .22;
      arms[0].shoulder.rotation.x = -1.0 + reach; arms[1].shoulder.rotation.x = -.35;
      arms[0].elbow.rotation.x = -.55; arms[1].elbow.rotation.x = -.15;
    } else {
      arms[0].shoulder.rotation.x = -swing * .72; arms[1].shoulder.rotation.x = swing * .72;
      arms[0].elbow.rotation.x = -.08; arms[1].elbow.rotation.x = -.08;
    }
    person.model.userData.pick.id = data.id;
    person.model.userData.pick.state = data.state;
  }
  function setPedestrians(list = []) {
    pedestrianData = list;
    people.forEach((person, i) => {
      const data = list[i];
      person.model.visible = !!data;
      if (!data) return;
      const p = floorPoint([data.x, data.y], 0);
      person.model.position.set(p.x, 0, p.z);
      person.model.rotation.y = -(data.heading || 0); // map heading → world forward (-Z)
      applyPersonRig(person, data, (performance.now() - startedAt) / 1000);
    });
  }

  const crowdZone = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.3),
    new THREE.MeshBasicMaterial({ color: 0xe8a34a, transparent: true, opacity: .27, depthWrite: false, side: THREE.DoubleSide }));
  crowdZone.rotation.x = -Math.PI / 2; crowdZone.position.copy(floorPoint([69, 34], .02)); scene.add(crowdZone);
  const obstacleGroup = new THREE.Group(); scene.add(obstacleGroup);
  const restrictedGroup = new THREE.Group(); scene.add(restrictedGroup);

  // ----- route layers -------------------------------------------------------
  const plannedRoute = new THREE.Group(), originalRoute = new THREE.Group(), traveledRoute = new THREE.Group();
  scene.add(originalRoute, plannedRoute, traveledRoute);
  const pointGroup = new THREE.Group(); scene.add(pointGroup);
  let markers = [];
  function setPickups(pickups, boughtCount = 0) {
    disposeGroup(pointGroup); markers = [];
    pickups.forEach((point, index) => {
      const p = floorPoint(point), group = new THREE.Group(); group.position.set(p.x, 0, p.z); pointGroup.add(group);
      const done = index < boughtCount;
      addCylinder(group, .19, .19, .045, done ? materials.tealEmissive : materials.white, 0, .035, 0, 22);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .014, 6, 24),
        new THREE.MeshBasicMaterial({ color: done ? 0x28B9A4 : 0xffffff }));
      ring.rotation.x = Math.PI / 2; ring.position.y = .06; group.add(ring);
      const label = makeLabel(done ? '✓' : String(index + 1), done ? '#20A995' : '#172C40', '#ffffff', .30);
      label.position.y = .42; group.add(label);
      markers.push({ group });
    });
  }

  // ----- interaction / camera ----------------------------------------------
  let cameraMode = 'iso', presentation = false, pickHandler = null;
  const cameraTarget = new THREE.Vector3(0, .45, 0);
  const desired = new THREE.Vector3();
  function setCameraMode(mode) {
    cameraMode = ['iso', 'follow', 'close'].includes(mode) ? mode : 'iso';
    controls.enabled = cameraMode === 'iso';
    if (cameraMode === 'iso') {
      camera.position.copy(cameraHome); cameraTarget.set(0, .45, 0);
      controls.target.copy(cameraTarget); controls.update();
    }
  }
  function resetCamera() { setCameraMode('iso'); }
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
    safetyRing.material.opacity = urgent ? .42 : state === 'SLOW_DOWN' ? .32 : .18;
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
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(.08, (now - lastFrame) / 1000); lastFrame = now;
    fps = fps ? fps * .92 + (1 / Math.max(.001, dt)) * .08 : 1 / Math.max(.001, dt);
    if (!active || document.hidden || !container.offsetParent) return;
    const time = (now - startedAt) / 1000;
    lidarRing.rotation.z = time * 2.4;
    // 车轮随实际位移旋转；由 app 传入的累计里程驱动。
    for (const wheel of wheelMeshes) wheel.rotation.x = (robot.userData.distance || 0) / .135;
    if (cameraMode !== 'iso') {
      const robotPos = robot.position;
      const angle = robot.rotation.y;
      const offset = cameraMode === 'close' ? new THREE.Vector3(.95, .95, 1.45) : new THREE.Vector3(0, 2.8, 3.8);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      desired.copy(robotPos).add(offset);
      camera.position.lerp(desired, .09);
      cameraTarget.lerp(new THREE.Vector3(robotPos.x, .5, robotPos.z), .12);
      camera.lookAt(cameraTarget);
    } else controls.update();
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
    setRobotState, setPedestrians, setSafety,
    setPickHandler(handler) { pickHandler = typeof handler === 'function' ? handler : null; },
    setScenario(scenario, slot = '09') {
      const peak = scenario === 'peak';
      heatTiles.forEach((tile, i) => {
        const count = shelfCrowd(slot, shelves[i].id);
        tile.material.color.setHex(count >= 5 ? 0xe2734b : count >= 3 ? 0xe8a34a : 0x71b887);
        tile.material.opacity = count >= 5 ? .36 : count >= 3 ? .25 : .12;
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
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
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
