const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const TZ = process.env.TIMEZONE || 'America/La_Paz';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const files = {
  usuarios: path.join(DATA_DIR, 'usuarios.json'),
  envios: path.join(DATA_DIR, 'envios.json'),
  transportadoras: path.join(DATA_DIR, 'transportadoras.json')
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Error leyendo JSON:', file, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${rnd}`;
}

function onlyDigits(v = '') {
  return String(v).replace(/\D/g, '');
}

const mapPreviewCache = new Map();

function isAllowedMapHost(hostname = '') {
  const host = String(hostname).toLowerCase();
  return host === 'goo.gl' || host === 'maps.app.goo.gl' || host === 'maps.google.com' || host === 'www.google.com' || host.endsWith('.google.com');
}

function extractMapQuery(rawUrl = '') {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    const candidates = ['q', 'query', 'destination', 'daddr', 'll'];
    for (const key of candidates) {
      const value = url.searchParams.get(key);
      if (value) return decodeURIComponent(value.replace(/\+/g, ' '));
    }
    const decoded = decodeURIComponent(url.href);
    let match = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (match) return `${match[1]},${match[2]}`;
    match = decoded.match(/\/place\/([^/?#]+)/i);
    if (match) return match[1].replace(/\+/g, ' ');
  } catch (_) {}
  return '';
}

async function resolveMapPreview(rawUrl = '', address = '') {
  const inputUrl = String(rawUrl || '').trim();
  const fallbackAddress = String(address || '').trim();
  const cacheKey = `${inputUrl}|${fallbackAddress}`;
  if (mapPreviewCache.has(cacheKey)) return mapPreviewCache.get(cacheKey);

  let finalUrl = inputUrl;
  let query = '';
  let warning = '';

  if (inputUrl) {
    try {
      const parsed = new URL(inputUrl);
      if (!isAllowedMapHost(parsed.hostname)) throw new Error('El enlace no pertenece a Google Maps');
      query = extractMapQuery(inputUrl);
      if (!query) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6500);
        try {
          const response = await fetch(inputUrl, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 SistemaEnvios/1.0' }
          });
          finalUrl = response.url || inputUrl;
          const finalParsed = new URL(finalUrl);
          if (!isAllowedMapHost(finalParsed.hostname)) throw new Error('Redirección de Maps no válida');
          query = extractMapQuery(finalUrl);
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      warning = error.name === 'AbortError' ? 'No se pudo resolver el enlace corto a tiempo' : error.message;
    }
  }

  query = query || fallbackAddress;
  const result = {
    ok: Boolean(query),
    query,
    openUrl: inputUrl || (query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : ''),
    resolvedUrl: finalUrl,
    embedUrl: query ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed` : '',
    warning
  };
  mapPreviewCache.set(cacheKey, result);
  if (mapPreviewCache.size > 200) mapPreviewCache.delete(mapPreviewCache.keys().next().value);
  return result;
}

function saveSignatureDataUrl(dataUrl, envioId) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Formato de firma inválido');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 300) throw new Error('La firma está vacía');
  const dir = path.join(UPLOADS_DIR, 'firmas');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${envioId}-${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/firmas/${filename}`;
}

function initData() {
  if (!fs.existsSync(files.usuarios)) {
    const users = (process.env.DEFAULT_USERS || 'kamil,soledad,dell,mikela,benjamin,rodrigo,Kevin')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(username => ({
        id: newId('USR'),
        username,
        pinHash: bcrypt.hashSync(process.env.DEFAULT_PIN || '123456', 10),
        role: username.toLowerCase() === 'kevin' ? 'driver' : 'worker',
        active: true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }));
    writeJson(files.usuarios, users);
  }
  if (!fs.existsSync(files.envios)) writeJson(files.envios, []);
  if (!fs.existsSync(files.transportadoras)) {
    writeJson(files.transportadoras, [
      { nombre: 'El Mexicano', telefono: '', direccion: 'Av. Intermodal Sucre / Terminal Bimodal', maps: '', departamento: 'Sucre' },
      { nombre: 'Auto Transportes Tupiza I', telefono: '63777533', direccion: 'Av. Intermodal esquina Hernando Siles, Barrio Villa Victoria, Bodega 2, Santa Cruz', maps: '', departamento: 'Tarija' },
      { nombre: 'AmazonExpress SRL', telefono: '', direccion: 'Av. Intermodal y Calle Hernando Siles, Hotel Emperador, Santa Cruz', maps: '', departamento: 'Cochabamba' },
      { nombre: 'Transportes Lupiana', telefono: '', direccion: 'Av. Uruguay, Zona Avaroa', maps: '', departamento: 'Cochabamba' },
      { nombre: 'Transporte La Querida S.R.L.', telefono: '', direccion: 'Av. Interradial y Daniel Salamanca', maps: '', departamento: 'Yacuiba' },
      { nombre: 'Trans Divino Niño SCZ TDD S.R.L.', telefono: '78029649', direccion: 'Santa Cruz / Trinidad', maps: '', departamento: 'Beni' },
      { nombre: 'Linea Sindical Chino Bus', telefono: '', direccion: 'Av. Parque Industrial liviano, Terminal A, Santa Cruz', maps: '', departamento: 'Santa Cruz' },
      { nombre: 'El Dorado', telefono: '', direccion: 'Terminal Intermodal, Santa Cruz', maps: '', departamento: 'La Paz' },
      { nombre: 'M.E.M. 1', telefono: '', direccion: 'Intermodal / Beijing', maps: '', departamento: 'Cochabamba' },
      { nombre: 'Linea Sindical Flota Cosmos', telefono: '79913728', direccion: 'Canada / Terminal', maps: '', departamento: 'Santa Cruz' }
    ]);
  }
}
initData();

function migrateUsers() {
  const users = readJson(files.usuarios, []);
  let changed = false;
  users.forEach(u => {
    if (String(u.username).toLowerCase() === 'kevin1') {
      u.username = 'Kevin';
      u.role = 'driver';
      u.updatedAt = nowIso();
      changed = true;
    }
    if (String(u.username).toLowerCase() === 'kevin') {
      u.username = 'Kevin';
      u.role = 'driver';
      changed = true;
    }
  });
  if (!users.some(u => String(u.username).toLowerCase() === 'kevin')) {
    users.push({
      id: newId('USR'),
      username: 'Kevin',
      pinHash: bcrypt.hashSync(process.env.DEFAULT_PIN || '123456', 10),
      role: 'driver',
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    changed = true;
  }
  if (changed) writeJson(files.usuarios, users);
}
migrateUsers();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));
app.get('/sistema', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/sistema/index.html');
  return res.redirect('/sistema/login.html');
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
  next();
}

function requireDriver(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
  if (req.session.user.username.toLowerCase() !== 'kevin' && req.session.user.role !== 'driver') {
    return res.status(403).json({ error: 'Solo Kevin puede usar el modo al volante' });
  }
  next();
}

app.get('/health', (req, res) => res.json({ ok: true, app: process.env.APP_NAME || 'Sistema de Envios' }));

app.post('/api/login', async (req, res) => {
  const { username, pin } = req.body;
  const users = readJson(files.usuarios, []);
  const user = users.find(u => u.username === username && u.active);
  if (!user || !(await bcrypt.compare(String(pin || ''), user.pinHash))) {
    return res.status(401).json({ error: 'Usuario o PIN incorrecto' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

app.post('/api/change-pin', requireAuth, async (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!/^\d{4,8}$/.test(String(newPin || ''))) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 8 números' });
  const users = readJson(files.usuarios, []);
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!(await bcrypt.compare(String(currentPin || ''), users[idx].pinHash))) return res.status(400).json({ error: 'PIN actual incorrecto' });
  users[idx].pinHash = bcrypt.hashSync(String(newPin), 10);
  users[idx].updatedAt = nowIso();
  writeJson(files.usuarios, users);
  res.json({ ok: true });
});

app.get('/api/transportadoras', requireAuth, (req, res) => res.json(readJson(files.transportadoras, [])));

app.get('/api/maps/preview', requireAuth, async (req, res) => {
  try {
    const result = await resolveMapPreview(req.query.url || '', req.query.address || '');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo generar la vista previa' });
  }
});

app.post('/api/transportadoras', requireAuth, (req, res) => {
  const items = readJson(files.transportadoras, []);
  const body = req.body;
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
  let item = items.find(t => t.nombre.toLowerCase() === nombre.toLowerCase());
  if (item) Object.assign(item, body);
  else items.push({ nombre, telefono: body.telefono || '', direccion: body.direccion || '', maps: body.maps || '', departamento: body.departamento || '' });
  writeJson(files.transportadoras, items);
  res.json({ ok: true, items });
});

app.get('/api/driver/envios', requireDriver, (req, res) => {
  let envios = readJson(files.envios, []);
  envios = envios.filter(e => e.estado !== 'entregado');
  res.json(envios.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
});

app.get('/api/envios', requireAuth, (req, res) => {
  let envios = readJson(files.envios, []);
  const { desde, hasta, usuario, estado, tipo } = req.query;
  if (desde) envios = envios.filter(e => String(e.fecha || '').slice(0, 10) >= desde);
  if (hasta) envios = envios.filter(e => String(e.fecha || '').slice(0, 10) <= hasta);
  if (usuario) envios = envios.filter(e => e.creadoPor === usuario);
  if (estado) envios = envios.filter(e => e.estado === estado);
  if (tipo) envios = envios.filter(e => e.tipoEnvio === tipo);
  res.json(envios.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

app.post('/api/envios', requireAuth, (req, res) => {
  const envios = readJson(files.envios, []);
  const b = req.body;
  const envio = {
    id: newId('ENV'),
    codigo: `ENV-${String(envios.length + 1).padStart(5, '0')}`,
    fecha: b.fecha || dayjs().format('YYYY-MM-DD'),
    creadoPor: req.session.user.username,
    creadoPorId: req.session.user.id,
    tipoEnvio: b.tipoEnvio || 'santa_cruz',
    estado: 'pendiente',
    cliente: b.cliente || '',
    celularCliente: onlyDigits(b.celularCliente || ''),
    producto: b.producto || '',
    cantidad: Number(b.cantidad || 1),
    precioUnitario: Number(b.precioUnitario || 0),
    total: Number(b.total || 0),
    formaPago: b.formaPago || '',
    origen: b.origen || 'Santa Cruz',
    destinoDepartamento: b.destinoDepartamento || 'Santa Cruz',
    direccionLiteral: b.direccionLiteral || '',
    googleMaps: b.googleMaps || '',
    transportadoraNombre: b.transportadoraNombre || '',
    transportadoraTelefono: onlyDigits(b.transportadoraTelefono || ''),
    transportadoraDireccion: b.transportadoraDireccion || '',
    transportadoraMaps: b.transportadoraMaps || '',
    observaciones: b.observaciones || '',
    firmaCliente: '',
    entregadoAt: '',
    entregadoPor: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  envios.push(envio);
  writeJson(files.envios, envios);
  res.json({ ok: true, envio });
});

app.patch('/api/envios/:id', requireAuth, (req, res) => {
  const envios = readJson(files.envios, []);
  const idx = envios.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Envio no encontrado' });
  Object.assign(envios[idx], req.body, { updatedAt: nowIso() });
  writeJson(files.envios, envios);
  res.json({ ok: true, envio: envios[idx] });
});

app.post('/api/envios/:id/entregar', requireDriver, (req, res) => {
  const envios = readJson(files.envios, []);
  const idx = envios.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Envio no encontrado' });
  if (Number(req.body.strokeCount || 0) < 1) return res.status(400).json({ error: 'El cliente debe firmar antes de completar la entrega' });
  try {
    const signaturePath = saveSignatureDataUrl(req.body.firmaCliente, envios[idx].id);
    envios[idx].estado = 'entregado';
    envios[idx].firmaCliente = signaturePath;
    envios[idx].firmaTrazos = Number(req.body.strokeCount || 0);
    envios[idx].entregadoAt = nowIso();
    envios[idx].entregadoPor = req.session.user.username;
    envios[idx].updatedAt = nowIso();
    writeJson(files.envios, envios);
    res.json({ ok: true, envio: envios[idx] });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo guardar la firma' });
  }
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const envios = readJson(files.envios, []);
  const today = dayjs().format('YYYY-MM-DD');
  const startWeek = dayjs().startOf('week').format('YYYY-MM-DD');
  const by = key => envios.reduce((acc, e) => { const k = e[key] || 'Sin dato'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const totalMonto = envios.reduce((s, e) => s + Number(e.total || 0), 0);
  res.json({
    total: envios.length,
    hoy: envios.filter(e => String(e.fecha).slice(0, 10) === today).length,
    semana: envios.filter(e => String(e.fecha).slice(0, 10) >= startWeek).length,
    pendientes: envios.filter(e => e.estado !== 'entregado').length,
    entregados: envios.filter(e => e.estado === 'entregado').length,
    totalMonto,
    porUsuario: by('creadoPor'),
    porEstado: by('estado'),
    porTipo: by('tipoEnvio'),
    recientes: envios.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
  });
});

function buildPdf(envios, title) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 28,
      size: 'A4',
      layout: 'landscape',
      info: { Title: title, Author: 'Sistema de Envios Android PC' }
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 28;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const usableWidth = pageWidth - margin * 2;
    const cardHeight = 94;
    const cardGap = 10;
    let cursorY = 0;
    let pageNumber = 1;

    const clean = value => String(value ?? '').trim() || 'N/D';
    const moneyText = value => `Bs ${Number(value || 0).toFixed(2)}`;

    function drawHeader() {
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(18)
        .text(title, margin, 25, { width: usableWidth * 0.7 });
      doc.fillColor('#64748b').font('Helvetica').fontSize(8.5)
        .text(`Generado: ${dayjs().format('YYYY-MM-DD HH:mm')} | Sistema de Envios`, margin, 50, { width: usableWidth });
      doc.moveTo(margin, 66).lineTo(pageWidth - margin, 66).strokeColor('#d1d5db').lineWidth(1).stroke();
      cursorY = 78;
    }

    function drawFooter() {
      doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
        .text(`Pagina ${pageNumber}`, margin, pageHeight - 24, { width: usableWidth, align: 'right' });
    }

    function addPage() {
      drawFooter();
      doc.addPage({ size: 'A4', layout: 'landscape', margin });
      pageNumber += 1;
      drawHeader();
    }

    function drawSummary() {
      const totalMonto = envios.reduce((sum, envio) => sum + Number(envio.total || 0), 0);
      const pendientes = envios.filter(envio => envio.estado !== 'entregado').length;
      const entregados = envios.filter(envio => envio.estado === 'entregado').length;
      const values = [
        ['Total envios', envios.length],
        ['Pendientes', pendientes],
        ['Entregados', entregados],
        ['Monto total', moneyText(totalMonto)]
      ];
      const top = cursorY;
      const gap = 10;
      const width = (usableWidth - gap * 3) / 4;

      values.forEach(([label, value], index) => {
        const x = margin + index * (width + gap);
        doc.roundedRect(x, top, width, 48, 7).fillAndStroke('#f8fafc', '#dbe3ee');
        doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7)
          .text(String(label).toUpperCase(), x + 10, top + 10, { width: width - 20, height: 10 });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
          .text(String(value), x + 10, top + 26, { width: width - 20, height: 16 });
      });
      cursorY = top + 62;
    }

    function drawField(label, value, x, y, width, options = {}) {
      doc.fillColor('#6b7280').font('Helvetica-Bold').fontSize(6.5)
        .text(String(label).toUpperCase(), x, y, { width, height: 9 });
      doc.fillColor('#111827').font('Helvetica').fontSize(options.fontSize || 8.5)
        .text(clean(value), x, y + 10, {
          width,
          height: options.height || 19,
          ellipsis: true,
          lineGap: 1,
          link: options.link || undefined,
          underline: Boolean(options.link)
        });
    }

    function drawShipment(envio, index) {
      if (cursorY + cardHeight > pageHeight - 36) addPage();

      const top = cursorY;
      const left = margin;
      doc.roundedRect(left, top, usableWidth, cardHeight, 8).fillAndStroke('#ffffff', '#d6dee8');

      const clientName = envio.cliente || envio.transportadoraNombre || 'Sin cliente';
      const code = envio.codigo || envio.id || `ENV-${index + 1}`;
      const status = String(envio.estado || 'pendiente').toUpperCase();
      const statusColor = envio.estado === 'entregado' ? '#166534' : envio.estado === 'en_camino' ? '#1d4ed8' : '#92400e';

      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10.5)
        .text(`${index + 1}. ${clean(code)}  ${clean(clientName)}`, left + 12, top + 10, { width: usableWidth - 130, height: 16, ellipsis: true });
      doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(7.5)
        .text(status, left + usableWidth - 110, top + 12, { width: 96, align: 'right', height: 12 });

      const row1Y = top + 34;
      drawField('Fecha', envio.fecha, left + 12, row1Y, 76);
      drawField('Usuario', envio.creadoPor, left + 96, row1Y, 78);
      drawField('Tipo', envio.tipoEnvio === 'transportadora' ? 'Transportadora' : 'Santa Cruz', left + 182, row1Y, 96);
      drawField('Celular', envio.celularCliente || envio.transportadoraTelefono, left + 286, row1Y, 92);
      drawField('Total', moneyText(envio.total), left + 386, row1Y, 82);
      drawField('Destino', envio.destinoDepartamento, left + 476, row1Y, 110);

      const row2Y = top + 63;
      drawField('Producto', envio.producto, left + 12, row2Y, 175, { height: 18 });
      drawField('Direccion', envio.direccionLiteral || envio.transportadoraDireccion, left + 197, row2Y, 345, { height: 18, fontSize: 8 });

      const mapUrl = envio.googleMaps || envio.transportadoraMaps || '';
      drawField('Google Maps', mapUrl ? 'Abrir ubicacion' : 'N/D', left + 552, row2Y, usableWidth - 564, {
        height: 18,
        link: mapUrl || undefined,
        fontSize: 8
      });

      cursorY = top + cardHeight + cardGap;
    }

    drawHeader();
    drawSummary();

    if (!envios.length) {
      doc.fillColor('#6b7280').font('Helvetica').fontSize(11)
        .text('No hay envios para el rango seleccionado.', margin, cursorY + 20, { width: usableWidth, align: 'center' });
    } else {
      envios.forEach(drawShipment);
    }

    drawFooter();
    doc.end();
  });
}

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  let envios = readJson(files.envios, []);
  const { desde, hasta, usuario, estado, tipo } = req.query;
  if (desde) envios = envios.filter(e => String(e.fecha || '').slice(0, 10) >= desde);
  if (hasta) envios = envios.filter(e => String(e.fecha || '').slice(0, 10) <= hasta);
  if (usuario) envios = envios.filter(e => e.creadoPor === usuario);
  if (estado) envios = envios.filter(e => e.estado === estado);
  if (tipo) envios = envios.filter(e => e.tipoEnvio === tipo);
  const pdf = await buildPdf(envios, 'Reporte de envios');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-envios-${dayjs().format('YYYYMMDD-HHmm')}.pdf"`);
  res.send(pdf);
});

async function sendWeeklyReport() {
  const emails = String(process.env.REPORT_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!emails.length || !process.env.SMTP_USER || !process.env.SMTP_PASS || String(process.env.SMTP_PASS).includes('TU_')) return;
  const envios = readJson(files.envios, []);
  const start = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
  const end = dayjs().format('YYYY-MM-DD');
  const filtered = envios.filter(e => String(e.fecha || '').slice(0, 10) >= start && String(e.fecha || '').slice(0, 10) <= end);
  const pdf = await buildPdf(filtered, `Reporte semanal de envios ${start} a ${end}`);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Sistema de Envios'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: emails.join(','),
    subject: `Reporte semanal de envios - ${end}`,
    priority: process.env.REPORT_IMPORTANT === 'true' ? 'high' : 'normal',
    text: `Adjunto reporte semanal de envios. Total: ${filtered.length}`,
    attachments: [{ filename: `reporte-semanal-${end}.pdf`, content: pdf }]
  });
}

const reportTime = process.env.REPORT_TIME || '18:00';
const [h, m] = reportTime.split(':').map(Number);
cron.schedule(`${m || 0} ${h || 18} * * 6`, () => sendWeeklyReport().catch(e => console.error('Error reporte semanal:', e.message)), { timezone: TZ });

app.listen(PORT, () => console.log(`Sistema de envios activo en puerto ${PORT}`));
