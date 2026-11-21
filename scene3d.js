// NEXUS RETAIL — modular 3D store, premium AMR and route visualisation.
// All geometry is generated from storeData.js; no paid or external 3D assets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STORE, shelves, layoutFixtures, peopleForScenario, shelfCrowd, zoneName } from './storeData.js';

const X_SCALE = .17;
const floorPoint = ([x, y], height = .025) => new THREE.Vector3((x - STORE.width / 2) * X_SCALE, height, (STORE.height / 2 - y) * X_SCALE);
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, metalness: .05, ...options });
const rnd = i => { const v = Math.sin(i * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };
const palette = [0x20A995, 0x3D7BD6, 0xE8A34A, 0xD96C68, 0x7A9E4B, 0x8E6FB0, 0xD9A05B, 0x5C8CA8, 0xC46F5E, 0x6BA98F];

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

function roundedBoxGeometry(w, h, d, r) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
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
      setActive: noop, resize: noop, setPresentation: noop };
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

  // ----- shell: floor, walls, ceiling ---------------------------------------
  const floorW = STORE.width * X_SCALE + .6, floorD = STORE.height * X_SCALE + .6;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture('tile'), roughness: .82, metalness: .03 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wallMat = mat(0xe9efec, { roughness: .9 });
  addBox(scene, floorW, 3.5, .14, wallMat, 0, 1.75, -floorD / 2, true);
  addBox(scene, .14, 3.5, floorD, wallMat, -floorW / 2, 1.75, 0, true);
  addBox(scene, .14, 3.5, floorD, wallMat, floorW / 2, 1.75, 0, true);
  addBox(scene, floorW, .16, .16, mat(0x9db4ae), 0, .12, -floorD / 2 + .1);
  addBox(scene, .16, .16, floorD, mat(0x9db4ae), -floorW / 2 + .1, .12, 0);
  addBox(scene, .16, .16, floorD, mat(0x9db4ae), floorW / 2 - .1, .12, 0);
  // ceiling light panels (no heavy rails: keeps the top-down view legible)
  const lightPanelMat = new THREE.MeshBasicMaterial({ color: 0xf2fbf5 });
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
    const panel = addBox(scene, 1.5, .015, .22, lightPanelMat, j * 5.4, 3.32, i * 2.75);
    panel.castShadow = false;
  }
  // zone floor patches
  function floorPatch(x, y, w, h, kind, color) {
    const p = floorPoint([x, y], .012);
    const texture = floorTexture(kind);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * X_SCALE, h * X_SCALE),
      new THREE.MeshStandardMaterial({ map: texture, color, roughness: .85 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(p.x, .008, p.z); mesh.receiveShadow = true; scene.add(mesh);
  }
  floorPatch(29.5, 65.5, 15, 13, 'wood', 0xffffff);
  floorPatch(11, 18, 9, 9, 'stone', 0xffe9c8);
  floorPatch(11, 66, 9, 9, 'stone', 0xffe9c8);
  floorPatch(129, 35, 8, 8, 'stone', 0xffe9c8);
  floorPatch(13, 3, 12, 4, 'tile', 0xd8e4e6);
  for (const x of STORE.aisleXs) {
    const p = floorPoint([x, 45]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(.95, 12.8),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf7fbf8, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .006, p.z); scene.add(runner);
  }
  for (const y of STORE.crossYs) {
    const p = floorPoint([70, y]);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(21.6, .95),
      new THREE.MeshStandardMaterial({ map: floorTexture('tile'), color: 0xf7fbf8, roughness: .72 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(p.x, .007, p.z); scene.add(runner);
  }

  // ----- instanced low-poly products ----------------------------------------
  const buckets = new Map();
  const shapeGeometries = {
    box: new THREE.BoxGeometry(.23, .26, .18),
    bottle: new THREE.CylinderGeometry(.058, .066, .29, 9),
    can: new THREE.CylinderGeometry(.07, .07, .16, 10),
    bag: new THREE.BoxGeometry(.21, .23, .1),
    produce: new THREE.IcosahedronGeometry(.115, 0),
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

  const heatTiles = [];
  shelves.forEach((shelf, index) => {
    const w = (shelf.xMax - shelf.xMin) * X_SCALE - .12;
    const d = (shelf.yMax - shelf.yMin) * X_SCALE - .12;
    const center = floorPoint([(shelf.xMin + shelf.xMax) / 2, (shelf.yMin + shelf.yMax) / 2]);
    const group = new THREE.Group(); group.position.set(center.x, 0, center.z); scene.add(group);
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
    const shelvesCount = levels.length;
    const perRow = Math.max(3, Math.floor((w - .3) / .34));
    for (let level = 0; level < shelvesCount; level++) {
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
          else if (shelf.kind === 'cooler') shape = pick < .34 ? 'bottle' : pick < .58 ? 'can' : 'box';
          else shape = pick < .22 ? 'bag' : pick < .42 ? 'can' : pick < .56 ? 'bottle' : 'box';
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

  // ----- fixtures ------------------------------------------------------------
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
        addBox(scene, .42, .28, .3, new THREE.MeshStandardMaterial({ color: 0x9eb4bc, wireframe: true }), cp.x, cp.y, cp.z);
      }
    }
    if (f.kind === 'entrance' || f.kind === 'exit') {
      for (const side of [-1, 1]) addCylinder(scene, .07, .07, 2.3, materials.aluminum, p.x + side * f.w * X_SCALE / 2, 1.15, p.z, 10);
      addBox(scene, f.w * X_SCALE + .3, .12, .12, materials.tealEmissive, p.x, 2.3, p.z);
    }
    const label = makeLabel(f.label, isCheckout ? '#172C40' : '#ffffff', isCheckout ? '#a6e9dc' : '#335e52', f.label.length > 10 ? .46 : .56);
    label.position.set(p.x, h + .42, p.z); scene.add(label);
  });
  flushProducts(); // promo products were queued after the first flush
  const zoneSign = makeLabel('生鲜果蔬  ·  乳制品  ·  冷冻食品  ·  饮品', '#172C40', '#9fe6d8', 1.5);
  zoneSign.position.set(0, 2.75, -floorD / 2 + .18); scene.add(zoneSign);
  [['生鲜与冷藏', -5.5], ['食品杂货', 0], ['家庭日用', 5.5]].forEach(([label, x]) => {
    const sign = makeLabel(label, '#ffffff', '#1c6b5c', .95);
    sign.position.set(x, 1.65, -floorD / 2 + .18); scene.add(sign);
  });

  // ----- robot: premium AMR --------------------------------------------------
  const robot = new THREE.Group(); scene.add(robot);
  const chassis = addRounded(robot, .94, .23, .68, .075, materials.graphite, 0, .19, 0, true);
  addRounded(robot, .8, .44, .56, .1, materials.white, 0, .5, 0, true);
  addBox(robot, .81, .035, .57, materials.aluminum, 0, .35, 0);
  addBox(robot, .68, .035, .44, materials.aluminum, 0, .73, 0);
  for (const side of [-1, 1]) addBox(robot, .035, .09, .42, materials.aluminum, side * .35, .78, 0);
  addBox(robot, .88, .09, .07, materials.rubber, 0, .16, -.36);
  addBox(robot, .88, .09, .07, materials.rubber, 0, .16, .36);
  const screenPanel = addBox(robot, .29, .19, .025, materials.screen, 0, .57, -.295);
  screenPanel.rotation.x = -.12;
  const cameraLens = addCylinder(robot, .045, .045, .03, materials.dark, 0, .42, -.3, 14);
  cameraLens.rotation.x = Math.PI / 2;
  for (const x of [-.3, .3]) for (const z of [-.32, .32]) addSphereSensor(robot, x, .21, z);
  function addSphereSensor(parent, x, y, z) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), materials.rubber);
    s.position.set(x, y, z); parent.add(s);
  }
  for (const side of [-1, 1]) {
    const wheel = addCylinder(robot, .145, .145, .1, materials.rubber, side * .47, .17, -.05, 18);
    wheel.rotation.z = Math.PI / 2;
    const hub = addCylinder(robot, .075, .075, .105, materials.aluminum, side * .49, .17, -.05, 16);
    hub.rotation.z = Math.PI / 2;
  }
  for (const z of [-.3, .3]) for (const side of [-1, 1]) {
    const caster = addCylinder(robot, .06, .06, .045, materials.rubber, side * .32, .065, z, 12);
    caster.rotation.z = Math.PI / 2;
  }
  const lidar = addCylinder(robot, .095, .095, .07, materials.graphite, 0, .79, 0, 24);
  const lidarRing = new THREE.Mesh(new THREE.TorusGeometry(.1, .012, 6, 24), materials.tealEmissive);
  lidarRing.rotation.x = Math.PI / 2; lidarRing.position.set(0, .83, 0); robot.add(lidarRing);
  const statusBar = addBox(robot, .48, .03, .025, materials.tealEmissive, 0, .3, -.35);
  const statusRing = new THREE.Mesh(new THREE.RingGeometry(.53, .61, 42),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
  statusRing.rotation.x = -Math.PI / 2; statusRing.position.y = .011; robot.add(statusRing);
  const robotTag = makeLabel('NEXUS AMR-01', '#172C40', '#8ce5d5', .58);
  robotTag.position.y = 1.16; robot.add(robotTag);
  // stronger teal status halo on the floor
  const robotHalo = new THREE.Mesh(new THREE.RingGeometry(.66, .74, 44),
    new THREE.MeshBasicMaterial({ color: 0x28B9A4, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
  robotHalo.rotation.x = -Math.PI / 2; robotHalo.position.y = .009; robot.add(robotHalo);
  robot.scale.setScalar(1.5);
  robot.position.copy(floorPoint(STORE.entrance, 0));
  let robotState = 'idle';
  const stateColor = { idle: 0x28B9A4, moving: 0x28B9A4, turning: 0x3D7BD6, picking: 0xE8A34A,
    blocked: 0xE8A34A, charging: 0x3D7BD6, error: 0xD96C68 };
  function setRobotState(next) {
    robotState = stateColor[next] ? next : 'idle';
    const color = stateColor[robotState];
    statusBar.material = new THREE.MeshBasicMaterial({ color });
    statusRing.material.color.setHex(color);
    lidarRing.material = new THREE.MeshBasicMaterial({ color });
  }

  // ----- people, cart, dynamic obstacles ------------------------------------
  function makePerson(color) {
    const group = new THREE.Group();
    addCylinder(group, .115, .16, .42, mat(color), 0, .61, 0, 10);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.125, 12, 9), mat(0xe3b894));
    head.position.y = .94; group.add(head);
    addCylinder(group, .05, .045, .38, mat(0x6b7780), -.08, .2, 0, 8);
    addCylinder(group, .05, .045, .38, mat(0x6b7780), .08, .2, 0, 8);
    return group;
  }
  const people = Array.from({ length: 32 }, (_, i) => {
    const p = makePerson([0xc47a58, 0xd7a16c, 0x936b61, 0x5e7f99][i % 4]);
    p.scale.setScalar(1.18);
    scene.add(p); return p;
  });
  const cart = new THREE.Group(); scene.add(cart);
  addBox(cart, .5, .24, .36, new THREE.MeshStandardMaterial({ color: 0xa9bec6, wireframe: true }), 0, .4, 0);
  for (const x of [-.19, .19]) for (const z of [-.13, .13]) addCylinder(cart, .045, .045, .05, materials.graphite, x, .22, z, 9);
  const crowdZone = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.3),
    new THREE.MeshBasicMaterial({ color: 0xe8a34a, transparent: true, opacity: .27, depthWrite: false, side: THREE.DoubleSide }));
  crowdZone.rotation.x = -Math.PI / 2; crowdZone.position.copy(floorPoint([69, 34], .02)); scene.add(crowdZone);
  const obstacleGroup = new THREE.Group(); scene.add(obstacleGroup);
  const restrictedGroup = new THREE.Group(); scene.add(restrictedGroup);

  // ----- route layers --------------------------------------------------------
  const plannedRoute = new THREE.Group(), originalRoute = new THREE.Group(), traveledRoute = new THREE.Group();
  scene.add(originalRoute, plannedRoute, traveledRoute);
  const pointGroup = new THREE.Group(); scene.add(pointGroup);
  let markers = [];
  function setPickups(pickups, boughtCount = 0) {
    disposeGroup(pointGroup); markers = [];
    pickups.forEach((point, index) => {
      const p = floorPoint(point), group = new THREE.Group(); group.position.set(p.x, 0, p.z); pointGroup.add(group);
      const done = index < boughtCount;
      const disc = addCylinder(group, .26, .26, .055, done ? materials.tealEmissive : materials.white, 0, .04, 0, 22);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.3, .016, 6, 24),
        new THREE.MeshBasicMaterial({ color: done ? 0x28B9A4 : 0xffffff }));
      ring.rotation.x = Math.PI / 2; ring.position.y = .075; group.add(ring);
      const label = makeLabel(done ? '✓' : String(index + 1), done ? '#20A995' : '#172C40', '#ffffff', .34);
      label.position.y = .52; group.add(label);
      markers.push({ group, disc, label, ring });
    });
  }

  // ----- camera modes --------------------------------------------------------
  let cameraMode = 'iso', presentation = false;
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

  // ----- resize / render -----------------------------------------------------
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
  function frame() {
    requestAnimationFrame(frame);
    if (!active || document.hidden || !container.offsetParent) return;
    const time = (performance.now() - startedAt) / 1000;
    lidarRing.rotation.z = time * 2.4;
    people.forEach((person, i) => { if (person.visible) person.position.y = Math.sin(time * 2 + i) * .012; });
    robot.position.y = Math.sin(time * 4) * .008 + (robotState === 'blocked' ? Math.sin(time * 16) * .004 : 0);
    if (cameraMode !== 'iso') {
      const robotPos = robot.position;
      const angle = robot.rotation.y;
      const offset = cameraMode === 'close' ? new THREE.Vector3(1.5, 1.25, 2.1) : new THREE.Vector3(0, 3.1, 4.4);
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
    setRobot(point, state) {
      const next = floorPoint(point, 0);
      const dx = next.x - robot.position.x, dz = next.z - robot.position.z;
      if (Math.hypot(dx, dz) > .004) robot.rotation.y = Math.atan2(-dx, -dz);
      robot.position.x = next.x; robot.position.z = next.z;
      if (state) setRobotState(state);
    },
    setRobotState,
    setScenario(scenario, slot = '09') {
      const peak = scenario === 'peak';
      const positions = peopleForScenario(scenario, slot);
      heatTiles.forEach((tile, i) => {
        const count = shelfCrowd(slot, shelves[i].id);
        tile.material.color.setHex(count >= 5 ? 0xe2734b : count >= 3 ? 0xe8a34a : 0x71b887);
        tile.material.opacity = count >= 5 ? .36 : count >= 3 ? .25 : .12;
      });
      people.forEach((person, i) => {
        person.visible = i < positions.length;
        if (person.visible) {
          const p = floorPoint(positions[i].point, 0);
          person.position.set(p.x, 0, p.z);
        }
      });
      crowdZone.visible = peak;
      const cp = floorPoint(peak ? [69, 34] : [116, 81], 0);
      cart.position.set(cp.x, 0, cp.z);
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
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const length = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(length, .04, .18),
          new THREE.MeshBasicMaterial({ color: 0xD96C68, transparent: true, opacity: .8 }));
        bar.position.copy(floorPoint(mid, .06));
        bar.rotation.y = Math.atan2(p2.x - p1.x, p2.z - p1.z) + Math.PI / 2;
        restrictedGroup.add(bar);
      });
    },
    setCameraMode, resetCamera,
    setActive(value) { active = !!value; },
    setPresentation(value) { presentation = !!value; renderer.domElement.style.cursor = presentation ? 'none' : 'grab'; },
    resize,
  };
}
