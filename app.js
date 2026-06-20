const money = n => (n === null || n === undefined || n === '') ? 'N/D' : `Bs ${Number(n).toFixed(2).replace('.00','')}`;
const esc = v => String(v ?? '').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
const onlyDigits = v => String(v ?? '').replace(/\D/g, '');
let filtered = [...GUIAS_DATA];
const detailModal = new bootstrap.Modal(document.getElementById('detailModal'));
const PDF_FILE = 'transportadoras.pdf';

const DEPT_IMAGES = {
  'Santa Cruz': 'assets/departamentos/santa-cruz.svg',
  'Cochabamba': 'assets/departamentos/cochabamba.svg',
  'Chuquisaca': 'assets/departamentos/chuquisaca.svg',
  'Tarija': 'assets/departamentos/tarija.svg',
  'Beni': 'assets/departamentos/beni.svg',
  'La Paz': 'assets/departamentos/la-paz.svg',
  'Oruro': 'assets/departamentos/oruro.svg',
  'Potosí': 'assets/departamentos/potosi.svg',
  'Pando': 'assets/departamentos/pando.svg',
  'No identificado': 'assets/departamentos/bolivia.svg'
};

function departamento(text){
  const v = String(text || '').toLowerCase();
  if (/scz|scr|santa cruz|montero|3p|intermodal sucre|bodega sucre/.test(v)) return 'Santa Cruz';
  if (/cbb|cochabamba|beijing|huayna|kapac/.test(v)) return 'Cochabamba';
  if (/sucre|chuquisaca/.test(v)) return 'Chuquisaca';
  if (/tarija|yacuiba|villamontes/.test(v)) return 'Tarija';
  if (/trinidad|beni/.test(v)) return 'Beni';
  if (/la paz|lpz/.test(v)) return 'La Paz';
  if (/oruro|oru/.test(v)) return 'Oruro';
  if (/potos/.test(v)) return 'Potosí';
  if (/pando|cobija/.test(v)) return 'Pando';
  return 'No identificado';
}

function getPhones(row){
  const raw = `${row['Teléfono en guía'] || ''} / ${row['Teléfono adicional encontrado'] || ''}`;
  const matches = raw.match(/\b\d{7,8}\b/g) || [];
  return [...new Set(matches.map(n => n.length === 7 ? n : n).filter(n => n !== '77777777'))];
}
function phoneLinks(row, compact=false){
  const nums = getPhones(row).slice(0, compact ? 1 : 3);
  if (!nums.length) return '<span class="text-muted">N/D</span>';
  return nums.map(n => {
    const full = n.startsWith('591') ? n : `591${n}`;
    return `<span class="phone-actions"><a class="phone-link" href="https://wa.me/${full}" target="_blank" title="Abrir WhatsApp">${esc(n)}</a><a class="call-link" href="tel:+${full}" title="Llamada normal">Llamar</a></span>`;
  }).join('');
}
function deptCard(dept){
  const src = DEPT_IMAGES[dept] || DEPT_IMAGES['No identificado'];
  return `<span class="dept-card"><img src="${esc(src)}" alt="${esc(dept)}"><span>${esc(dept)}</span></span>`;
}

function pdfButton(row){
  const page = Number(row['Página PDF'] || 1);
  return `<a class="btn btn-sm btn-outline-dark" target="_blank" href="${PDF_FILE}#page=${page}">Abrir PDF</a>`;
}

function uniqueDept(field){return [...new Set(GUIAS_DATA.map(x=>departamento(x[field])).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'))}
function unique(field){return [...new Set(GUIAS_DATA.map(x=>x[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'))}
function fillSelect(id, values){const el=document.getElementById(id); values.forEach(v=>{const opt=document.createElement('option'); opt.value=v; opt.textContent=v; el.appendChild(opt);});}

function init(){
  fillSelect('transportadoraFilter', unique('Transportadora'));
  fillSelect('origenFilter', uniqueDept('De dónde parte'));
  fillSelect('destinoFilter', uniqueDept('A dónde va'));
  document.getElementById('origenFilter').value = 'Santa Cruz';
  document.getElementById('kpiGuias').textContent = GUIAS_DATA.length;
  document.getElementById('kpiTransportadoras').textContent = unique('Transportadora').length;
  const prices = GUIAS_DATA.map(x=>Number(x['Precio aprox. (Bs)'])).filter(n=>!isNaN(n));
  document.getElementById('kpiPromedio').textContent = money(prices.reduce((a,b)=>a+b,0)/prices.length);
  ['searchInput','transportadoraFilter','origenFilter','destinoFilter'].forEach(id=>document.getElementById(id).addEventListener('input',applyFilters));
  document.getElementById('clearBtn').addEventListener('click',()=>{['searchInput','transportadoraFilter','destinoFilter'].forEach(id=>document.getElementById(id).value='');document.getElementById('origenFilter').value='Santa Cruz';applyFilters();});
  document.getElementById('exportCsv').addEventListener('click',exportCSV);
  renderSummary(); applyFilters();
}
function renderSummary(){
  const container=document.getElementById('summaryCards');
  container.innerHTML = RESUMEN_DATA.slice(0,12).map(r=>`
    <div class="col-md-6 col-xl-4">
      <div class="card summary-card shadow-sm">
        <div class="card-body">
          <div class="d-flex justify-content-between gap-2 align-items-start mb-2">
            <h6 class="fw-bold mb-0">${esc(r.Transportadora)}</h6>
            <span class="badge badge-soft">${esc(r['Cantidad guías'])} guías</span>
          </div>
          <div class="small text-muted mb-2 text-truncate-2">${esc(r['Dirección complementaria'])}</div>
          <div class="d-flex justify-content-between small"><span>Rango:</span><strong>${money(r['Precio mínimo'])} - ${money(r['Precio máximo'])}</strong></div>
          <div class="d-flex justify-content-between small"><span>Promedio:</span><strong>${money(r['Precio promedio'])}</strong></div>
        </div>
      </div>
    </div>`).join('');
}
function applyFilters(){
  const q=document.getElementById('searchInput').value.toLowerCase().trim();
  const t=document.getElementById('transportadoraFilter').value;
  const o=document.getElementById('origenFilter').value;
  const d=document.getElementById('destinoFilter').value;
  filtered=GUIAS_DATA.filter(x=>{
    const origenDept = departamento(x['De dónde parte']);
    const destinoDept = departamento(x['A dónde va']);
    const text=Object.values(x).join(' ').toLowerCase() + ' ' + origenDept.toLowerCase() + ' ' + destinoDept.toLowerCase();
    return (!q || text.includes(q)) && (!t || x.Transportadora===t) && (!o || origenDept===o) && (!d || destinoDept===d);
  });
  renderTable();
}
function renderTable(){
  document.getElementById('resultCount').textContent = `(${filtered.length} resultados)`;
  document.getElementById('tableBody').innerHTML = filtered.map((x,i)=>{
    const origenDept = departamento(x['De dónde parte']);
    const destinoDept = departamento(x['A dónde va']);
    return `
    <tr>
      <td><strong>${esc(x.Transportadora)}</strong></td>
      <td><div class="route-wrap">${deptCard(origenDept)}<span class="route-arrow">a</span>${deptCard(destinoDept)}</div></td>
      <td><span class="text-truncate-2">${esc(x['Qué llevó aprox.'])}</span></td>
      <td><span class="price-pill">${money(x['Precio aprox. (Bs)'])}</span></td>
      <td>${phoneLinks(x, true)}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-primary" onclick="showDetail(${GUIAS_DATA.indexOf(x)})">Ver</button>
        ${pdfButton(x)}
        ${x['Google Maps'] ? `<a class="btn btn-sm btn-outline-success btn-map" target="_blank" href="${esc(x['Google Maps'])}">Maps</a>` : ''}
      </td>
    </tr>`}).join('');
}
function showDetail(index){
  const x=GUIAS_DATA[index];
  const origenDept = departamento(x['De dónde parte']);
  const destinoDept = departamento(x['A dónde va']);
  document.getElementById('detailTitle').textContent = `${x.Transportadora} · Guía ${x['N° guía / referencia']}`;
  const fields = [
    ['Página PDF',x['Página PDF']],['Fecha',x.Fecha],['Teléfonos rápidos',phoneLinks(x)],['Origen registrado',x['De dónde parte']],['Departamento origen',origenDept],
    ['Destino registrado',x['A dónde va']],['Departamento destino',destinoDept],['Producto aproximado',x['Qué llevó aprox.']],['Precio',money(x['Precio aprox. (Bs)'])],
    ['Dirección literal',x['Dirección literal en guía']],['Dirección complementaria',x['Dirección complementaria encontrada']],['Fuente',x['Fuente web teléfono/dirección']],['Observaciones',x.Observaciones]
  ];
  document.getElementById('detailBody').innerHTML = `<div class="dept-hero mb-3">${deptCard(origenDept)}<span>Destino</span>${deptCard(destinoDept)}</div><div class="row g-3">${fields.map(([k,v])=>`<div class="col-md-6"><div class="detail-box"><div class="modal-label">${esc(k)}</div><div>${k==='Teléfonos rápidos'?v:esc(v||'N/D')}</div></div></div>`).join('')}</div><div class="mt-3 d-flex flex-wrap gap-2">${pdfButton(x)}${x['Google Maps']?`<a class="btn btn-success" target="_blank" href="${esc(x['Google Maps'])}">Abrir ubicación en Google Maps</a>`:''}</div>`;
  detailModal.show();
}
function exportCSV(){
  const headers=Object.keys(GUIAS_DATA[0]).concat(['Departamento origen','Departamento destino']);
  const csv=[headers.join(',')].concat(filtered.map(row=>headers.map(h=>{
    const val = h === 'Departamento origen' ? departamento(row['De dónde parte']) : h === 'Departamento destino' ? departamento(row['A dónde va']) : row[h];
    return `"${String(val??'').replaceAll('"','""')}"`;
  }).join(','))).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download='transportadoras_filtrado.csv'; a.click(); URL.revokeObjectURL(url);
}
init();
