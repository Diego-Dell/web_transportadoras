const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const TZ = process.env.TIMEZONE || 'America/La_Paz';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
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

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

if (IS_PRODUCTION) app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(session({
  store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 1000 * 60 * 60 * 12 }
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

app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, pin } = req.body;
  const user = await db.findUserByUsername(username);
  if (!user || !(await bcrypt.compare(String(pin || ''), user.pinHash))) {
    return res.status(401).json({ error: 'Usuario o PIN incorrecto' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ ok: true, user: req.session.user });
}));

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

app.post('/api/change-pin', requireAuth, asyncRoute(async (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!/^\d{4,8}$/.test(String(newPin || ''))) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 8 números' });
  const user = await db.findUserById(req.session.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!(await bcrypt.compare(String(currentPin || ''), user.pinHash))) return res.status(400).json({ error: 'PIN actual incorrecto' });
  await db.updateUserPin(user.id, bcrypt.hashSync(String(newPin), 10));
  res.json({ ok: true });
}));

app.get('/api/transportadoras', requireAuth, asyncRoute(async (req, res) => {
  res.json(await db.getTransportadoras());
}));

app.get('/api/maps/preview', requireAuth, async (req, res) => {
  try {
    const result = await resolveMapPreview(req.query.url || '', req.query.address || '');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo generar la vista previa' });
  }
});

app.post('/api/transportadoras', requireAuth, asyncRoute(async (req, res) => {
  const body = req.body;
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
  const items = await db.upsertTransportadora({
    nombre, telefono: body.telefono || '', direccion: body.direccion || '', maps: body.maps || '', departamento: body.departamento || ''
  });
  res.json({ ok: true, items });
}));

app.get('/api/driver/envios', requireDriver, asyncRoute(async (req, res) => {
  const envios = await db.getEnvios({ excludeEstado: 'entregado', orderAsc: true });
  res.json(envios);
}));

app.get('/api/envios', requireAuth, asyncRoute(async (req, res) => {
  const { desde, hasta, usuario, estado, tipo } = req.query;
  const envios = await db.getEnvios({ desde, hasta, usuario, estado, tipo });
  res.json(envios);
}));

app.post('/api/envios', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body;
  const count = await db.countEnvios();
  const envio = await db.createEnvio({
    id: db.newId('ENV'),
    codigo: `ENV-${String(count + 1).padStart(5, '0')}`,
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
    observaciones: b.observaciones || ''
  });
  res.json({ ok: true, envio });
}));

app.patch('/api/envios/:id', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.getEnvioById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Envio no encontrado' });
  const envio = await db.patchEnvio(req.params.id, req.body);
  res.json({ ok: true, envio });
}));

app.post('/api/envios/:id/entregar', requireDriver, asyncRoute(async (req, res) => {
  const existing = await db.getEnvioById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Envio no encontrado' });
  if (Number(req.body.strokeCount || 0) < 1) return res.status(400).json({ error: 'El cliente debe firmar antes de completar la entrega' });
  try {
    const signaturePath = saveSignatureDataUrl(req.body.firmaCliente, existing.id);
    const envio = await db.entregarEnvio(existing.id, {
      firmaCliente: signaturePath,
      firmaTrazos: Number(req.body.strokeCount || 0),
      entregadoPor: req.session.user.username
    });
    res.json({ ok: true, envio });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo guardar la firma' });
  }
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  res.json(await db.getDashboardStats());
}));

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

app.get('/api/export/pdf', requireAuth, asyncRoute(async (req, res) => {
  const { desde, hasta, usuario, estado, tipo } = req.query;
  const envios = await db.getEnvios({ desde, hasta, usuario, estado, tipo });
  const pdf = await buildPdf(envios, 'Reporte de envios');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-envios-${dayjs().format('YYYYMMDD-HHmm')}.pdf"`);
  res.send(pdf);
}));

async function sendWeeklyReport() {
  const emails = String(process.env.REPORT_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!emails.length || !process.env.SMTP_USER || !process.env.SMTP_PASS || String(process.env.SMTP_PASS).includes('TU_')) return;
  const start = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
  const end = dayjs().format('YYYY-MM-DD');
  const filtered = await db.getEnvios({ desde: start, hasta: end });
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

db.init()
  .then(() => {
    app.listen(PORT, () => console.log(`Sistema de envios activo en puerto ${PORT}`));
  })
  .catch(error => {
    console.error('No se pudo inicializar la base de datos:', error.message);
    process.exit(1);
  });
