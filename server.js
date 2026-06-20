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

function initData() {
  if (!fs.existsSync(files.usuarios)) {
    const users = (process.env.DEFAULT_USERS || 'kamil,soledad,dell,mikela,benjamin,rodrigo,kevin1')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(username => ({
        id: newId('USR'),
        username,
        pinHash: bcrypt.hashSync(process.env.DEFAULT_PIN || '123456', 10),
        role: username === 'kevin1' ? 'driver' : 'worker',
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
  if (req.session.user.username !== 'kevin1' && req.session.user.role !== 'driver') {
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
  envios[idx].estado = 'entregado';
  envios[idx].firmaCliente = req.body.firmaCliente || '';
  envios[idx].entregadoAt = nowIso();
  envios[idx].entregadoPor = req.session.user.username;
  envios[idx].updatedAt = nowIso();
  writeJson(files.envios, envios);
  res.json({ ok: true, envio: envios[idx] });
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
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generado: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
    doc.text(`Total de envios: ${envios.length}`);
    doc.text(`Monto total: Bs ${envios.reduce((s, e) => s + Number(e.total || 0), 0).toFixed(2)}`);
    doc.moveDown();
    envios.forEach((e, i) => {
      if (doc.y > 740) doc.addPage();
      doc.fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${e.codigo || e.id} - ${e.cliente || 'Sin cliente'} - ${e.estado}`);
      doc.font('Helvetica').text(`Fecha: ${e.fecha} | Usuario: ${e.creadoPor} | Tipo: ${e.tipoEnvio}`);
      doc.text(`Producto: ${e.producto} | Cantidad: ${e.cantidad} | Total: Bs ${Number(e.total || 0).toFixed(2)}`);
      doc.text(`Celular: ${e.celularCliente || e.transportadoraTelefono || ''}`);
      doc.text(`Direccion: ${e.direccionLiteral || e.transportadoraDireccion || ''}`);
      doc.text(`Maps: ${e.googleMaps || e.transportadoraMaps || ''}`);
      doc.moveDown(0.7);
    });
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
