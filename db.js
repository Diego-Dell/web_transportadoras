const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'sistema_envios',
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(buildConnectionConfig());

function newId(prefix) {
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${rnd}`;
}

function readLegacyJson(filename) {
  try {
    const file = path.join(DATA_DIR, filename);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Error leyendo JSON legado:', filename, e.message);
    return null;
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transportadoras (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  telefono TEXT DEFAULT '',
  direccion TEXT DEFAULT '',
  maps TEXT DEFAULT '',
  departamento TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS envios (
  id TEXT PRIMARY KEY,
  codigo TEXT,
  fecha DATE,
  creado_por TEXT,
  creado_por_id TEXT,
  tipo_envio TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  cliente TEXT DEFAULT '',
  celular_cliente TEXT DEFAULT '',
  producto TEXT DEFAULT '',
  cantidad INTEGER DEFAULT 1,
  precio_unitario NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  forma_pago TEXT DEFAULT '',
  origen TEXT DEFAULT '',
  destino_departamento TEXT DEFAULT '',
  direccion_literal TEXT DEFAULT '',
  google_maps TEXT DEFAULT '',
  transportadora_nombre TEXT DEFAULT '',
  transportadora_telefono TEXT DEFAULT '',
  transportadora_direccion TEXT DEFAULT '',
  transportadora_maps TEXT DEFAULT '',
  observaciones TEXT DEFAULT '',
  firma_cliente TEXT DEFAULT '',
  firma_trazos INTEGER DEFAULT 0,
  entregado_at TIMESTAMPTZ,
  entregado_por TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envios_fecha ON envios (fecha);
CREATE INDEX IF NOT EXISTS idx_envios_estado ON envios (estado);
CREATE INDEX IF NOT EXISTS idx_envios_creado_por ON envios (creado_por);
CREATE INDEX IF NOT EXISTS idx_envios_tipo ON envios (tipo_envio);
`;

const DEFAULT_TRANSPORTADORAS = [
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
];

async function seedUsuarios(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM usuarios');
  if (rows[0].count > 0) return;

  const legacy = readLegacyJson('usuarios.json');
  if (Array.isArray(legacy) && legacy.length) {
    for (const u of legacy) {
      await client.query(
        `INSERT INTO usuarios (id, username, pin_hash, role, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (username) DO NOTHING`,
        [u.id || newId('USR'), u.username, u.pinHash, u.role || 'worker', u.active !== false, u.createdAt || new Date(), u.updatedAt || new Date()]
      );
    }
    console.log(`Usuarios migrados desde data/usuarios.json (${legacy.length})`);
    return;
  }

  const usernames = (process.env.DEFAULT_USERS || 'kamil,soledad,dell,mikela,benjamin,rodrigo,Kevin')
    .split(',').map(x => x.trim()).filter(Boolean);
  const defaultPin = process.env.DEFAULT_PIN || '123456';
  for (const username of usernames) {
    await client.query(
      `INSERT INTO usuarios (id, username, pin_hash, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (username) DO NOTHING`,
      [newId('USR'), username, bcrypt.hashSync(defaultPin, 10), username.toLowerCase() === 'kevin' ? 'driver' : 'worker']
    );
  }
  console.log('Usuarios sembrados con valores por defecto');
}

async function seedTransportadoras(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM transportadoras');
  if (rows[0].count > 0) return;

  const legacy = readLegacyJson('transportadoras.json');
  const items = Array.isArray(legacy) && legacy.length ? legacy : DEFAULT_TRANSPORTADORAS;
  for (const t of items) {
    await client.query(
      `INSERT INTO transportadoras (nombre, telefono, direccion, maps, departamento)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nombre) DO NOTHING`,
      [t.nombre, t.telefono || '', t.direccion || '', t.maps || '', t.departamento || '']
    );
  }
  console.log(`Transportadoras sembradas (${items.length})${Array.isArray(legacy) && legacy.length ? ' desde data/transportadoras.json' : ''}`);
}

async function seedEnvios(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM envios');
  if (rows[0].count > 0) return;

  const legacy = readLegacyJson('envios.json');
  if (!Array.isArray(legacy) || !legacy.length) return;

  for (const e of legacy) {
    await client.query(
      `INSERT INTO envios (
         id, codigo, fecha, creado_por, creado_por_id, tipo_envio, estado, cliente, celular_cliente,
         producto, cantidad, precio_unitario, total, forma_pago, origen, destino_departamento,
         direccion_literal, google_maps, transportadora_nombre, transportadora_telefono,
         transportadora_direccion, transportadora_maps, observaciones, firma_cliente, firma_trazos,
         entregado_at, entregado_por, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
       ) ON CONFLICT (id) DO NOTHING`,
      [
        e.id || newId('ENV'), e.codigo || '', e.fecha || null, e.creadoPor || '', e.creadoPorId || '',
        e.tipoEnvio || 'santa_cruz', e.estado || 'pendiente', e.cliente || '', e.celularCliente || '',
        e.producto || '', Number(e.cantidad || 1), Number(e.precioUnitario || 0), Number(e.total || 0),
        e.formaPago || '', e.origen || '', e.destinoDepartamento || '', e.direccionLiteral || '',
        e.googleMaps || '', e.transportadoraNombre || '', e.transportadoraTelefono || '',
        e.transportadoraDireccion || '', e.transportadoraMaps || '', e.observaciones || '',
        e.firmaCliente || '', Number(e.firmaTrazos || 0), e.entregadoAt || null, e.entregadoPor || '',
        e.createdAt || new Date(), e.updatedAt || new Date()
      ]
    );
  }
  console.log(`Envios migrados desde data/envios.json (${legacy.length})`);
}

async function ensureKevinDriver(client) {
  await client.query(
    `UPDATE usuarios SET username = 'Kevin', role = 'driver', updated_at = now()
     WHERE LOWER(username) IN ('kevin', 'kevin1') AND username <> 'Kevin'`
  );
  const { rows } = await client.query(`SELECT 1 FROM usuarios WHERE username = 'Kevin'`);
  if (!rows.length) {
    await client.query(
      `INSERT INTO usuarios (id, username, pin_hash, role, active) VALUES ($1, 'Kevin', $2, 'driver', true)`,
      [newId('USR'), bcrypt.hashSync(process.env.DEFAULT_PIN || '123456', 10)]
    );
  }
}

async function init() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    await seedUsuarios(client);
    await seedTransportadoras(client);
    await seedEnvios(client);
    await ensureKevinDriver(client);
  } finally {
    client.release();
  }
}

function mapUsuario(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    pinHash: row.pin_hash,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTransportadora(row) {
  return {
    nombre: row.nombre,
    telefono: row.telefono || '',
    direccion: row.direccion || '',
    maps: row.maps || '',
    departamento: row.departamento || ''
  };
}

function mapEnvio(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo || '',
    fecha: row.fecha ? dayjs(row.fecha).format('YYYY-MM-DD') : '',
    creadoPor: row.creado_por || '',
    creadoPorId: row.creado_por_id || '',
    tipoEnvio: row.tipo_envio || 'santa_cruz',
    estado: row.estado || 'pendiente',
    cliente: row.cliente || '',
    celularCliente: row.celular_cliente || '',
    producto: row.producto || '',
    cantidad: Number(row.cantidad || 1),
    precioUnitario: Number(row.precio_unitario || 0),
    total: Number(row.total || 0),
    formaPago: row.forma_pago || '',
    origen: row.origen || '',
    destinoDepartamento: row.destino_departamento || '',
    direccionLiteral: row.direccion_literal || '',
    googleMaps: row.google_maps || '',
    transportadoraNombre: row.transportadora_nombre || '',
    transportadoraTelefono: row.transportadora_telefono || '',
    transportadoraDireccion: row.transportadora_direccion || '',
    transportadoraMaps: row.transportadora_maps || '',
    observaciones: row.observaciones || '',
    firmaCliente: row.firma_cliente || '',
    firmaTrazos: Number(row.firma_trazos || 0),
    entregadoAt: row.entregado_at ? new Date(row.entregado_at).toISOString() : '',
    entregadoPor: row.entregado_por || '',
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND active = true', [username]);
  return mapUsuario(rows[0]);
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
  return mapUsuario(rows[0]);
}

async function updateUserPin(id, pinHash) {
  await pool.query('UPDATE usuarios SET pin_hash = $1, updated_at = now() WHERE id = $2', [pinHash, id]);
}

async function getTransportadoras() {
  const { rows } = await pool.query('SELECT * FROM transportadoras ORDER BY nombre ASC');
  return rows.map(mapTransportadora);
}

async function upsertTransportadora(item) {
  await pool.query(
    `INSERT INTO transportadoras (nombre, telefono, direccion, maps, departamento)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nombre) DO UPDATE SET
       telefono = EXCLUDED.telefono,
       direccion = EXCLUDED.direccion,
       maps = EXCLUDED.maps,
       departamento = EXCLUDED.departamento`,
    [item.nombre, item.telefono || '', item.direccion || '', item.maps || '', item.departamento || '']
  );
  return getTransportadoras();
}

async function getEnvios(filters = {}) {
  const clauses = [];
  const values = [];
  let i = 1;
  if (filters.desde) { clauses.push(`fecha >= $${i++}`); values.push(filters.desde); }
  if (filters.hasta) { clauses.push(`fecha <= $${i++}`); values.push(filters.hasta); }
  if (filters.usuario) { clauses.push(`creado_por = $${i++}`); values.push(filters.usuario); }
  if (filters.estado) { clauses.push(`estado = $${i++}`); values.push(filters.estado); }
  if (filters.tipo) { clauses.push(`tipo_envio = $${i++}`); values.push(filters.tipo); }
  if (filters.excludeEstado) { clauses.push(`estado <> $${i++}`); values.push(filters.excludeEstado); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = filters.orderAsc ? 'ORDER BY created_at ASC' : 'ORDER BY created_at DESC';
  const { rows } = await pool.query(`SELECT * FROM envios ${where} ${order}`, values);
  return rows.map(mapEnvio);
}

async function getEnvioById(id) {
  const { rows } = await pool.query('SELECT * FROM envios WHERE id = $1', [id]);
  return mapEnvio(rows[0]);
}

async function countEnvios() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM envios');
  return rows[0].count;
}

async function createEnvio(envio) {
  const { rows } = await pool.query(
    `INSERT INTO envios (
       id, codigo, fecha, creado_por, creado_por_id, tipo_envio, estado, cliente, celular_cliente,
       producto, cantidad, precio_unitario, total, forma_pago, origen, destino_departamento,
       direccion_literal, google_maps, transportadora_nombre, transportadora_telefono,
       transportadora_direccion, transportadora_maps, observaciones
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      envio.id, envio.codigo, envio.fecha, envio.creadoPor, envio.creadoPorId, envio.tipoEnvio, envio.estado,
      envio.cliente, envio.celularCliente, envio.producto, envio.cantidad, envio.precioUnitario, envio.total,
      envio.formaPago, envio.origen, envio.destinoDepartamento, envio.direccionLiteral, envio.googleMaps,
      envio.transportadoraNombre, envio.transportadoraTelefono, envio.transportadoraDireccion,
      envio.transportadoraMaps, envio.observaciones
    ]
  );
  return mapEnvio(rows[0]);
}

const PATCHABLE_FIELDS = {
  codigo: 'codigo', fecha: 'fecha', tipoEnvio: 'tipo_envio', estado: 'estado', cliente: 'cliente',
  celularCliente: 'celular_cliente', producto: 'producto', cantidad: 'cantidad', precioUnitario: 'precio_unitario',
  total: 'total', formaPago: 'forma_pago', origen: 'origen', destinoDepartamento: 'destino_departamento',
  direccionLiteral: 'direccion_literal', googleMaps: 'google_maps', transportadoraNombre: 'transportadora_nombre',
  transportadoraTelefono: 'transportadora_telefono', transportadoraDireccion: 'transportadora_direccion',
  transportadoraMaps: 'transportadora_maps', observaciones: 'observaciones'
};

async function patchEnvio(id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${column} = $${i++}`);
      values.push(patch[key]);
    }
  }
  if (!sets.length) return getEnvioById(id);
  sets.push(`updated_at = now()`);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE envios SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return mapEnvio(rows[0]);
}

async function entregarEnvio(id, { firmaCliente, firmaTrazos, entregadoPor }) {
  const { rows } = await pool.query(
    `UPDATE envios SET estado = 'entregado', firma_cliente = $1, firma_trazos = $2,
       entregado_at = now(), entregado_por = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [firmaCliente, firmaTrazos, entregadoPor, id]
  );
  return mapEnvio(rows[0]);
}

async function getDashboardStats() {
  const today = dayjs().format('YYYY-MM-DD');
  const startWeek = dayjs().startOf('week').format('YYYY-MM-DD');
  const envios = await getEnvios();
  const by = key => envios.reduce((acc, e) => { const k = e[key] || 'Sin dato'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const totalMonto = envios.reduce((s, e) => s + Number(e.total || 0), 0);
  return {
    total: envios.length,
    hoy: envios.filter(e => String(e.fecha).slice(0, 10) === today).length,
    semana: envios.filter(e => String(e.fecha).slice(0, 10) >= startWeek).length,
    pendientes: envios.filter(e => e.estado !== 'entregado').length,
    entregados: envios.filter(e => e.estado === 'entregado').length,
    totalMonto,
    porUsuario: by('creadoPor'),
    porEstado: by('estado'),
    porTipo: by('tipoEnvio'),
    recientes: envios.slice(0, 8)
  };
}

module.exports = {
  pool,
  newId,
  init,
  findUserByUsername,
  findUserById,
  updateUserPin,
  getTransportadoras,
  upsertTransportadora,
  getEnvios,
  getEnvioById,
  countEnvios,
  createEnvio,
  patchEnvio,
  entregarEnvio,
  getDashboardStats
};
