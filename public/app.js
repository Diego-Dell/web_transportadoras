const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    return r.json();
  },
  async patch(url, data) {
    const r = await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    return r.json();
  }
};
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const money = n => `Bs ${Number(n||0).toFixed(2)}`;
const tipoLabel = t => t === 'transportadora' ? 'Transportadora' : 'Cliente Santa Cruz';
function cleanPhone(n){ return String(n||'').replace(/\D/g,'').replace(/^591/,''); }
function waLink(n){ const d=cleanPhone(n); return d?`https://wa.me/591${d}`:'#'; }
function telLink(n){ const d=cleanPhone(n); return d?`tel:+591${d}`:'#'; }
function mapsLink(url){ return url && String(url).startsWith('http') ? url : '#'; }
async function authGuard(){ return API.get('/api/me').catch(()=> location.href='/login.html'); }
function nav(active='', user=null){
  const isDriver = user && (user.username === 'kevin1' || user.role === 'driver');
  document.body.insertAdjacentHTML('afterbegin', `
<nav class="navbar navbar-expand-lg navbar-dark app-navbar sticky-top">
  <div class="container-fluid px-3 px-lg-4">
    <a class="navbar-brand fw-bold d-flex align-items-center gap-2" href="/index.html"><span class="brand-mark">SE</span><span>Sistema de Envios</span></a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMenu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="navMenu">
      <ul class="navbar-nav me-auto mb-2 mb-lg-0 gap-lg-1">
        <li class="nav-item"><a class="nav-link ${active==='dashboard'?'active':''}" href="/index.html">Dashboard</a></li>
        <li class="nav-item"><a class="nav-link ${active==='nuevo'?'active':''}" href="/envios.html">Registrar envio</a></li>
        ${isDriver ? `<li class="nav-item"><a class="nav-link ${active==='kevin'?'active':''}" href="/kevin.html">Modo al volante</a></li>` : ''}
        <li class="nav-item"><a class="nav-link ${active==='historial'?'active':''}" href="/historial.html">Historial</a></li>
        <li class="nav-item"><a class="nav-link ${active==='transportadoras'?'active':''}" href="/transportadoras.html">Transportadoras</a></li>
      </ul>
      <div class="d-flex flex-column flex-lg-row gap-2 align-items-lg-center">
        ${user ? `<span class="user-chip">${user.username}</span>` : ''}
        <a class="btn btn-outline-light btn-sm" href="/pin.html">Cambiar PIN</a>
        <button class="btn btn-light btn-sm" onclick="logout()">Salir</button>
      </div>
    </div>
  </div>
</nav>`);
}
async function setupPage(active=''){
  const me = await authGuard();
  nav(active, me.user);
  return me.user;
}
async function logout(){ await API.post('/api/logout',{}); location.href='/login.html'; }
function toast(msg, cls='success'){
  let box=$('#toastBox'); if(!box){ document.body.insertAdjacentHTML('beforeend','<div id="toastBox" class="toast-container position-fixed bottom-0 end-0 p-3"></div>'); box=$('#toastBox'); }
  const id='t'+Date.now(); box.insertAdjacentHTML('beforeend',`<div id="${id}" class="toast align-items-center text-bg-${cls} border-0" role="alert"><div class="d-flex"><div class="toast-body">${msg}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`);
  new bootstrap.Toast($('#'+id)).show();
}
function initSignature(canvasId='firma'){
  const c = document.getElementById(canvasId); if(!c) return null;
  const ctx = c.getContext('2d'); let drawing=false;
  function scale(){ const ratio = window.devicePixelRatio || 1; const rect=c.getBoundingClientRect(); c.width=rect.width*ratio; c.height=rect.height*ratio; ctx.scale(ratio,ratio); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#111827'; }
  setTimeout(scale, 50);
  function pos(e){ const r=c.getBoundingClientRect(); const p=e.touches?e.touches[0]:e; return {x:p.clientX-r.left,y:p.clientY-r.top}; }
  function start(e){ drawing=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); }
  function move(e){ if(!drawing)return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); }
  function end(){ drawing=false; }
  ['mousedown','touchstart'].forEach(ev=>c.addEventListener(ev,start,{passive:false}));
  ['mousemove','touchmove'].forEach(ev=>c.addEventListener(ev,move,{passive:false}));
  ['mouseup','mouseleave','touchend'].forEach(ev=>c.addEventListener(ev,end));
  return { clear(){ctx.clearRect(0,0,c.width,c.height)}, data(){return c.toDataURL('image/png')} };
}
function emptyState(title, text){
  return `<div class="empty-state"><div class="empty-icon"></div><h5>${title}</h5><p>${text}</p></div>`;
}
function statusBadge(s){
  const map={pendiente:'warning', entregado:'success', en_camino:'primary'};
  return `<span class="badge rounded-pill text-bg-${map[s]||'secondary'}">${s||'pendiente'}</span>`;
}
