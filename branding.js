// NEXUS RETAIL V2.1 — 品牌与机器人素材统一替换接口。
// 用户后续提供正式渲染图时，只需修改这里的文件名/路径，不需要改任何页面组件。
// 注意：这些是界面说明图，不冒充 3D 实时模型；3D 场景中的机器人始终由 Three.js 实时渲染。
export const BRAND_ASSETS = Object.freeze({
  logo:     './assets/brand/logo.png',
  logoMark: './assets/brand/logo-mark.png',
  robotFront: './assets/brand/amr-front.jpg',
  robotSide:  './assets/brand/amr-side.jpg',
  robotBack:  './assets/brand/amr-back.jpg',
  robotFace:  './assets/brand/amr-face.jpg',
  heroVisual: './assets/brand/paper-logo-4.jpg',
  controlVisual: './assets/brand/amr-control.jpg',
});

/** 把所有带 data-brand 的 <img> 指向统一素材表（单一替换点）。 */
export function applyBrandAssets(root = document) {
  root.querySelectorAll('img[data-brand]').forEach(img => {
    const key = img.dataset.brand;
    if (BRAND_ASSETS[key]) img.src = BRAND_ASSETS[key];
  });
  const favicon = root.querySelector('link[rel="icon"][data-brand]');
  if (favicon && BRAND_ASSETS[favicon.dataset.brand]) favicon.href = BRAND_ASSETS[favicon.dataset.brand];
}

/** 机器人控制页：按机器人编号切换展示视图（1=正面，2=侧视）。 */
export function updateBrandRobotImage(root = document, index = 0) {
  const img = root.querySelector('#robotPortraitImg');
  if (!img) return;
  const key = index % 2 === 0 ? 'controlVisual' : 'robotSide';
  if (img.dataset.brand !== key) { img.dataset.brand = key; img.src = BRAND_ASSETS[key]; }
}
