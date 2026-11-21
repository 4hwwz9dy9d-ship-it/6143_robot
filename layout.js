// NEXUS RETAIL — view routing, 2D/3D mode and presentation mode.
// All task logic stays in app.js; this file only coordinates the shell.
(() => {
  const titles = {
    overview: 'Overview',
    order: 'Order Management',
    inventory: 'Inventory Management',
    analytics: 'Retail Analytics',
    supermarket: '3D Supermarket',
    robot: 'Robot Control Center',
    route: 'Route Optimization',
    simulation: 'Simulation Center',
    research: 'Research & Methodology',
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
      button.textContent = mode === '2d' ? '3D SCENE' : '2D MAP';
      button.setAttribute('aria-pressed', String(mode === '2d'));
      button.classList.toggle('is-active', mode === '2d');
    });
    const label = document.getElementById('sceneModeLabel');
    if (label) label.textContent = mode === '2d' ? '2D NAVIGATION MAP' : '3D STORE VIEW';
    emit('viewmode', { mode });
  }

  function toggleViewMode() { setViewMode(mode === '3d' ? '2d' : '3d'); }

  function setPresentation(on) {
    presentation = !!on;
    document.body.classList.toggle('presentation', presentation);
    const button = document.getElementById('presentationBtn');
    if (button) button.textContent = presentation ? 'Exit presentation' : 'Presentation';
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
    } catch (error) { console.warn('Fullscreen unavailable:', error.message); }
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
