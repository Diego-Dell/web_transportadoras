const API = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error((await r.json()).error || 'Error'); return r.json(); },
  async post(url, data) { const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); if (!r.ok) throw new Error((await r.json()).error || 'Error'); return r.json(); },
  async patch(url, data) { const r = await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); if (!r.ok) throw new Error((await r.json()).error || 'Error'); return r.json(); }
};
const $ = s => document.querySelector(s);
const money = n => `Bs ${Number(n||0).toFixed(2)}`;
function waLink(n){ const d=String(n||'').replace(/\D/g,''); return d?`https://wa.me/591${d.replace(/^591/,'')}`:'#'; }
function telLink(n){ const d=String(n||'').replace(/\D/g,''); return d?`tel:+591${d.replace(/^591/,'')}`:'#'; }
function mapsLink(url){ return url && url.startsWith('http') ? url : '#'; }
function authGuard(){ return API.get('/api/me').catch(()=> location.href='/login.html'); }
function nav(active=''){
  document.body.insertAdjacentHTML('afterbegin', `
<nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">
  <div class="container-fluid">
    <a class="navbar-brand fw-bold" href="/">Sistema de Envios</a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMenu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="navMenu">
      <ul class="navbar-nav me-auto mb-2 mb-lg-0">
        <li class="nav-item"><a class="nav-link ${active==='dashboard'?'active':''}" href="/index.html">Dashboard</a></li>
        <li class="nav-item"><a class="nav-link ${active==='nuevo'?'active':''}" href="/envios.html">Registrar envio</a></li>
        <li class="nav-item"><a class="nav-link ${active==='kevin'?'active':''}" href="/kevin.html">Modo al volante</a></li>
        <li class="nav-item"><a class="nav-link ${active==='historial'?'active':''}" href="/historial.html">Historial</a></li>
        <li class="nav-item"><a class="nav-link ${active==='transportadoras'?'active':''}" href="/transportadoras.html">Transportadoras</a></li>
      </ul>
      <div class="d-flex gap-2">
        <a class="btn btn-outline-light btn-sm" href="/pin.html">Cambiar PIN</a>
        <button class="btn btn-danger btn-sm" onclick="logout()">Salir</button>
      </div>
    </div>
  </div>
</nav>`);
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
  function pos(e){ const r=c.getBoundingClientRect(); const p=e.touches?e.touches[0]:e; return {x:p.clientX-r.left,y:p.clientY-r.top}; }
  function start(e){ drawing=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); }
  function move(e){ if(!drawing)return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.lineWidth=2; ctx.lineCap='round'; ctx.stroke(); e.preventDefault(); }
  function end(){ drawing=false; }
  ['mousedown','touchstart'].forEach(ev=>c.addEventListener(ev,start,{passive:false}));
  ['mousemove','touchmove'].forEach(ev=>c.addEventListener(ev,move,{passive:false}));
  ['mouseup','mouseleave','touchend'].forEach(ev=>c.addEventListener(ev,end));
  return { clear(){ctx.clearRect(0,0,c.width,c.height)}, data(){return c.toDataURL('image/png')} };
}
