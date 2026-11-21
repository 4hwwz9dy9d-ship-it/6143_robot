// NEXUS RETAIL — 视图路由、2D/3D 切换与演示模式。
// 任务逻辑全部保留在 app.js，本文件只负责应用外壳的协调。
(() => {
  const titles = {
    overview: '总览',
    order: '订单管理',
    inventory: '库存管理',
    analytics: '零售分析',
    supermarket: '3D 超市',
    robot: '机器人控制中心',
    route: '路径优化',
    simulation: '仿真中心',
    research: '研究方法',
  };
  const panels = new Map(Object.keys(titles).map(name => [name, document.getElementById(`view-${name}`)]));
  const navButtons = [...document.querySelectorAll('[data-view]')];
  const titleNode = document.getElementById('activeViewTitle');
  const modeButtons = [document.getElementById('viewModeBtn'), document.getElementById('viewModeBtn2')];
  let mode = '3d';
  let presentation = false;

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(`nexus:${name}`, { detail }));
  }

  function showView(name, updateHash = true) {
    if (!panels.has(name)) name = 'overview';
    for (const [key, panel] of panels) panel.hidden = key !== name;
    navButtons.forEach(button => {
      const active = button.dataset.view === name;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    titleNode.textContent = titles[name];
    if (updateHash) history.replaceState(null, '', `#${name}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
    emit('viewchange', { name });
  }

  function setViewMode(next) {
    mode = next === '2d' ? '2d' : '3d';
    modeButtons.forEach(button => {
      if (!button) return;
      button.textContent = mode === '2d' ? '3D 场景' : '2D 地图';
      button.setAttribute('aria-pressed', String(mode === '2d'));
      button.classList.toggle('is-active', mode === '2d');
    });
    const label = document.getElementById('sceneModeLabel');
    if (label) label.textContent = mode === '2d' ? '2D 导航地图' : '3D 门店视图';
    emit('viewmode', { mode });
  }

  function toggleViewMode() { setViewMode(mode === '3d' ? '2d' : '3d'); }

  function setPresentation(on) {
    presentation = !!on;
    document.body.classList.toggle('presentation', presentation);
    const button = document.getElementById('presentationBtn');
    if (button) button.textContent = presentation ? '退出演示' : '演示模式';
    if (presentation) showView('supermarket', false);
    emit('presentation', { active: presentation });
  }

  navButtons.forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.getElementById('headerOrderBtn')?.addEventListener('click', () => showView('order'));
  modeButtons.forEach(button => button?.addEventListener('click', toggleViewMode));
  document.getElementById('presentationBtn')?.addEventListener('click', () => setPresentation(!presentation));
  document.getElementById('presentationExitBtn')?.addEventListener('click', () => setPresentation(false));
  document.getElementById('fullscreenBtn')?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { console.warn('全屏不可用：', error.message); }
  });
  document.getElementById('btnOverviewOrder')?.addEventListener('click', () => showView('order'));
  document.getElementById('btnOverview3D')?.addEventListener('click', () => showView('supermarket'));
  document.getElementById('btnOverviewPresentation')?.addEventListener('click', () => setPresentation(true));
  document.getElementById('btnPreviewOpen')?.addEventListener('click', () => showView('supermarket'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && presentation) setPresentation(false);
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1), false));
  showView(location.hash.slice(1), false);
  setViewMode('3d');

  window.NEXUS_UI = { showView, setViewMode, toggleViewMode, setPresentation, get mode() { return mode; }, get presentation() { return presentation; }, emit };
})();
