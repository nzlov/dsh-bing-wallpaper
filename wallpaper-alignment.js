export function wallpaperGeometry(viewportWidth, viewportHeight, imageWidth, imageHeight) {
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const vw = positive(viewportWidth, 1), vh = positive(viewportHeight, 1);
  const iw = positive(imageWidth, 1920), ih = positive(imageHeight, 1080);
  const scale = Math.max(vw / iw, vh / ih), width = iw * scale, height = ih * scale;
  return { width, height, x: (vw - width) / 2, y: (vh - height) / 2 };
}

// Use viewport pixels rather than fixed backgrounds: transformed dock hosts
// and mobile drawers otherwise establish their own background coordinates.
export function alignWallpaper({ document, window, surfaces, imageWidth, imageHeight, mountBackground }) {
  const root = document.documentElement, targets = new Set(), saved = new Map(), moving = new Map(), backgrounds = new Map();
  let frame = 0, dirty = true, disposed = false;
  const now = () => window.performance.now();
  function write(element, key, value) {
    let properties = saved.get(element);
    if (!properties) saved.set(element, properties = new Map());
    if (!properties.has(key)) properties.set(key, { value: element.style.getPropertyValue(key), priority: element.style.getPropertyPriority(key) });
    const previous = properties.get(key);
    if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
    previous.applied = value;
  }
  function restore(element) {
    for (const [key, previous] of saved.get(element) || []) {
      if (element.style.getPropertyValue(key) !== previous.applied) continue;
      if (previous.value) element.style.setProperty(key, previous.value, previous.priority);
      else element.style.removeProperty(key);
    }
    saved.delete(element);
  }
  function measure() {
    if (dirty) {
      dirty = false;
      const next = new Set(document.querySelectorAll(surfaces));
      for (const target of targets) if (!next.has(target)) {
        resize?.unobserve(target); targets.delete(target); moving.delete(target); restore(target);
        const layer = backgrounds.get(target);
        if (layer) { resize?.unobserve(layer); layer.remove(); backgrounds.delete(target); }
      }
      for (const target of next) if (!targets.has(target)) {
        targets.add(target); resize?.observe(target);
        const layer = mountBackground?.(target);
        if (layer) { backgrounds.set(target, layer); resize?.observe(layer); }
      }
    }
    const geometry = wallpaperGeometry(window.innerWidth, window.innerHeight, imageWidth, imageHeight);
    write(root, '--bdt-wallpaper-size', `${geometry.width}px ${geometry.height}px`);
    write(root, '--bdt-wallpaper-x', `${geometry.x}px`);
    write(root, '--bdt-wallpaper-y', `${geometry.y}px`);
    // Read all boxes before writing styles, including panes in the same split.
    const boxes = [...targets].map(target => [target, (backgrounds.get(target) || target).getBoundingClientRect()]);
    for (const [target, box] of boxes) {
      // Measure the actual painting layer, including fractional dock borders.
      write(target, '--bdt-wallpaper-x', `${geometry.x - box.left}px`);
      write(target, '--bdt-wallpaper-y', `${geometry.y - box.top}px`);
    }
  }
  function tick() {
    frame = 0;
    if (disposed) return;
    measure();
    for (const [target, deadline] of moving) {
      if (!target.isConnected || now() >= deadline || target.getAnimations?.().every(animation => animation.playState !== 'running')) moving.delete(target);
    }
    if (moving.size) schedule();
  }
  function schedule() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(tick);
  }
  const resize = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(schedule) : null;
  const mutations = typeof window.MutationObserver === 'function' ? new window.MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && (node.matches('[data-slot="sidebar"],[data-sidebar-right-panel],[data-dockkit-host],[data-dockkit-pane],[data-dockkit-empty]')
        || node.querySelector('[data-slot="sidebar"],[data-sidebar-right-panel],[data-dockkit-host],[data-dockkit-pane],[data-dockkit-empty]'))))) {
      dirty = true; schedule();
    }
  }) : null;
  const transition = event => {
    if (!/(width|height|inset|left|right|top|bottom|transform|grid-template)/.test(event.propertyName)) return;
    const target = event.target;
    if (!target.matches(`${surfaces},[data-sidebar-right-panel],[data-dockkit-host="dock"],div:has(> [data-shell-overlay])`)) return;
    // getAnimations ends the loop with the transition; the deadline also bounds
    // older browsers and elements removed before transitionend can fire.
    if (event.type === 'transitionrun') moving.set(target, now() + 5000);
    schedule();
  };
  let dragging = false;
  const down = event => { dragging = Boolean(event.target.closest?.('[data-dockkit-strip],[data-dockkit-divider]')); };
  const move = () => { if (dragging) schedule(); };
  const up = () => { if (dragging) { dragging = false; schedule(); } };
  const events = [
    ['resize', schedule], ['scroll', schedule], ['transitionrun', transition], ['transitionend', transition], ['transitioncancel', transition],
    ['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['blur', up],
  ];
  for (const [name, listener] of events) window.addEventListener(name, listener, true);
  mutations?.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    // Retained tabs/sessions change markers or hidden state without adding DOM.
    attributeFilter: ['data-sidebar-drawer', 'data-sidebar-right-panel', 'data-sidebar-right-open', 'data-dockkit-pane', 'data-dockkit-host', 'data-dockkit-empty', 'hidden'],
  });
  resize?.observe(root);
  measure();
  return () => {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    for (const [name, listener] of events) window.removeEventListener(name, listener, true);
    resize?.disconnect(); mutations?.disconnect();
    for (const layer of backgrounds.values()) layer.remove();
    for (const element of [...saved.keys()]) restore(element);
    targets.clear(); moving.clear(); backgrounds.clear();
  };
}
