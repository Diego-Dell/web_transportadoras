const API = {
  async request(url, options = {}) {
    const response = await fetch(url, options);
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
    return payload;
  },
  get(url) { return this.request(url); },
  post(url, data) {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },
  patch(url, data) {
    return this.request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
};

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const money = value => `Bs ${Number(value || 0).toFixed(2)}`;
const tipoLabel = value => value === 'transportadora' ? 'Transportadora' : 'Cliente Santa Cruz';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function escapeAttr(value = '') { return escapeHtml(value); }
function cleanPhone(value) { return String(value || '').replace(/\D/g, '').replace(/^591/, ''); }
function waLink(value) { const digits = cleanPhone(value); return digits ? `https://wa.me/591${digits}` : '#'; }
function telLink(value) { const digits = cleanPhone(value); return digits ? `tel:+591${digits}` : '#'; }
function mapsLink(url, address = '') {
  if (url && /^https?:\/\//i.test(String(url))) return String(url);
  const query = String(address || '').trim();
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '#';
}

async function authGuard() {
  return API.get('/api/me').catch(() => { location.href = '/sistema/login.html'; });
}

function nav(active = '', user = null) {
  const isDriver = user && (String(user.username).toLowerCase() === 'kevin' || user.role === 'driver');
  document.body.insertAdjacentHTML('afterbegin', `
<nav class="navbar navbar-expand-lg navbar-dark app-navbar sticky-top">
  <div class="container-fluid px-3 px-lg-4">
    <a class="navbar-brand fw-bold d-flex align-items-center gap-2" href="/sistema/index.html">
      <img class="app-logo" src="/assets/androidpc.png" alt="Android PC">
      <span>Sistema de Envios</span>
    </a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMenu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="navMenu">
      <ul class="navbar-nav me-auto mb-2 mb-lg-0 gap-lg-1">
        <li class="nav-item"><a class="nav-link ${active === 'dashboard' ? 'active' : ''}" href="/sistema/index.html">Dashboard</a></li>
        <li class="nav-item"><a class="nav-link ${active === 'nuevo' ? 'active' : ''}" href="/sistema/envios.html">Registrar envio</a></li>
        ${isDriver ? `<li class="nav-item"><a class="nav-link ${active === 'kevin' ? 'active' : ''}" href="/sistema/kevin.html">Modo al volante</a></li>` : ''}
        <li class="nav-item"><a class="nav-link ${active === 'historial' ? 'active' : ''}" href="/sistema/historial.html">Historial</a></li>
        <li class="nav-item"><a class="nav-link ${active === 'transportadoras' ? 'active' : ''}" href="/sistema/transportadoras.html">Transportadoras</a></li>
        <li class="nav-item"><a class="nav-link" href="/impresion.html">Impresión</a></li>
      </ul>
      <div class="d-flex flex-column flex-lg-row gap-2 align-items-lg-center">
        ${user ? `<span class="user-chip">${escapeHtml(user.username)}</span>` : ''}
        <a class="btn btn-outline-light btn-sm" href="/sistema/pin.html">Cambiar PIN</a>
        <button class="btn btn-light btn-sm" onclick="logout()">Salir</button>
      </div>
    </div>
  </div>
</nav>`);
}

async function setupPage(active = '') {
  const me = await authGuard();
  nav(active, me.user);
  return me.user;
}

async function logout() {
  await API.post('/api/logout', {});
  location.href = '/sistema/login.html';
}

function toast(message, type = 'success') {
  let box = $('#toastBox');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', '<div id="toastBox" class="toast-container position-fixed bottom-0 end-0 p-3"></div>');
    box = $('#toastBox');
  }
  const id = `toast-${Date.now()}`;
  box.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert">
      <div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>
    </div>`);
  new bootstrap.Toast(document.getElementById(id)).show();
}

function initSignature(canvasId = 'firma', onChange = () => {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let drawing = false;
  let hasInk = false;
  let strokeCount = 0;
  let ratio = 1;

  function configureContext() {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.6;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
  }

  function resize(preserve = false) {
    const rectangle = canvas.getBoundingClientRect();
    if (rectangle.width < 40 || rectangle.height < 40) return false;
    const previous = preserve && hasInk ? canvas.toDataURL('image/png') : '';
    ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(rectangle.width * ratio);
    canvas.height = Math.round(rectangle.height * ratio);
    configureContext();
    if (previous) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rectangle.width, rectangle.height);
      image.src = previous;
    }
    return true;
  }

  function point(event) {
    const rectangle = canvas.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  }

  function start(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (!canvas.width || !canvas.height) resize(false);
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    context.lineTo(current.x + 0.15, current.y + 0.15);
    context.stroke();
    if (!hasInk) {
      hasInk = true;
      onChange(true, strokeCount);
    }
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  function end(event) {
    if (!drawing) return;
    drawing = false;
    strokeCount += 1;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
    onChange(hasInk, strokeCount);
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', event => {
    if (drawing && event.pointerType === 'mouse') end(event);
  });

  const observer = new ResizeObserver(() => {
    if (canvas.offsetParent !== null) resize(hasInk);
  });
  observer.observe(canvas);

  return {
    resize,
    clear() {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      configureContext();
      drawing = false;
      hasInk = false;
      strokeCount = 0;
      onChange(false, 0);
    },
    isEmpty() { return !hasInk; },
    strokes() { return strokeCount; },
    data() { return hasInk ? canvas.toDataURL('image/png') : ''; },
    destroy() { observer.disconnect(); }
  };
}

function emptyState(title, text) {
  return `<div class="empty-state"><div class="empty-icon"></div><h5>${escapeHtml(title)}</h5><p>${escapeHtml(text)}</p></div>`;
}

function statusBadge(status) {
  const colors = { pendiente: 'warning', entregado: 'success', en_camino: 'primary' };
  return `<span class="badge rounded-pill text-bg-${colors[status] || 'secondary'}">${escapeHtml(status || 'pendiente')}</span>`;
}

async function resolveMapPreview(url, address = '') {
  const query = new URLSearchParams({ url: String(url || ''), address: String(address || '') });
  return API.get(`/api/maps/preview?${query.toString()}`);
}

async function hydrateMapPreview(container, url, address) {
  if (!container) return;
  container.innerHTML = `
    <div class="map-loading d-flex align-items-center justify-content-center gap-2">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      <span>Cargando ubicación</span>
    </div>`;
  try {
    const preview = await resolveMapPreview(url, address);
    if (!preview.embedUrl) throw new Error(preview.warning || 'No se encontró una ubicación válida');
    container.innerHTML = `<iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Vista previa del destino" src="${escapeAttr(preview.embedUrl)}"></iframe>`;
    container.dataset.openUrl = preview.openUrl || mapsLink(url, address);
  } catch (error) {
    container.innerHTML = `
      <div class="map-error text-center p-4">
        <div class="fw-bold mb-1">No se pudo cargar la vista previa</div>
        <div class="small text-secondary">${escapeHtml(error.message)}</div>
      </div>`;
  }
}
