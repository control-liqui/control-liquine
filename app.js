// ============================================================
//  Sistema de Existencias - Depto. Bienestar Social
//  Flujo: Recepción de factura -> Actas -> Salidas -> Reportes
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getFirestore, collection, addDoc, setDoc, getDoc, getDocs, doc,
  updateDoc, deleteDoc, onSnapshot, query, orderBy, where, Timestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ---- Configuración de Firebase (tu proyecto actual) ----
const firebaseConfig = {
  apiKey: "AIzaSyDqPxxU7qUfazmohEQWMdouuyi3OY07oSo",
  authDomain: "control-liquine.firebaseapp.com",
  projectId: "control-liquine",
  storageBucket: "control-liquine.firebasestorage.app",
  messagingSenderId: "588535543611",
  appId: "1:588535543611:web:743cd717daf9f5d593291e",
  measurementId: "G-JNEYDNWTPM"
}; 

// ---- Configuración institucional (editar según recinto) ----
const CONFIG = {
  institucion: 'ARMADA DE CHILE',
  departamento: 'DEPTO. BIENESTAR SOCIAL DE LA IIa Z.N',
  recinto: 'TERMAS DE LIQUIÑE',
  iva: 0.19
};

// ---- Unidades de medida (fijas) ----
const UNIDADES = ['UNIDAD','CAJA','PAQUETE','KILOGRAMO (KG)','GRAMO (GR)','LITRO (LT)',
  'MILILITRO (ML)','METRO (MT)','DOCENA','BIDÓN','SACO','ROLLO'];

// ---- Estado global ----
let app, db;
let articulos = [], proveedores = [], cuentas = [], firmantes = [], secciones = [], usuarios = [], familias = [];
let facturas = [], salidas = [], movimientos = [];
let recItems = [];
let salItems = [];
let ultimaFactura = null;
let ultimaSalida = null;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  updateConnectionStatus('connected');
} catch (e) {
  console.error('Error al inicializar Firebase:', e);
  updateConnectionStatus('error');
}

// ============================================================
//  Helpers
// ============================================================
function updateConnectionStatus(status) {
  const el = document.getElementById('connection-status');
  if (!el) return;
  el.querySelector('.status-dot').className = 'status-dot ' + status;
  const t = el.querySelector('.status-text');
  t.textContent = status === 'connected' ? 'Conectado' : status === 'error' ? 'Error de conexión' : 'Conectando...';
}

function money(v) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v) || 0);
}
function num(v) {
  return new Intl.NumberFormat('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v) || 0);
}
function fdate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
function fdatetime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
function toDate(ts) { return ts?.toDate ? ts.toDate() : new Date(ts); }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-message').textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// RUT chileno
function limpiarRut(v) { return String(v || '').toUpperCase().replace(/[^0-9K]/g, ''); }
function formatRut(v) {
  const c = limpiarRut(v);
  if (!c) return '';
  const dv = c.slice(-1);
  let cuerpo = c.slice(0, -1).replace(/K/g, '');
  if (cuerpo === '') return dv;
  cuerpo = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return cuerpo + '-' + dv;
}
function pareceRut(v) { const s = String(v || '').trim(); return /^[0-9.\-]*[kK]?$/.test(s) && /[0-9]/.test(s); }
function attachRut(id, { permitirNombre = false } = {}) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', function () {
    if (permitirNombre && !pareceRut(this.value)) return;
    const f = formatRut(this.value);
    if (this.value !== f) { this.value = f; this.setSelectionRange(this.value.length, this.value.length); }
  });
}

// Correlativos con transacción (integridad)
async function siguienteCorrelativo(nombre) {
  const ref = doc(db, 'contadores', nombre);
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.exists() ? (snap.data().valor || 0) : 0;
    const nuevo = actual + 1;
    tx.set(ref, { valor: nuevo }, { merge: true });
    return nuevo;
  });
}

const cuentaNombre = (cod) => (cuentas.find(c => String(c.codigo) === String(cod)) || {}).nombre || '';

// ============================================================
//  Navegación + Roles
// ============================================================
const ROLES_VIEWS = {
  administrador: ['dashboard','recepcion','salidas','inventario','facturas','articulos','proveedores','cuentas','firmantes','secciones','usuarios','historial','reportes','buscar'],
  bodeguero:     ['dashboard','recepcion','salidas','inventario','facturas','articulos','proveedores','historial','buscar'],
  jefe_finanzas: ['dashboard','inventario','facturas','historial','reportes','buscar'],
  subjefe:       ['dashboard','inventario','facturas','historial','reportes','buscar'],
  encargado:     ['dashboard','salidas','inventario','buscar'],
  contador:      ['dashboard','inventario','facturas','reportes','buscar'],
  auditor:       ['dashboard','inventario','facturas','historial','reportes','buscar']
};

// Catálogo de módulos del sistema (id de vista -> etiqueta)
const MODULOS = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'recepcion',  label: 'Recepción' },
  { id: 'salidas',    label: 'Salidas' },
  { id: 'inventario', label: 'Inventario' },
  { id: 'facturas',   label: 'Facturas' },
  { id: 'articulos',  label: 'Artículos' },
  { id: 'proveedores',label: 'Proveedores' },
  { id: 'cuentas',    label: 'Cuentas contables' },
  { id: 'firmantes',  label: 'Firmantes' },
  { id: 'secciones',  label: 'Secciones' },
  { id: 'usuarios',   label: 'Usuarios' },
  { id: 'historial',  label: 'Historial / Actas' },
  { id: 'reportes',   label: 'Reportes' },
  { id: 'buscar',     label: 'Buscar' }
];

// Config editable por rol (colección roles_config). ROLES_VIEWS son los valores por defecto.
let rolesConfig = {};

function vistasDeRol(rol) {
  const cfg = rolesConfig[rol];
  return (cfg && Array.isArray(cfg.vistas) && cfg.vistas.length) ? cfg.vistas : (ROLES_VIEWS[rol] || []);
}

// Vistas efectivas = módulos del rol + módulos extra del usuario. Dashboard siempre incluido.
function vistasEfectivas(rol, extras) {
  const set = new Set(['dashboard', ...vistasDeRol(rol), ...(extras || [])]);
  return [...set];
}

function aplicarRol(rol, extras) {
  const permitidas = vistasEfectivas(rol, extras);
  document.querySelectorAll('.nav-item').forEach(n => {
    n.style.display = permitidas.includes(n.dataset.view) ? '' : 'none';
  });
  const activa = document.querySelector('.nav-item.active');
  if (!activa || activa.style.display === 'none') irAVista('dashboard');
}

// Limpia formularios y datos temporales de una vista al abandonarla
function limpiarVista(viewId) {
  if (!viewId) return;
  const sec = document.getElementById(viewId + '-view');
  if (!sec) return;
  sec.querySelectorAll('form').forEach(f => f.reset());
  if (viewId === 'recepcion') {
    if (typeof limpiarRecepcion === 'function') limpiarRecepcion();
    const iva = document.getElementById('rec-iva'); if (iva) { iva.value = ''; iva.dispatchEvent(new Event('input')); }
    const p = document.getElementById('rec-acta-panel'); if (p) p.style.display = 'none';
    initFechas();
  }
  if (viewId === 'salidas') {
    if (typeof limpiarSalida === 'function') limpiarSalida();
    const p = document.getElementById('sal-acta-panel'); if (p) p.style.display = 'none';
    initFechas();
  }
  if (viewId === 'usuarios') {
    renderModulosChecks('usr-modulos', []);
    renderPermModulos();
  }
  if (viewId === 'reportes') {
    const r = document.getElementById('report-result'); if (r) r.style.display = 'none';
  }
  if (viewId === 'facturas') initFacFiltros();
  if (viewId === 'historial') initHistFiltros();
}

let vistaActual = 'dashboard';

function irAVista(viewId) {
  if (viewId !== vistaActual) { try { limpiarVista(vistaActual); } catch (e) { console.error(e); } }
  vistaActual = viewId;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === viewId));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId + '-view');
  if (el) el.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => irAVista(item.dataset.view));
});
document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sidebar-close').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

// ============================================================
//  Sesión / Login
// ============================================================
const SESSION_KEY = 'sesion_usuario';
let sesionActual = null;

function leerSesion() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function mostrarApp(sesion) {
  sesionActual = sesion;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = '';
  document.getElementById('session-nombre').textContent = sesion.nombre || sesion.username;
  document.getElementById('session-rol').textContent = (sesion.rol || '').replace('_', ' ');
  aplicarRol(sesion.rol, sesion.modulos_extra || []);
}

function mostrarLogin() {
  sesionActual = null;
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-form').reset();
  document.getElementById('login-error').textContent = '';
}

document.getElementById('btn-logout').addEventListener('click', mostrarLogin);

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Verificando...';
  try {
    const sesion = await loginConFirestore(username, password);
    if (!sesion) { errEl.textContent = 'Usuario o contraseña incorrectos, o usuario inactivo.'; return; }
    localStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
    mostrarApp(sesion);
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Error de conexión. Intente nuevamente.';
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
});

// Consulta directa a Firestore (no depende de que el snapshot ya haya cargado)
async function loginConFirestore(username, password) {
  if (!db || !username || !password) return null;
  const snap = await getDocs(query(collection(db, 'usuarios'), where('username', '==', username)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  const u = { id: d.id, ...d.data() };
  if (u.activo === false) return null;
  const hash = await hashPassword(password);
  if (hash !== u.password_hash) return null;
  return { id: u.id, nombre: u.nombre, username: u.username, rol: u.rol, modulos_extra: u.modulos_extra || [] };
}

document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', () => document.getElementById(b.dataset.close).classList.remove('active'));
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('htab-' + tab.dataset.htab).classList.add('active');
  });
});

// Mayúsculas
document.querySelectorAll('.uppercase-input').forEach(input => {
  input.addEventListener('input', function () {
    const s = this.selectionStart, e = this.selectionEnd;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(s, e);
  });
});

// ============================================================
//  Catálogos: llenar selects
// ============================================================
function llenarUnidades() {
  ['art-unidad','ea-unidad'].forEach(id => {
    const sel = document.getElementById(id); if (!sel) return;
    sel.innerHTML = '<option value="">Seleccionar...</option>' + UNIDADES.map(u => `<option value="${u}">${u}</option>`).join('');
  });
}
function llenarCuentasSelect() {
  const opts = '<option value="">Seleccionar...</option>' + cuentas.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.nombre}</option>`).join('');
  ['art-cuenta','ea-cuenta'].forEach(id => { const s = document.getElementById(id); if (s) s.innerHTML = opts; });
  const filtro = document.getElementById('inv-cuenta-filter');
  if (filtro) filtro.innerHTML = '<option value="all">Todas las cuentas</option>' + cuentas.map(c => `<option value="${c.codigo}">${c.nombre}</option>`).join('');
}
function llenarSeccionesSelect() {
  const wrap = document.getElementById('sal-seccion-wrap');
  if (wrap) wrap.innerHTML = `<label for="sal-seccion">Sección *</label><select id="sal-seccion"><option value="">Seleccionar...</option>${secciones.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('')}</select>`;
}
function llenarArticulosSelect() {
  const sel = document.getElementById('rep-art');
  if (sel) sel.innerHTML = '<option value="all">Todos</option>' + articulos.map(a => `<option value="${a.id}">${a.codigo} - ${a.nombre}</option>`).join('');
}

// ============================================================
//  Listeners en tiempo real
// ============================================================
function setupListeners() {
  onSnapshot(collection(db, 'articulos'), snap => {
    articulos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    articulos.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    updateDashboard(); updateInventoryTable(); updateArticulosTable(); llenarArticulosSelect();
    updateConnectionStatus('connected');
  }, e => { console.error(e); updateConnectionStatus('error'); });

  onSnapshot(collection(db, 'proveedores'), snap => {
    proveedores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    proveedores.sort((a, b) => String(a.razon_social || '').localeCompare(String(b.razon_social || '')));
    updateProveedoresTable();
  }, e => console.error(e));

  onSnapshot(collection(db, 'cuentas_contables'), snap => {
    cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cuentas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    llenarCuentasSelect(); updateCuentasTable(); updateInventoryTable();
  }, e => console.error(e));

  onSnapshot(collection(db, 'firmantes'), snap => {
    firmantes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    firmantes.sort((a, b) => (Number(a.orden) || 99) - (Number(b.orden) || 99));
    updateFirmantesTable();
  }, e => console.error(e));

  onSnapshot(collection(db, 'secciones'), snap => {
    secciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    secciones.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    llenarSeccionesSelect(); updateSeccionesTable();
  }, e => console.error(e));

  onSnapshot(collection(db, 'familias'), snap => {
    familias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    familias.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    llenarFamiliasSelects(); updateFamiliasTable(); updateInventoryTable(); updateArticulosTable();
  });

  onSnapshot(collection(db, 'usuarios'), snap => {
    usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    usuarios.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    updateUsuariosTable();
  });

  onSnapshot(collection(db, 'roles_config'), snap => {
    rolesConfig = {};
    snap.docs.forEach(d => { rolesConfig[d.id] = d.data(); });
    renderPermModulos();
    // Si cambia la config del rol en sesión, re-aplicar permisos y refrescar extras desde Firestore local
    if (sesionActual) {
      const u = usuarios.find(x => x.id === sesionActual.id);
      aplicarRol(sesionActual.rol, (u && u.modulos_extra) || sesionActual.modulos_extra || []);
    }
  });

  onSnapshot(query(collection(db, 'facturas'), orderBy('fecha_creacion', 'desc')), snap => {
    facturas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboard(); updateHistRecepciones(); updateFacturasView();
  }, e => console.error(e));

  onSnapshot(query(collection(db, 'salidas'), orderBy('fecha_creacion', 'desc')), snap => {
    salidas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboard(); updateHistSalidas();
  }, e => console.error(e));

  onSnapshot(query(collection(db, 'movimientos'), orderBy('fecha_creacion', 'desc')), snap => {
    movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboard();
  }, e => console.error(e));
}

// ============================================================
//  Dashboard
// ============================================================
function updateDashboard() {
  document.getElementById('stat-articulos').textContent = articulos.length;
  const valor = articulos.reduce((s, a) => s + (Number(a.stock) || 0) * (Number(a.costo_promedio) || 0), 0);
  document.getElementById('stat-valor').textContent = money(valor);

  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const recMes = facturas.filter(f => !f.anulada && toDate(f.fecha_creacion) >= inicioMes).length;
  document.getElementById('stat-recepciones').textContent = recMes;

  const costoSal = salidas.filter(s => !s.anulada && toDate(s.fecha_creacion) >= inicioMes)
    .reduce((s, x) => s + (Number(x.costo_total) || 0), 0);
  document.getElementById('stat-costo-salidas').textContent = money(costoSal);

  const critico = articulos.filter(a => Number(a.stock) <= Number(a.stock_minimo)).length;
  document.getElementById('stat-critico').textContent = critico;

  updateRecent(); updateAlerts();
}

function updateRecent() {
  const c = document.getElementById('recent-movements');
  const recientes = movimientos.slice(0, 6);
  if (!recientes.length) { c.innerHTML = '<div class="empty-state">No hay movimientos</div>'; return; }
  c.innerHTML = recientes.map(m => {
    const entrada = m.tipo === 'entrada';
    const icon = entrada
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>';
    return `<div class="recent-item"><div class="recent-icon ${entrada ? 'entry' : 'exit'}">${icon}</div>
      <div class="recent-info"><div class="recent-title">${m.nombre} (${num(m.cantidad)})</div>
      <div class="recent-meta">${entrada ? 'Entrada' : 'Salida'} · ${fdatetime(m.fecha_creacion)}</div></div></div>`;
  }).join('');
}

function updateAlerts() {
  const c = document.getElementById('stock-alerts');
  const alerts = articulos.filter(a => Number(a.stock) <= Number(a.stock_minimo));
  if (!alerts.length) { c.innerHTML = '<div class="empty-state">Sin alertas</div>'; return; }
  c.innerHTML = alerts.slice(0, 6).map(a => `
    <div class="alert-item">
      <div class="alert-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
      <div class="alert-info"><div class="alert-title">${a.nombre}</div><div class="alert-meta">Stock: ${num(a.stock)} / Mín: ${num(a.stock_minimo)}</div></div>
      <span class="badge ${Number(a.stock) === 0 ? 'badge-danger' : 'badge-warning'}">${Number(a.stock) === 0 ? 'Sin Stock' : 'Bajo'}</span>
    </div>`).join('');
}

// ============================================================
//  Autocompletar (genérico)
// ============================================================
function autocomplete(inputId, listId, hiddenId, buscar, onSelect, onEmpty) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const hidden = document.getElementById(hiddenId);
  if (!input || !list) return;
  let idx = -1;

  input.addEventListener('input', function () {
    const v = this.value.toUpperCase().trim();
    if (hidden) hidden.value = '';
    if (v.length < 1) { list.classList.remove('show'); if (onEmpty) onEmpty(this.value.trim()); return; }
    const matches = buscar(v).slice(0, 8);
    if (!matches.length) { list.classList.remove('show'); if (onEmpty) onEmpty(this.value.trim()); return; }
    list.innerHTML = matches.map((m, i) => m.html(i)).join('');
    list.classList.add('show'); idx = -1;
    list.querySelectorAll('.autocomplete-item').forEach((it, i) => {
      it.addEventListener('click', () => { onSelect(matches[i].data, input, hidden, list); list.classList.remove('show'); });
    });
  });
  input.addEventListener('keydown', function (e) {
    const items = list.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); if (items[idx]) items[idx].click(); return; }
    else if (e.key === 'Escape') { list.classList.remove('show'); return; }
    items.forEach((it, i) => it.classList.toggle('active', i === idx));
  });
  input.addEventListener('blur', () => setTimeout(() => list.classList.remove('show'), 200));
}

function buscarArticulos(v) {
  return articulos.filter(a =>
    a.activo !== false &&
    (String(a.codigo).toUpperCase().includes(v) || String(a.nombre).toUpperCase().includes(v))
  ).map(a => ({
    data: a,
    html: () => `<div class="autocomplete-item"><span class="product-code">${a.codigo}</span><span class="product-name">- ${a.nombre}</span><span class="product-stock">Stock: ${num(a.stock)} ${a.unidad_medida} · Costo prom: ${money(a.costo_promedio)}</span></div>`
  }));
}
function buscarProveedores(v) {
  const vc = limpiarRut(v);
  return proveedores.filter(p =>
    String(p.rut || '').toUpperCase().includes(v) || (vc && limpiarRut(p.rut).includes(vc)) ||
    String(p.razon_social || '').toUpperCase().includes(v)
  ).map(p => ({
    data: p,
    html: () => `<div class="autocomplete-item"><span class="product-code">${p.rut || 'SIN RUT'}</span><span class="product-name">- ${p.razon_social || ''}</span></div>`
  }));
}

// ============================================================
//  RECEPCIÓN DE FACTURA
// ============================================================
autocomplete('rec-prov-rut', 'rec-prov-list', 'rec-prov-id', buscarProveedores,
  (p, input, hidden) => {
    input.value = p.rut || p.razon_social;
    hidden.value = p.id;
    document.getElementById('rec-razon').value = p.razon_social || '';
    document.getElementById('rec-prov-info').innerHTML = '';
    checkFacturaDuplicada();
  },
  (texto) => {
    document.getElementById('rec-razon').value = '';
    document.getElementById('rec-prov-id').value = '';
    const info = document.getElementById('rec-prov-info');
    if (texto.length >= 2) {
      info.innerHTML = 'Proveedor no encontrado. <a href="#" id="rec-prov-nuevo">Registrar nuevo</a>';
      const link = document.getElementById('rec-prov-nuevo');
      if (link) link.addEventListener('click', ev => { ev.preventDefault(); abrirQuickProv(texto); });
    } else info.innerHTML = '';
    checkFacturaDuplicada();
  }
);

// Valida en tiempo real que el N° de factura no esté ya ingresado para el mismo proveedor
let facturaDupActiva = false;
function checkFacturaDuplicada() {
  const input = document.getElementById('rec-nfactura');
  const hint = document.getElementById('rec-nfactura-info');
  const saveBtn = document.getElementById('rec-save');
  const nFactura = input.value.trim().toUpperCase();
  const provId = document.getElementById('rec-prov-id').value;

  if (!nFactura || !provId) {
    input.classList.remove('input-error');
    hint.textContent = ''; hint.classList.remove('hint-error');
    saveBtn.disabled = false;
    facturaDupActiva = false;
    return;
  }

  const dup = facturas.find(f => !f.anulada && f.proveedor_id === provId && String(f.n_factura || '').toUpperCase() === nFactura);
  if (dup) {
    input.classList.add('input-error');
    hint.textContent = `El número de factura ya existe (Acta N° ${dup.n_acta}).`;
    hint.classList.add('hint-error');
    saveBtn.disabled = true;
    if (!facturaDupActiva) showToast('El número de factura ya existe.', 'error');
    facturaDupActiva = true;
  } else {
    input.classList.remove('input-error');
    hint.textContent = ''; hint.classList.remove('hint-error');
    saveBtn.disabled = false;
    facturaDupActiva = false;
  }
}
document.getElementById('rec-nfactura').addEventListener('input', checkFacturaDuplicada);

autocomplete('rec-art', 'rec-art-list', 'rec-art-id', buscarArticulos,
  (a, input, hidden) => {
    input.value = a.nombre; hidden.value = a.id;
    document.getElementById('rec-art-info').innerHTML = `Código: <strong>${a.codigo}</strong> · Unidad: ${a.unidad_medida}`;
    document.getElementById('rec-precio').value = a.costo_promedio ? Number(a.costo_promedio).toFixed(2) : '';
  },
  () => { document.getElementById('rec-art-id').value = ''; document.getElementById('rec-art-info').innerHTML = ''; }
);

document.getElementById('rec-add-line').addEventListener('click', () => {
  const id = document.getElementById('rec-art-id').value;
  const a = articulos.find(x => x.id === id);
  if (!a) { showToast('Seleccione un artículo válido de la lista', 'error'); return; }
  const cant = parseFloat(document.getElementById('rec-cant').value);
  const precio = parseFloat(document.getElementById('rec-precio').value);
  if (!(cant > 0)) { showToast('Ingrese una cantidad válida', 'error'); return; }
  if (!(precio >= 0) || isNaN(precio)) { showToast('Ingrese un precio válido', 'error'); return; }
  recItems.push({ articulo_id: a.id, codigo: a.codigo, nombre: a.nombre, unidad: a.unidad_medida, cantidad: cant, precio, total: cant * precio });
  renderRecItems();
  document.getElementById('rec-art').value = ''; document.getElementById('rec-art-id').value = '';
  document.getElementById('rec-cant').value = ''; document.getElementById('rec-precio').value = '';
  document.getElementById('rec-art-info').innerHTML = '';
  document.getElementById('rec-art').focus();
});

function renderRecItems() {
  const tb = document.getElementById('rec-items');
  if (!recItems.length) { tb.innerHTML = '<tr><td colspan="8" class="empty-state">Agregue artículos a la factura</td></tr>'; }
  else {
    tb.innerHTML = recItems.map((it, i) => `
      <tr><td>${i + 1}</td><td>${it.codigo}</td><td>${it.nombre}</td><td>${num(it.cantidad)}</td>
      <td>${it.unidad}</td><td>${money(it.precio)}</td><td>${money(it.total)}</td>
      <td><button class="btn-icon" data-rec-del="${i}" title="Quitar">🗑️</button></td></tr>`).join('');
    tb.querySelectorAll('[data-rec-del]').forEach(b => b.addEventListener('click', () => {
      recItems.splice(Number(b.dataset.recDel), 1); renderRecItems();
    }));
  }
  const neto = recItems.reduce((s, it) => s + it.total, 0);
  document.getElementById('rec-neto').textContent = money(neto);
  actualizarTotalRec();
}
function actualizarTotalRec() {
  const neto = recItems.reduce((s, it) => s + it.total, 0);
  const iva = parseFloat(document.getElementById('rec-iva').value) || 0;
  document.getElementById('rec-total').textContent = money(neto + iva);
}
document.getElementById('rec-iva').addEventListener('input', actualizarTotalRec);

document.getElementById('rec-clear').addEventListener('click', limpiarRecepcion);
function limpiarRecepcion() {
  recItems = [];
  ['rec-prov-rut','rec-prov-id','rec-razon','rec-nfactura','rec-orden','rec-art','rec-art-id','rec-cant','rec-precio']
    .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('rec-prov-info').innerHTML = '';
  document.getElementById('rec-art-info').innerHTML = '';
  renderRecItems();
  checkFacturaDuplicada();
}

document.getElementById('rec-save').addEventListener('click', guardarRecepcion);
async function guardarRecepcion() {
  const provId = document.getElementById('rec-prov-id').value;
  const prov = proveedores.find(p => p.id === provId);
  if (!prov) { showToast('Seleccione un proveedor válido', 'error'); return; }
  const nFactura = document.getElementById('rec-nfactura').value.trim();
  if (!nFactura) { showToast('Ingrese el N° de factura', 'error'); return; }
  const fFactura = document.getElementById('rec-fecha-factura').value;
  const fRecepcion = document.getElementById('rec-fecha-recepcion').value;
  if (!fFactura || !fRecepcion) { showToast('Complete las fechas de factura y recepción', 'error'); return; }
  if (!recItems.length) { showToast('Agregue al menos un artículo', 'error'); return; }

  const dup = facturas.find(f => !f.anulada && f.proveedor_id === provId &&
    String(f.n_factura || '').toUpperCase() === nFactura.toUpperCase());
  if (dup) { showToast(`La factura ${nFactura} ya fue ingresada para este proveedor (Acta N° ${dup.n_acta})`, 'error'); return; }

  const neto = recItems.reduce((s, it) => s + it.total, 0);
  const iva = parseFloat(document.getElementById('rec-iva').value) || 0;

  const btn = document.getElementById('rec-save'); btn.disabled = true;
  try {
    const nActa = await siguienteCorrelativo('acta_recepcion');
    const factura = {
      n_acta: nActa, proveedor_id: provId, rut: prov.rut || '', razon_social: prov.razon_social || '',
      n_factura: nFactura,
      fecha_factura: Timestamp.fromDate(new Date(fFactura + 'T00:00:00')),
      n_orden: document.getElementById('rec-orden').value.trim(),
      fecha_recepcion: Timestamp.fromDate(new Date(fRecepcion + 'T00:00:00')),
      items: recItems.map(it => ({ ...it })),
      neto, iva, total: neto + iva,
      firmantes: firmantes.map(f => ({ nombre: f.nombre, grado: f.grado || '', cargo: f.cargo || '', rut: f.rut || '' })),
      anulada: false, anula_a: '',
      fecha_creacion: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'facturas'), factura);

    for (const it of recItems) {
      const a = articulos.find(x => x.id === it.articulo_id);
      const prevStock = Number(a.stock) || 0;
      const prevCosto = Number(a.costo_promedio) || 0;
      const prevValor = prevStock * prevCosto;
      const newStock = prevStock + it.cantidad;
      const newValor = prevValor + it.cantidad * it.precio;
      const newCosto = newStock > 0 ? newValor / newStock : it.precio;
      await updateDoc(doc(db, 'articulos', a.id), { stock: newStock, costo_promedio: newCosto, valor_saldo: newStock * newCosto });
      await addDoc(collection(db, 'movimientos'), {
        tipo: 'entrada', articulo_id: a.id, codigo: a.codigo, nombre: a.nombre, unidad: a.unidad_medida,
        cantidad: it.cantidad, precio_unit: it.precio, costo_total: it.cantidad * it.precio,
        saldo_cant: newStock, saldo_valor: newStock * newCosto, costo_promedio: newCosto,
        cuenta_codigo: a.cuenta_codigo || '', cuenta_nombre: a.cuenta_nombre || '',
        tipo_documento: 'FACTURA', n_documento: nFactura, referencia_id: ref.id, n_acta: nActa,
        fecha_creacion: Timestamp.now(), fecha_doc: factura.fecha_recepcion
      });
    }

    ultimaFactura = { id: ref.id, ...factura };
    document.getElementById('rec-last-num').textContent = nActa;
    document.getElementById('rec-acta-panel').style.display = 'block';
    showToast(`Recepción registrada · Acta N° ${nActa}`);
    limpiarRecepcion();
  } catch (e) {
    console.error('Error al guardar recepción:', e);
    showToast('Error al guardar la recepción', 'error');
  } finally { btn.disabled = false; }
}

document.getElementById('rec-print-recepcion').addEventListener('click', () => { if (ultimaFactura) actaRecepcion(ultimaFactura); });
document.getElementById('rec-print-ingreso').addEventListener('click', () => { if (ultimaFactura) actaIngresoPanol(ultimaFactura); });

// ============================================================
//  SALIDAS
// ============================================================
autocomplete('sal-art', 'sal-art-list', 'sal-art-id', buscarArticulos,
  (a, input, hidden) => {
    input.value = a.nombre; hidden.value = a.id;
    document.getElementById('sal-art-info').innerHTML =
      `Código: <strong>${a.codigo}</strong> · Disponible: ${num(a.stock)} ${a.unidad_medida} · Costo: ${money(a.costo_promedio)}`;
  },
  () => { document.getElementById('sal-art-id').value = ''; document.getElementById('sal-art-info').innerHTML = ''; }
);

document.getElementById('sal-add-line').addEventListener('click', () => {
  const id = document.getElementById('sal-art-id').value;
  const a = articulos.find(x => x.id === id);
  if (!a) { showToast('Seleccione un artículo válido', 'error'); return; }
  const cant = parseFloat(document.getElementById('sal-cant').value);
  if (!(cant > 0)) { showToast('Ingrese una cantidad válida', 'error'); return; }
  const yaEnLista = salItems.filter(x => x.articulo_id === a.id).reduce((s, x) => s + x.cantidad, 0);
  if (cant + yaEnLista > (Number(a.stock) || 0)) {
    showToast(`No hay stock suficiente de ${a.nombre} (disponible: ${num(a.stock)})`, 'error'); return;
  }
  const costo = Number(a.costo_promedio) || 0;
  salItems.push({ articulo_id: a.id, codigo: a.codigo, nombre: a.nombre, unidad: a.unidad_medida, cantidad: cant, costo_unit: costo, costo_total: cant * costo });
  renderSalItems();
  if ((Number(a.stock) - cant - yaEnLista) <= Number(a.stock_minimo)) {
    showToast(`Atención: ${a.nombre} quedará en o bajo el stock mínimo`, 'error');
  }
  document.getElementById('sal-art').value = ''; document.getElementById('sal-art-id').value = '';
  document.getElementById('sal-cant').value = ''; document.getElementById('sal-art-info').innerHTML = '';
  document.getElementById('sal-art').focus();
});

function renderSalItems() {
  const tb = document.getElementById('sal-items');
  if (!salItems.length) { tb.innerHTML = '<tr><td colspan="8" class="empty-state">Agregue artículos a la salida</td></tr>'; }
  else {
    tb.innerHTML = salItems.map((it, i) => `
      <tr><td>${i + 1}</td><td>${it.codigo}</td><td>${it.nombre}</td><td>${num(it.cantidad)}</td>
      <td>${it.unidad}</td><td>${money(it.costo_unit)}</td><td>${money(it.costo_total)}</td>
      <td><button class="btn-icon" data-sal-del="${i}" title="Quitar">🗑️</button></td></tr>`).join('');
    tb.querySelectorAll('[data-sal-del]').forEach(b => b.addEventListener('click', () => {
      salItems.splice(Number(b.dataset.salDel), 1); renderSalItems();
    }));
  }
  document.getElementById('sal-total').textContent = money(salItems.reduce((s, it) => s + it.costo_total, 0));
}

document.getElementById('sal-clear').addEventListener('click', limpiarSalida);
function limpiarSalida() {
  salItems = [];
  ['sal-solicitante','sal-art','sal-art-id','sal-cant'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const s = document.getElementById('sal-seccion'); if (s) s.value = '';
  document.getElementById('sal-art-info').innerHTML = '';
  renderSalItems();
}

document.getElementById('sal-save').addEventListener('click', guardarSalida);
async function guardarSalida() {
  const seccion = (document.getElementById('sal-seccion') || {}).value || '';
  if (!seccion) { showToast('Seleccione la sección', 'error'); return; }
  const fecha = document.getElementById('sal-fecha').value;
  if (!fecha) { showToast('Ingrese la fecha de salida', 'error'); return; }
  if (!salItems.length) { showToast('Agregue al menos un artículo', 'error'); return; }

  for (const it of salItems) {
    const a = articulos.find(x => x.id === it.articulo_id);
    if (!a || it.cantidad > (Number(a.stock) || 0)) { showToast(`Stock insuficiente de ${it.nombre}`, 'error'); return; }
  }

  const btn = document.getElementById('sal-save'); btn.disabled = true;
  try {
    const nActa = await siguienteCorrelativo('acta_salida');
    const costoTotal = salItems.reduce((s, it) => s + it.costo_total, 0);
    const salida = {
      n_acta: nActa, seccion, solicitante: document.getElementById('sal-solicitante').value.trim(),
      fecha_salida: Timestamp.fromDate(new Date(fecha + 'T00:00:00')),
      items: salItems.map(it => ({ ...it })), costo_total: costoTotal,
      recinto: CONFIG.recinto, anulada: false, anula_a: '', fecha_creacion: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'salidas'), salida);

    for (const it of salItems) {
      const a = articulos.find(x => x.id === it.articulo_id);
      const newStock = (Number(a.stock) || 0) - it.cantidad;
      const costo = Number(a.costo_promedio) || 0;
      await updateDoc(doc(db, 'articulos', a.id), { stock: newStock, valor_saldo: newStock * costo });
      await addDoc(collection(db, 'movimientos'), {
        tipo: 'salida', articulo_id: a.id, codigo: a.codigo, nombre: a.nombre, unidad: a.unidad_medida,
        cantidad: it.cantidad, precio_unit: costo, costo_total: it.cantidad * costo,
        saldo_cant: newStock, saldo_valor: newStock * costo, costo_promedio: costo,
        cuenta_codigo: a.cuenta_codigo || '', cuenta_nombre: a.cuenta_nombre || '',
        seccion, tipo_documento: 'ACTA SALIDA', n_documento: String(nActa), referencia_id: ref.id, n_acta: nActa,
        fecha_creacion: Timestamp.now(), fecha_doc: salida.fecha_salida
      });
    }

    ultimaSalida = { id: ref.id, ...salida };
    document.getElementById('sal-last-num').textContent = nActa;
    document.getElementById('sal-acta-panel').style.display = 'block';
    showToast(`Salida registrada · Acta N° ${nActa}`);
    limpiarSalida();
  } catch (e) {
    console.error('Error al guardar salida:', e);
    showToast('Error al guardar la salida', 'error');
  } finally { btn.disabled = false; }
}

document.getElementById('sal-print').addEventListener('click', () => { if (ultimaSalida) actaSalidaPanol(ultimaSalida); });

// ============================================================
//  Actas PDF
// ============================================================
function encabezadoActa(d, titulo) {
  d.setFontSize(14); d.setFont(undefined, 'bold');
  d.text(titulo, d.internal.pageSize.getWidth() / 2, 16, { align: 'center' });
  d.setFont(undefined, 'normal');
}
function firmasActa(d, lista, startY) {
  const w = d.internal.pageSize.getWidth();
  const n = Math.min(lista.length, 4) || 1;
  const colW = (w - 28) / n;
  let y = startY + 24;
  if (y > d.internal.pageSize.getHeight() - 40) { d.addPage(); y = 40; }
  d.setFontSize(8);
  lista.slice(0, 4).forEach((f, i) => {
    const cx = 14 + colW * i + colW / 2;
    d.setDrawColor(0); d.line(cx - colW / 2 + 8, y, cx + colW / 2 - 8, y);
    let ly = y + 5;
    d.setFont(undefined, 'bold'); d.text(String(f.nombre || '').toUpperCase(), cx, ly, { align: 'center' }); ly += 4;
    d.setFont(undefined, 'normal');
    if (f.grado) { d.text(String(f.grado), cx, ly, { align: 'center' }); ly += 4; }
    if (f.cargo) { d.splitTextToSize(String(f.cargo), colW - 6).forEach(t => { d.text(t, cx, ly, { align: 'center' }); ly += 4; }); }
    if (f.rut) { d.text('RUT: ' + f.rut, cx, ly, { align: 'center' }); }
  });
}

function actaRecepcion(f) {
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  encabezadoActa(d, 'ACTA DE RECEPCIÓN');
  const base = { theme: 'grid', styles: { fontSize: 8, cellPadding: 1.6, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], textColor: [0, 0, 0] } };
  const hStyle = { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0] };

  d.autoTable({ ...base, startY: 22,
    body: [[
      { content: CONFIG.institucion + '\n' + CONFIG.departamento, styles: { fontStyle: 'bold' } },
      { content: 'N° ACTA DE RECEPCIÓN\n' + f.n_acta, styles: { fontStyle: 'bold' } },
      { content: 'FECHA RECEPCIÓN\n' + fdate(f.fecha_recepcion) }
    ]],
    columnStyles: { 0: { cellWidth: 88 }, 1: { cellWidth: 50 }, 2: { cellWidth: 50 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 3, headStyles: hStyle,
    head: [['PROVEEDOR', 'N° ORDEN DE COMPRA\nO CARTA ORDEN', 'N° FACTURA O GUÍA', 'FECHA FACTURA O GUÍA']],
    body: [[f.razon_social, f.n_orden || '-', f.n_factura, fdate(f.fecha_factura)]],
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 46 }, 2: { cellWidth: 36 }, 3: { cellWidth: 36 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 3, headStyles: hStyle,
    head: [['N° CORR.', 'DESCRIPCIÓN PRODUCTO O SERVICIO', 'CANTIDAD RECIBIDA', 'UNIDAD']],
    body: f.items.map((it, i) => [i + 1, { content: it.nombre, styles: { halign: 'left' } }, num(it.cantidad), it.unidad]),
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 108, halign: 'left' }, 2: { cellWidth: 34 }, 3: { cellWidth: 28 } } });

  firmasActa(d, f.firmantes && f.firmantes.length ? f.firmantes : firmantes, d.lastAutoTable.finalY);
  d.save('Acta_Recepcion_' + f.n_acta + '.pdf');
}

function actaIngresoPanol(f) {
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  encabezadoActa(d, 'ACTA DE INGRESO A PAÑOL');
  const base = { theme: 'grid', styles: { fontSize: 8, cellPadding: 1.6, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], textColor: [0, 0, 0] } };
  const hStyle = { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0] };

  d.autoTable({ ...base, startY: 22,
    body: [[
      { content: CONFIG.institucion + '\n' + CONFIG.departamento, styles: { fontStyle: 'bold' } },
      { content: 'N° ACTA\n' + f.n_acta, styles: { fontStyle: 'bold' } },
      { content: 'FECHA RECEPCIÓN\n' + fdate(f.fecha_recepcion) }
    ]],
    columnStyles: { 0: { cellWidth: 88 }, 1: { cellWidth: 50 }, 2: { cellWidth: 50 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 3, headStyles: hStyle,
    head: [['PROVEEDOR', 'N° ORDEN COMPRA', 'N° FACTURA O GUÍA', 'FECHA FACTURA']],
    body: [[f.razon_social, f.n_orden || '-', f.n_factura, fdate(f.fecha_factura)]],
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 46 }, 2: { cellWidth: 36 }, 3: { cellWidth: 36 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 3, headStyles: hStyle,
    head: [['N°', 'CÓDIGO', 'DESCRIPCIÓN', 'CANT.', 'UNIDAD', 'PRECIO', 'TOTAL']],
    body: f.items.map((it, i) => [i + 1, it.codigo, { content: it.nombre, styles: { halign: 'left' } }, num(it.cantidad), it.unidad, money(it.precio), money(it.total)]),
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 24 }, 2: { cellWidth: 68, halign: 'left' }, 3: { cellWidth: 18 }, 4: { cellWidth: 24 }, 5: { cellWidth: 22 }, 6: { cellWidth: 22 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 2, margin: { left: 20 },
    body: [
      [{ content: 'Total neto', styles: { halign: 'right', fontStyle: 'bold' } }, { content: money(f.neto), styles: { halign: 'right' } }],
      [{ content: '19% IVA', styles: { halign: 'right', fontStyle: 'bold' } }, { content: money(f.iva), styles: { halign: 'right' } }],
      [{ content: 'Total factura', styles: { halign: 'right', fontStyle: 'bold' } }, { content: money(f.total), styles: { halign: 'right', fontStyle: 'bold' } }]
    ],
    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 38 } } });

  const firmasIngreso = firmantes.slice(0, 2);
  firmasActa(d, firmasIngreso.length ? firmasIngreso : firmantes, d.lastAutoTable.finalY);
  d.save('Acta_Ingreso_Panol_' + f.n_acta + '.pdf');
}

function actaSalidaPanol(s) {
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  encabezadoActa(d, 'ACTA DE SALIDA DE PAÑOL');
  const base = { theme: 'grid', styles: { fontSize: 8, cellPadding: 1.6, halign: 'center', valign: 'middle', lineColor: [0, 0, 0], textColor: [0, 0, 0] } };
  const hStyle = { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [0, 0, 0], lineColor: [0, 0, 0] };

  d.autoTable({ ...base, startY: 22, headStyles: hStyle,
    head: [[CONFIG.departamento, 'N° ACTA', 'SECCIÓN', 'FECHA SALIDA']],
    body: [[s.recinto || CONFIG.recinto, s.n_acta, s.seccion, fdate(s.fecha_salida)]],
    columnStyles: { 0: { cellWidth: 84 }, 1: { cellWidth: 30 }, 2: { cellWidth: 40 }, 3: { cellWidth: 34 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 3, headStyles: hStyle,
    head: [['N°', 'CÓDIGO ART.', 'ARTÍCULOS', 'CANT.', 'UNIDAD', 'VALOR COSTO']],
    body: s.items.map((it, i) => [i + 1, it.codigo, { content: it.nombre, styles: { halign: 'left' } }, num(it.cantidad), it.unidad, money(it.costo_total)]),
    columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 30 }, 2: { cellWidth: 80, halign: 'left' }, 3: { cellWidth: 20 }, 4: { cellWidth: 24 }, 5: { cellWidth: 22 } } });

  d.autoTable({ ...base, startY: d.lastAutoTable.finalY + 2, margin: { left: 20 },
    body: [[{ content: 'COSTO TOTAL', styles: { halign: 'right', fontStyle: 'bold' } }, { content: money(s.costo_total), styles: { halign: 'right', fontStyle: 'bold' } }]],
    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 38 } } });

  d.setFontSize(8);
  const txt = 'Recibí los artículos indicados, del Encargado de Pañol de ' + (s.recinto || CONFIG.recinto) + ', para ser utilizados en ' + s.seccion + '.';
  d.text(d.splitTextToSize(txt, d.internal.pageSize.getWidth() - 28), 14, d.lastAutoTable.finalY + 8);

  const firmasSalida = [
    { nombre: s.solicitante || '', cargo: 'SOLICITANTE / ENCARGADO ' + s.seccion, grado: '', rut: '' },
    { nombre: (firmantes.find(x => /BODEG/i.test(x.cargo || '')) || {}).nombre || '', cargo: 'BODEGUERO', grado: '', rut: '' },
    { nombre: (firmantes.find(x => /ADMIN/i.test(x.cargo || '')) || {}).nombre || '', cargo: 'ADMINISTRADOR', grado: '', rut: '' }
  ];
  firmasActa(d, firmasSalida, d.lastAutoTable.finalY + 12);
  d.save('Acta_Salida_Panol_' + s.n_acta + '.pdf');
}

// ============================================================
//  INVENTARIO
// ============================================================
function updateInventoryTable() {
  const tb = document.getElementById('inventory-table'); if (!tb) return;
  const cf = (document.getElementById('inv-cuenta-filter') || {}).value || 'all';
  const sf = (document.getElementById('inv-status-filter') || {}).value || 'all';
  const ff = (document.getElementById('inv-familia-filter') || {}).value || 'all';
  let list = [...articulos];
  if (ff !== 'all') list = list.filter(a => (a.familia_id || '') === ff);
  if (cf !== 'all') list = list.filter(a => String(a.cuenta_codigo) === String(cf));
  if (sf !== 'all') list = list.filter(a => {
    const st = Number(a.stock), mn = Number(a.stock_minimo);
    if (sf === 'available') return st > mn;
    if (sf === 'low') return st > 0 && st <= mn;
    if (sf === 'out') return st === 0;
    return true;
  });
  if (!list.length) { tb.innerHTML = '<tr><td colspan="11" class="empty-state">No hay artículos que mostrar</td></tr>'; return; }
  // Orden por familia y nombre; encabezado con subtotal por familia (facilita el conteo de bodega)
  list.sort((a, b) => (a.familia_nombre || 'SIN FAMILIA').localeCompare(b.familia_nombre || 'SIN FAMILIA') || (a.nombre || '').localeCompare(b.nombre || ''));
  let html = '', famActual = null;
  const filaArt = a => {
    const st = Number(a.stock) || 0, mn = Number(a.stock_minimo) || 0, cp = Number(a.costo_promedio) || 0;
    let estado = 'Disponible', bc = 'badge-success';
    if (st === 0) { estado = 'Sin Stock'; bc = 'badge-danger'; }
    else if (st <= mn) { estado = 'Stock Bajo'; bc = 'badge-warning'; }
    return '<tr class="' + (a.activo === false ? 'row-anulada' : '') + '">' +
      '<td>' + a.codigo + '</td><td>' + a.nombre + (a.activo === false ? ' (DE BAJA)' : '') + '</td><td>' + (a.familia_nombre || 'SIN FAMILIA') + '</td><td>' + (a.cuenta_nombre || '-') + '</td>' +
      '<td>' + num(st) + '</td><td>' + a.unidad_medida + '</td><td>' + num(mn) + '</td>' +
      '<td>' + money(cp) + '</td><td>' + money(st * cp) + '</td>' +
      '<td><span class="badge ' + bc + '">' + estado + '</span></td>' +
      '<td class="actions"><button class="btn-icon" data-edit-art="' + a.id + '">✏️</button>' +
      '<button class="btn-icon" data-del-art="' + a.id + '">🗑️</button></td></tr>';
  };
  const famsEnLista = new Set(list.map(a => a.familia_nombre || 'SIN FAMILIA'));
  const agrupar = famsEnLista.size > 1;
  list.forEach(a => {
    const fam = a.familia_nombre || 'SIN FAMILIA';
    if (agrupar && fam !== famActual) {
      famActual = fam;
      const grupo = list.filter(x => (x.familia_nombre || 'SIN FAMILIA') === fam);
      const subtotal = grupo.reduce((s, x) => s + (Number(x.stock) || 0) * (Number(x.costo_promedio) || 0), 0);
      html += '<tr class="row-familia"><td colspan="11">' + fam +
        '<span class="fam-subtotal">' + grupo.length + ' art. · ' + money(subtotal) + '</span></td></tr>';
    }
    html += filaArt(a);
  });
  tb.innerHTML = html;
  tb.querySelectorAll('[data-edit-art]').forEach(b => b.addEventListener('click', () => editArticulo(b.dataset.editArt)));
  tb.querySelectorAll('[data-del-art]').forEach(b => b.addEventListener('click', () => delArticulo(b.dataset.delArt)));
}
['inv-familia-filter','inv-cuenta-filter','inv-status-filter'].forEach(id => {
  const e = document.getElementById(id); if (e) e.addEventListener('change', updateInventoryTable);
});

// ============================================================
//  FAMILIAS DE PRODUCTOS (CRUD)
// ============================================================
function familiaNombre(id) {
  const f = familias.find(x => x.id === id);
  return f ? f.nombre : '';
}

function llenarFamiliasSelects() {
  const ops = familias.map(f => '<option value="' + f.id + '">' + f.nombre + '</option>').join('');
  const setSel = (id, primero) => {
    const el = document.getElementById(id); if (!el) return;
    const val = el.value;
    el.innerHTML = primero + ops;
    if ([...el.options].some(o => o.value === val)) el.value = val;
  };
  setSel('art-familia', '<option value="">Sin familia</option>');
  setSel('ea-familia', '<option value="">Sin familia</option>');
  setSel('inv-familia-filter', '<option value="all">Todas las familias</option>');
}

function updateFamiliasTable() {
  const tb = document.getElementById('familias-table'); if (!tb) return;
  if (!familias.length) { tb.innerHTML = '<tr><td colspan="3" class="empty-state">No hay familias</td></tr>'; return; }
  tb.innerHTML = familias.map(f => {
    const n = articulos.filter(a => a.familia_id === f.id).length;
    return '<tr><td>' + f.nombre + '</td><td>' + n + '</td>' +
      '<td class="actions">' +
      '<button class="btn-icon" data-edit-fam="' + f.id + '" title="Renombrar">\u270f\ufe0f</button>' +
      '<button class="btn-icon" data-del-fam="' + f.id + '" title="Eliminar">\ud83d\uddd1\ufe0f</button>' +
      '</td></tr>';
  }).join('');
  tb.querySelectorAll('[data-edit-fam]').forEach(b => b.addEventListener('click', () => renombrarFamilia(b.dataset.editFam)));
  tb.querySelectorAll('[data-del-fam]').forEach(b => b.addEventListener('click', () => delFamilia(b.dataset.delFam)));
}

document.getElementById('familia-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = document.getElementById('fam-nombre').value.trim().toUpperCase();
  if (!nombre) return;
  if (familias.some(f => f.nombre === nombre)) { showToast('La familia ya existe', 'error'); return; }
  try {
    await addDoc(collection(db, 'familias'), { nombre, fecha_creacion: Timestamp.now() });
    showToast('Familia ' + nombre + ' creada');
    document.getElementById('familia-form').reset();
  } catch (err) { console.error(err); showToast('Error al crear la familia', 'error'); }
});

async function renombrarFamilia(id) {
  const f = familias.find(x => x.id === id); if (!f) return;
  const nuevo = prompt('Nuevo nombre para la familia:', f.nombre);
  if (!nuevo) return;
  const nombre = nuevo.trim().toUpperCase();
  if (!nombre || nombre === f.nombre) return;
  if (familias.some(x => x.nombre === nombre && x.id !== id)) { showToast('Ya existe una familia con ese nombre', 'error'); return; }
  try {
    await updateDoc(doc(db, 'familias', id), { nombre });
    // Propagar el nombre a los artículos de la familia
    const afectados = articulos.filter(a => a.familia_id === id);
    for (const a of afectados) await updateDoc(doc(db, 'articulos', a.id), { familia_nombre: nombre });
    showToast('Familia renombrada');
  } catch (e) { console.error(e); showToast('Error al renombrar', 'error'); }
}

async function delFamilia(id) {
  const n = articulos.filter(a => a.familia_id === id).length;
  if (n > 0) { showToast('No se puede eliminar: la familia tiene ' + n + ' artículo(s). Reasígnelos primero.', 'error'); return; }
  if (!confirm('\u00bfEliminar esta familia?')) return;
  try { await deleteDoc(doc(db, 'familias', id)); showToast('Familia eliminada'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

// ============================================================
//  ARTÍCULOS (CRUD)
// ============================================================
function updateArticulosTable() {
  const tb = document.getElementById('articulos-table'); if (!tb) return;
  document.getElementById('art-count').textContent = articulos.length + ' artículo' + (articulos.length !== 1 ? 's' : '');
  if (!articulos.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay artículos</td></tr>'; return; }
  tb.innerHTML = articulos.map(a => '<tr class="' + (a.activo === false ? 'row-anulada' : '') + '">' +
    '<td>' + a.codigo + '</td><td>' + a.nombre + (a.activo === false ? ' (DE BAJA)' : '') + '</td><td>' + (a.familia_nombre || 'SIN FAMILIA') + '</td><td>' + a.unidad_medida + '</td><td>' + num(a.stock_minimo) + '</td>' +
    '<td>' + (a.cuenta_nombre || '-') + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-art="' + a.id + '">✏️</button>' +
    '<button class="btn-icon" data-baja-art="' + a.id + '" title="' + (a.activo === false ? 'Reactivar' : 'Dar de baja') + '">' + (a.activo === false ? '✅' : '🚫') + '</button>' +
    '<button class="btn-icon" data-del-art="' + a.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-art]').forEach(b => b.addEventListener('click', () => editArticulo(b.dataset.editArt)));
  tb.querySelectorAll('[data-del-art]').forEach(b => b.addEventListener('click', () => delArticulo(b.dataset.delArt)));
  tb.querySelectorAll('[data-baja-art]').forEach(b => b.addEventListener('click', () => toggleBajaArticulo(b.dataset.bajaArt)));
}

document.getElementById('articulo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = document.getElementById('art-nombre').value.trim();
  const unidad = document.getElementById('art-unidad').value;
  const stockmin = parseFloat(document.getElementById('art-stockmin').value) || 0;
  const cuentaCod = document.getElementById('art-cuenta').value;
  if (!nombre || !unidad || !cuentaCod) { showToast('Complete los campos obligatorios', 'error'); return; }
  try {
    const n = await siguienteCorrelativo('articulo');
    const codigo = 'ART-' + String(n).padStart(5, '0');
    const famId = document.getElementById('art-familia').value;
    await addDoc(collection(db, 'articulos'), {
      codigo, nombre, unidad_medida: unidad, stock_minimo: stockmin,
      familia_id: famId, familia_nombre: famId ? familiaNombre(famId) : 'SIN FAMILIA',
      cuenta_codigo: cuentaCod, cuenta_nombre: cuentaNombre(cuentaCod),
      stock: 0, costo_promedio: 0, valor_saldo: 0, fecha_creacion: Timestamp.now()
    });
    showToast('Artículo ' + codigo + ' guardado');
    document.getElementById('articulo-form').reset();
  } catch (err) { console.error(err); showToast('Error al guardar el artículo', 'error'); }
});

function editArticulo(id) {
  const a = articulos.find(x => x.id === id); if (!a) return;
  document.getElementById('ea-id').value = a.id;
  document.getElementById('ea-codigo').value = a.codigo;
  document.getElementById('ea-nombre').value = a.nombre;
  document.getElementById('ea-unidad').value = a.unidad_medida;
  document.getElementById('ea-stockmin').value = a.stock_minimo;
  document.getElementById('ea-cuenta').value = a.cuenta_codigo;
  document.getElementById('ea-familia').value = a.familia_id || '';
  document.getElementById('modal-articulo').classList.add('active');
}
document.getElementById('edit-articulo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('ea-id').value;
  const cuentaCod = document.getElementById('ea-cuenta').value;
  try {
    const famId = document.getElementById('ea-familia').value;
    await updateDoc(doc(db, 'articulos', id), {
      nombre: document.getElementById('ea-nombre').value.trim(),
      unidad_medida: document.getElementById('ea-unidad').value,
      stock_minimo: parseFloat(document.getElementById('ea-stockmin').value) || 0,
      familia_id: famId, familia_nombre: famId ? familiaNombre(famId) : 'SIN FAMILIA',
      cuenta_codigo: cuentaCod, cuenta_nombre: cuentaNombre(cuentaCod)
    });
    showToast('Artículo actualizado');
    document.getElementById('modal-articulo').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
// Consulta Firestore directamente: no depende de lo cargado en memoria
async function articuloTieneMovimientos(id) {
  const snap = await getDocs(query(collection(db, 'movimientos'), where('articulo_id', '==', id)));
  return !snap.empty;
}

async function delArticulo(id) {
  const a = articulos.find(x => x.id === id); if (!a) return;
  try {
    if (await articuloTieneMovimientos(id)) {
      if (confirm('El artículo ' + a.codigo + ' tiene movimientos en el kardex y NO puede eliminarse.\n\n¿Desea darlo de baja? (Deja de aparecer en Recepción y Salidas, pero conserva su historial)')) {
        await updateDoc(doc(db, 'articulos', id), { activo: false, fecha_baja: Timestamp.now() });
        showToast('Artículo ' + a.codigo + ' dado de baja');
      }
      return;
    }
    if (!confirm('¿Eliminar este artículo? No tiene movimientos registrados.')) return;
    await deleteDoc(doc(db, 'articulos', id));
    showToast('Artículo eliminado');
  } catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

async function toggleBajaArticulo(id) {
  const a = articulos.find(x => x.id === id); if (!a) return;
  const dar = a.activo !== false;
  if (dar && Number(a.stock) > 0 && !confirm('El artículo tiene stock (' + num(a.stock) + ' ' + a.unidad_medida + '). ¿Dar de baja igualmente?')) return;
  if (!dar && !confirm('¿Reactivar el artículo ' + a.codigo + '?')) return;
  if (dar && !confirm('¿Dar de baja el artículo ' + a.codigo + '? Dejará de aparecer en Recepción y Salidas.')) return;
  try {
    await updateDoc(doc(db, 'articulos', id), dar ? { activo: false, fecha_baja: Timestamp.now() } : { activo: true, fecha_baja: null });
    showToast(dar ? 'Artículo dado de baja' : 'Artículo reactivado');
  } catch (e) { console.error(e); showToast('Error al cambiar estado', 'error'); }
}

// ============================================================
//  PROVEEDORES (CRUD)
// ============================================================
function updateProveedoresTable() {
  const tb = document.getElementById('proveedores-table'); if (!tb) return;
  document.getElementById('prov-count').textContent = proveedores.length + ' proveedor' + (proveedores.length !== 1 ? 'es' : '');
  if (!proveedores.length) { tb.innerHTML = '<tr><td colspan="5" class="empty-state">No hay proveedores</td></tr>'; return; }
  tb.innerHTML = proveedores.map(p => '<tr>' +
    '<td>' + (p.rut || '-') + '</td><td>' + (p.razon_social || '-') + '</td><td>' + (p.direccion || '-') + '</td><td>' + (p.telefono || '-') + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-prov="' + p.id + '">✏️</button><button class="btn-icon" data-del-prov="' + p.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-prov]').forEach(b => b.addEventListener('click', () => editProveedor(b.dataset.editProv)));
  tb.querySelectorAll('[data-del-prov]').forEach(b => b.addEventListener('click', () => delProveedor(b.dataset.delProv)));
}
document.getElementById('proveedor-form').addEventListener('submit', async e => {
  e.preventDefault();
  const razon = document.getElementById('prov-razon').value.trim();
  if (!razon) { showToast('La razón social es obligatoria', 'error'); return; }
  try {
    await addDoc(collection(db, 'proveedores'), {
      rut: document.getElementById('prov-rut').value.trim(), razon_social: razon,
      direccion: document.getElementById('prov-direccion').value.trim(),
      telefono: document.getElementById('prov-telefono').value.trim(), fecha_creacion: Timestamp.now()
    });
    showToast('Proveedor guardado'); document.getElementById('proveedor-form').reset();
  } catch (err) { console.error(err); showToast('Error al guardar', 'error'); }
});
function editProveedor(id) {
  const p = proveedores.find(x => x.id === id); if (!p) return;
  document.getElementById('ep-id').value = p.id;
  document.getElementById('ep-rut').value = p.rut || '';
  document.getElementById('ep-razon').value = p.razon_social || '';
  document.getElementById('ep-direccion').value = p.direccion || '';
  document.getElementById('ep-telefono').value = p.telefono || '';
  document.getElementById('modal-proveedor').classList.add('active');
}
document.getElementById('edit-proveedor-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await updateDoc(doc(db, 'proveedores', document.getElementById('ep-id').value), {
      rut: document.getElementById('ep-rut').value.trim(),
      razon_social: document.getElementById('ep-razon').value.trim(),
      direccion: document.getElementById('ep-direccion').value.trim(),
      telefono: document.getElementById('ep-telefono').value.trim()
    });
    showToast('Proveedor actualizado'); document.getElementById('modal-proveedor').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
async function delProveedor(id) {
  if (!confirm('¿Eliminar este proveedor?')) return;
  try { await deleteDoc(doc(db, 'proveedores', id)); showToast('Proveedor eliminado'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

function abrirQuickProv(rut) {
  rut = rut || '';
  document.getElementById('quick-prov-form').reset();
  document.getElementById('qp-rut').value = rut && pareceRut(rut) ? formatRut(rut) : '';
  if (rut && !pareceRut(rut)) document.getElementById('qp-razon').value = rut.toUpperCase();
  document.getElementById('modal-quick-prov').classList.add('active');
}
document.getElementById('quick-prov-form').addEventListener('submit', async e => {
  e.preventDefault();
  const razon = document.getElementById('qp-razon').value.trim();
  if (!razon) { showToast('La razón social es obligatoria', 'error'); return; }
  try {
    const ref = await addDoc(collection(db, 'proveedores'), {
      rut: document.getElementById('qp-rut').value.trim(), razon_social: razon,
      direccion: document.getElementById('qp-direccion').value.trim(),
      telefono: document.getElementById('qp-telefono').value.trim(), fecha_creacion: Timestamp.now()
    });
    document.getElementById('rec-prov-id').value = ref.id;
    document.getElementById('rec-prov-rut').value = document.getElementById('qp-rut').value.trim() || razon;
    document.getElementById('rec-razon').value = razon;
    document.getElementById('rec-prov-info').innerHTML = '';
    checkFacturaDuplicada();
    showToast('Proveedor registrado y seleccionado');
    document.getElementById('modal-quick-prov').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al registrar', 'error'); }
});

// ============================================================
//  CUENTAS CONTABLES (CRUD)
// ============================================================
function updateCuentasTable() {
  const tb = document.getElementById('cuentas-table'); if (!tb) return;
  document.getElementById('cuenta-count').textContent = cuentas.length + ' cuenta' + (cuentas.length !== 1 ? 's' : '');
  if (!cuentas.length) { tb.innerHTML = '<tr><td colspan="3" class="empty-state">No hay cuentas</td></tr>'; return; }
  tb.innerHTML = cuentas.map(c => '<tr><td>' + c.codigo + '</td><td>' + c.nombre + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-cuenta="' + c.id + '">✏️</button><button class="btn-icon" data-del-cuenta="' + c.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-cuenta]').forEach(b => b.addEventListener('click', () => editCuenta(b.dataset.editCuenta)));
  tb.querySelectorAll('[data-del-cuenta]').forEach(b => b.addEventListener('click', () => delCuenta(b.dataset.delCuenta)));
}
document.getElementById('cuenta-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await addDoc(collection(db, 'cuentas_contables'), {
      codigo: document.getElementById('cuenta-codigo').value.trim(),
      nombre: document.getElementById('cuenta-nombre').value.trim(), fecha_creacion: Timestamp.now()
    });
    showToast('Cuenta guardada'); document.getElementById('cuenta-form').reset();
  } catch (err) { console.error(err); showToast('Error al guardar', 'error'); }
});
function editCuenta(id) {
  const c = cuentas.find(x => x.id === id); if (!c) return;
  document.getElementById('ec-id').value = c.id;
  document.getElementById('ec-codigo').value = c.codigo;
  document.getElementById('ec-nombre').value = c.nombre;
  document.getElementById('modal-cuenta').classList.add('active');
}
document.getElementById('edit-cuenta-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await updateDoc(doc(db, 'cuentas_contables', document.getElementById('ec-id').value), {
      codigo: document.getElementById('ec-codigo').value.trim(),
      nombre: document.getElementById('ec-nombre').value.trim()
    });
    showToast('Cuenta actualizada'); document.getElementById('modal-cuenta').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
async function delCuenta(id) {
  if (!confirm('¿Eliminar esta cuenta?')) return;
  try { await deleteDoc(doc(db, 'cuentas_contables', id)); showToast('Cuenta eliminada'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

// ============================================================
//  FIRMANTES (CRUD)
// ============================================================
function updateFirmantesTable() {
  const tb = document.getElementById('firmantes-table'); if (!tb) return;
  document.getElementById('firm-count').textContent = firmantes.length + ' firmante' + (firmantes.length !== 1 ? 's' : '');
  if (!firmantes.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">No hay firmantes</td></tr>'; return; }
  tb.innerHTML = firmantes.map(f => '<tr>' +
    '<td>' + (f.orden || '-') + '</td><td>' + f.nombre + '</td><td>' + (f.grado || '-') + '</td><td>' + (f.cargo || '-') + '</td><td>' + (f.rut || '-') + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-firm="' + f.id + '">✏️</button><button class="btn-icon" data-del-firm="' + f.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-firm]').forEach(b => b.addEventListener('click', () => editFirmante(b.dataset.editFirm)));
  tb.querySelectorAll('[data-del-firm]').forEach(b => b.addEventListener('click', () => delFirmante(b.dataset.delFirm)));
}
document.getElementById('firmante-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await addDoc(collection(db, 'firmantes'), {
      nombre: document.getElementById('firm-nombre').value.trim(),
      grado: document.getElementById('firm-grado').value.trim(),
      cargo: document.getElementById('firm-cargo').value.trim(),
      rut: document.getElementById('firm-rut').value.trim(),
      orden: parseInt(document.getElementById('firm-orden').value) || (firmantes.length + 1),
      fecha_creacion: Timestamp.now()
    });
    showToast('Firmante guardado'); document.getElementById('firmante-form').reset();
  } catch (err) { console.error(err); showToast('Error al guardar', 'error'); }
});
function editFirmante(id) {
  const f = firmantes.find(x => x.id === id); if (!f) return;
  document.getElementById('ef-id').value = f.id;
  document.getElementById('ef-nombre').value = f.nombre;
  document.getElementById('ef-grado').value = f.grado || '';
  document.getElementById('ef-cargo').value = f.cargo || '';
  document.getElementById('ef-rut').value = f.rut || '';
  document.getElementById('ef-orden').value = f.orden || '';
  document.getElementById('modal-firmante').classList.add('active');
}
document.getElementById('edit-firmante-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await updateDoc(doc(db, 'firmantes', document.getElementById('ef-id').value), {
      nombre: document.getElementById('ef-nombre').value.trim(),
      grado: document.getElementById('ef-grado').value.trim(),
      cargo: document.getElementById('ef-cargo').value.trim(),
      rut: document.getElementById('ef-rut').value.trim(),
      orden: parseInt(document.getElementById('ef-orden').value) || 99
    });
    showToast('Firmante actualizado'); document.getElementById('modal-firmante').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
async function delFirmante(id) {
  if (!confirm('¿Eliminar este firmante?')) return;
  try { await deleteDoc(doc(db, 'firmantes', id)); showToast('Firmante eliminado'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

// ============================================================
//  FACTURAS (consulta y reportes)
// ============================================================
function initFacFiltros() {
  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('fac-from', hace30); set('fac-to', hoy); set('fac-prov', ''); set('fac-num', ''); set('fac-estado', 'vigentes');
  updateFacturasView();
}

function filtrarFacturas() {
  const from = document.getElementById('fac-from');
  if (!from) return [];
  const fFrom = from.value ? new Date(from.value + 'T00:00:00') : null;
  const toV = document.getElementById('fac-to').value;
  const fTo = toV ? new Date(toV + 'T23:59:59') : null;
  const prov = document.getElementById('fac-prov').value.trim().toUpperCase();
  const nfac = document.getElementById('fac-num').value.trim().toUpperCase();
  const estado = document.getElementById('fac-estado').value;
  return facturas.filter(f => {
    if (estado === 'vigentes' && f.anulada) return false;
    if (estado === 'anuladas' && !f.anulada) return false;
    const fd = toDate(f.fecha_factura);
    if (fFrom && fd < fFrom) return false;
    if (fTo && fd > fTo) return false;
    if (prov && !((f.razon_social || '').toUpperCase().includes(prov) || (f.rut || '').toUpperCase().includes(prov))) return false;
    if (nfac && !String(f.n_factura || '').toUpperCase().includes(nfac)) return false;
    return true;
  });
}

function updateFacturasView() {
  const tb = document.getElementById('facturas-table');
  if (!tb) return;
  const data = filtrarFacturas();
  const neto = data.reduce((s, f) => s + (Number(f.neto) || 0), 0);
  const iva = data.reduce((s, f) => s + (Number(f.iva) || 0), 0);
  document.getElementById('fac-t-cant').textContent = data.length;
  document.getElementById('fac-t-neto').textContent = money(neto);
  document.getElementById('fac-t-iva').textContent = money(iva);
  document.getElementById('fac-t-total').textContent = money(neto + iva);
  if (!data.length) { tb.innerHTML = '<tr><td colspan="10" class="empty-state">No hay facturas con esos filtros</td></tr>'; return; }
  tb.innerHTML = data.map(f => '<tr class="' + (f.anulada ? 'row-anulada' : '') + '">' +
    '<td>' + (f.n_acta || '-') + '</td><td>' + (f.n_factura || '-') + '</td>' +
    '<td>' + fdate(f.fecha_factura) + '</td><td>' + fdate(f.fecha_recepcion) + '</td>' +
    '<td>' + (f.razon_social || '-') + '</td>' +
    '<td>' + money(f.neto) + '</td><td>' + money(f.iva) + '</td><td>' + money(f.total) + '</td>' +
    '<td>' + (f.anulada ? 'ANULADA' : 'Vigente') + '</td>' +
    '<td class="actions">' +
      '<button class="btn-icon" data-fac-det="' + f.id + '" title="Ver detalle">\ud83d\udd0d</button>' +
      '<button class="btn-icon" data-fac-rec="' + f.id + '" title="Acta Recepci\u00f3n PDF">\ud83d\udcc4</button>' +
      '<button class="btn-icon" data-fac-ing="' + f.id + '" title="Acta Ingreso PDF">\ud83d\udcc3</button>' +
    '</td></tr>').join('');
  tb.querySelectorAll('[data-fac-det]').forEach(b => b.addEventListener('click', () => verDetalleFactura(b.dataset.facDet)));
  tb.querySelectorAll('[data-fac-rec]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.facRec); if (f) actaRecepcion(f); }));
  tb.querySelectorAll('[data-fac-ing]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.facIng); if (f) actaIngresoPanol(f); }));
}

let facturaDetalle = null;
function verDetalleFactura(id) {
  const f = facturas.find(x => x.id === id); if (!f) return;
  facturaDetalle = f;
  document.getElementById('mf-titulo').textContent = 'Factura ' + (f.n_factura || '-') + (f.anulada ? ' (ANULADA)' : '');
  const dato = (l, v) => '<div><span class="dg-label">' + l + '</span>' + (v || '-') + '</div>';
  document.getElementById('mf-datos').innerHTML =
    dato('N\u00b0 Acta Recepci\u00f3n', f.n_acta) +
    dato('Proveedor', f.razon_social) +
    dato('RUT', f.rut) +
    dato('N\u00b0 Orden de compra', f.n_orden) +
    dato('Fecha factura', fdate(f.fecha_factura)) +
    dato('Fecha recepci\u00f3n', fdate(f.fecha_recepcion)) +
    (f.anulada ? dato('Motivo anulaci\u00f3n', f.motivo_anulacion) : '');
  document.getElementById('mf-items').innerHTML = (f.items || []).map((it, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + it.codigo + '</td><td>' + it.nombre + '</td><td>' + num(it.cantidad) +
    '</td><td>' + it.unidad + '</td><td>' + money(it.precio) + '</td><td>' + money(it.total) + '</td></tr>').join('');
  document.getElementById('mf-totales').innerHTML =
    '<span>Neto:<strong>' + money(f.neto) + '</strong></span>' +
    '<span>IVA:<strong>' + money(f.iva) + '</strong></span>' +
    '<span>Total:<strong>' + money(f.total) + '</strong></span>';
  document.getElementById('modal-factura').classList.add('active');
}

document.getElementById('mf-pdf-rec').addEventListener('click', () => { if (facturaDetalle) actaRecepcion(facturaDetalle); });
document.getElementById('mf-pdf-ing').addEventListener('click', () => { if (facturaDetalle) actaIngresoPanol(facturaDetalle); });

['fac-from','fac-to','fac-prov','fac-num','fac-estado'].forEach(id => {
  const e = document.getElementById(id);
  if (e) e.addEventListener('input', updateFacturasView);
});
document.getElementById('fac-limpiar').addEventListener('click', initFacFiltros);

function descargarCSV(nombre, filas) {
  if (!filas.length) { showToast('No hay datos para exportar', 'error'); return; }
  const hs = Object.keys(filas[0]);
  const csv = [hs.join(','), ...filas.map(r => hs.map(h => {
    let v = r[h]; if (v === null || v === undefined) v = '';
    if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = nombre + '_' + new Date().toISOString().split('T')[0] + '.csv'; a.click();
  showToast('CSV exportado');
}

document.getElementById('fac-csv').addEventListener('click', () => {
  const data = filtrarFacturas().map(f => ({
    'N Acta': f.n_acta || '', 'N Factura': f.n_factura || '',
    'Fecha Factura': fdate(f.fecha_factura), 'Fecha Recepcion': fdate(f.fecha_recepcion),
    'RUT': f.rut || '', 'Proveedor': f.razon_social || '', 'N Orden': f.n_orden || '',
    'Neto': Number(f.neto) || 0, 'IVA': Number(f.iva) || 0, 'Total': Number(f.total) || 0,
    'Estado': f.anulada ? 'ANULADA' : 'VIGENTE'
  }));
  descargarCSV('facturas', data);
});

document.getElementById('fac-csv-prov').addEventListener('click', () => {
  const agrupado = {};
  filtrarFacturas().forEach(f => {
    const k = f.rut || f.razon_social || 'SIN PROVEEDOR';
    if (!agrupado[k]) agrupado[k] = { 'RUT': f.rut || '', 'Proveedor': f.razon_social || '', 'Facturas': 0, 'Neto': 0, 'IVA': 0, 'Total': 0 };
    agrupado[k]['Facturas'] += 1;
    agrupado[k]['Neto'] += Number(f.neto) || 0;
    agrupado[k]['IVA'] += Number(f.iva) || 0;
    agrupado[k]['Total'] += Number(f.total) || 0;
  });
  descargarCSV('facturas_por_proveedor', Object.values(agrupado));
});

// ============================================================
//  USUARIOS (CRUD) - el rol se asigna al crear y NO es editable
// ============================================================
const ROLES_LABEL = {
  administrador: 'Administrador', bodeguero: 'Bodeguero', jefe_finanzas: 'Jefe de Finanzas',
  subjefe: 'Subjefe', encargado: 'Encargado', contador: 'Contador', auditor: 'Auditor'
};

// Hash SHA-256 (Web Crypto). Nunca se guarda ni envía la contraseña en texto plano.
// Requiere contexto seguro: HTTPS o localhost.
async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Checkboxes de módulos ----
function renderModulosChecks(containerId, seleccionados, excluir) {
  const el = document.getElementById(containerId); if (!el) return;
  const sel = new Set(seleccionados || []);
  const exc = new Set(excluir || []);
  el.innerHTML = MODULOS.map(m => {
    const fijo = m.id === 'dashboard';
    const oculto = exc.has(m.id);
    if (oculto) return '';
    return '<label' + (fijo ? ' class="mod-fijo"' : '') + '>' +
      '<input type="checkbox" value="' + m.id + '"' +
      ((fijo || sel.has(m.id)) ? ' checked' : '') + (fijo ? ' disabled' : '') + '>' +
      m.label + '</label>';
  }).join('');
}

function leerModulosChecks(containerId) {
  const el = document.getElementById(containerId); if (!el) return [];
  return [...el.querySelectorAll('input:checked:not(:disabled)')].map(i => i.value);
}

// ---- Módulos por rol (tarjeta de permisos) ----
function renderPermModulos() {
  const rolSel = document.getElementById('perm-rol'); if (!rolSel) return;
  renderModulosChecks('perm-modulos', vistasDeRol(rolSel.value));
}

document.getElementById('perm-rol').addEventListener('change', renderPermModulos);

document.getElementById('perm-guardar').addEventListener('click', async () => {
  const rol = document.getElementById('perm-rol').value;
  const vistas = ['dashboard', ...leerModulosChecks('perm-modulos').filter(v => v !== 'dashboard')];
  if (rol === 'administrador' && !vistas.includes('usuarios')) {
    showToast('El rol administrador debe conservar el módulo Usuarios', 'error'); return;
  }
  try {
    await setDoc(doc(db, 'roles_config', rol), { vistas, fecha_modificacion: Timestamp.now() });
    showToast('Módulos del rol ' + (ROLES_LABEL[rol] || rol) + ' guardados');
  } catch (e) { console.error(e); showToast('Error al guardar los módulos del rol', 'error'); }
});

document.getElementById('perm-restaurar').addEventListener('click', async () => {
  const rol = document.getElementById('perm-rol').value;
  if (!confirm('¿Restaurar los módulos por defecto del rol ' + (ROLES_LABEL[rol] || rol) + '?')) return;
  try {
    await deleteDoc(doc(db, 'roles_config', rol));
    showToast('Módulos por defecto restaurados');
  } catch (e) { console.error(e); showToast('Error al restaurar', 'error'); }
});

function updateUsuariosTable() {
  const tb = document.getElementById('usuarios-table'); if (!tb) return;
  document.getElementById('usr-count').textContent = usuarios.length + ' usuario' + (usuarios.length !== 1 ? 's' : '');
  if (!usuarios.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay usuarios</td></tr>'; return; }
  const labelMod = id => (MODULOS.find(m => m.id === id) || { label: id }).label;
  tb.innerHTML = usuarios.map(u => '<tr>' +
    '<td>' + (u.nombre || '-') + '</td><td>' + u.username + '</td>' +
    '<td>' + (ROLES_LABEL[u.rol] || u.rol) + '</td>' +
    '<td>' + ((u.modulos_extra && u.modulos_extra.length) ? u.modulos_extra.map(labelMod).join(', ') : '-') + '</td>' +
    '<td>' + (u.activo === false ? 'Inactivo' : 'Activo') + '</td>' +
    '<td>' + fdate(u.fecha_creacion) + '</td>' +
    '<td class="actions">' +
      '<button class="btn-icon" data-edit-usr="' + u.id + '" title="Editar">\u270f\ufe0f</button>' +
      '<button class="btn-icon" data-tog-usr="' + u.id + '" title="' + (u.activo === false ? 'Activar' : 'Desactivar') + '">' + (u.activo === false ? '\u2705' : '\ud83d\udeab') + '</button>' +
      '<button class="btn-icon" data-del-usr="' + u.id + '" title="Eliminar">\ud83d\uddd1\ufe0f</button>' +
    '</td></tr>').join('');
  tb.querySelectorAll('[data-edit-usr]').forEach(b => b.addEventListener('click', () => editUsuario(b.dataset.editUsr)));
  tb.querySelectorAll('[data-tog-usr]').forEach(b => b.addEventListener('click', () => toggleUsuario(b.dataset.togUsr)));
  tb.querySelectorAll('[data-del-usr]').forEach(b => b.addEventListener('click', () => delUsuario(b.dataset.delUsr)));
}

document.getElementById('usr-rol').addEventListener('change', () => {
  const rol = document.getElementById('usr-rol').value;
  renderModulosChecks('usr-modulos', [], rol ? vistasDeRol(rol) : []);
});

document.getElementById('usuario-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = document.getElementById('usr-nombre').value.trim();
  const username = document.getElementById('usr-username').value.trim().toLowerCase();
  const password = document.getElementById('usr-password').value;
  const rol = document.getElementById('usr-rol').value;
  if (!nombre || !username || !password || !rol) { showToast('Complete todos los campos', 'error'); return; }
  if (password.length < 6) { showToast('La contrase\u00f1a debe tener al menos 6 caracteres', 'error'); return; }
  if (usuarios.some(u => u.username === username)) { showToast('El nombre de usuario ya existe', 'error'); return; }
  try {
    const password_hash = await hashPassword(password);
    // Se persiste solo el hash; el rol queda fijo desde la creaci\u00f3n.
    const base = new Set(vistasDeRol(rol));
    const modulos_extra = leerModulosChecks('usr-modulos').filter(v => !base.has(v));
    await addDoc(collection(db, 'usuarios'), {
      nombre, username, password_hash, rol, modulos_extra,
      activo: true,
      fecha_creacion: Timestamp.now()
    });
    showToast('Usuario ' + username + ' creado');
    document.getElementById('usuario-form').reset();
    renderModulosChecks('usr-modulos', []);
  } catch (err) { console.error(err); showToast('Error al crear el usuario', 'error'); }
});

function editUsuario(id) {
  const u = usuarios.find(x => x.id === id); if (!u) return;
  document.getElementById('eu-id').value = u.id;
  document.getElementById('eu-nombre').value = u.nombre || '';
  document.getElementById('eu-username').value = u.username || '';
  document.getElementById('eu-password').value = '';
  document.getElementById('eu-rol').value = ROLES_LABEL[u.rol] || u.rol; // solo lectura
  renderModulosChecks('eu-modulos', u.modulos_extra || [], vistasDeRol(u.rol));
  document.getElementById('modal-usuario').classList.add('active');
}

document.getElementById('edit-usuario-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('eu-id').value;
  const nombre = document.getElementById('eu-nombre').value.trim();
  const username = document.getElementById('eu-username').value.trim().toLowerCase();
  const password = document.getElementById('eu-password').value;
  if (usuarios.some(u => u.username === username && u.id !== id)) { showToast('El nombre de usuario ya existe', 'error'); return; }
  const cambios = { nombre, username, modulos_extra: leerModulosChecks('eu-modulos') }; // el rol NO se incluye: no es modificable
  if (password) {
    if (password.length < 6) { showToast('La nueva contrase\u00f1a debe tener al menos 6 caracteres', 'error'); return; }
    cambios.password_hash = await hashPassword(password);
  }
  try {
    await updateDoc(doc(db, 'usuarios', id), cambios);
    if (sesionActual && sesionActual.id === id) {
      sesionActual.modulos_extra = cambios.modulos_extra;
      localStorage.setItem(SESSION_KEY, JSON.stringify(sesionActual));
      aplicarRol(sesionActual.rol, sesionActual.modulos_extra);
    }
    showToast('Usuario actualizado');
    document.getElementById('modal-usuario').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});

async function toggleUsuario(id) {
  const u = usuarios.find(x => x.id === id); if (!u) return;
  if (sesionActual && sesionActual.id === id) { showToast('No puede desactivar su propia cuenta', 'error'); return; }
  try {
    await updateDoc(doc(db, 'usuarios', id), { activo: u.activo === false });
    showToast('Usuario ' + (u.activo === false ? 'activado' : 'desactivado'));
  } catch (e) { console.error(e); showToast('Error al cambiar estado', 'error'); }
}

async function delUsuario(id) {
  if (!confirm('\u00bfEliminar este usuario?')) return;
  try { await deleteDoc(doc(db, 'usuarios', id)); showToast('Usuario eliminado'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

// Verificaci\u00f3n de credenciales (para el login futuro):
// compara el hash del password ingresado contra password_hash guardado.
async function verificarCredenciales(username, password) {
  const u = usuarios.find(x => x.username === String(username).trim().toLowerCase());
  if (!u || u.activo === false) return null;
  const hash = await hashPassword(password);
  return hash === u.password_hash ? { id: u.id, nombre: u.nombre, username: u.username, rol: u.rol, modulos_extra: u.modulos_extra || [] } : null;
}
window.verificarCredenciales = verificarCredenciales;

// ============================================================
//  SECCIONES (CRUD)
// ============================================================
function updateSeccionesTable() {
  const tb = document.getElementById('secciones-table'); if (!tb) return;
  document.getElementById('seccion-count').textContent = secciones.length + ' sección' + (secciones.length !== 1 ? 'es' : '');
  if (!secciones.length) { tb.innerHTML = '<tr><td colspan="2" class="empty-state">No hay secciones</td></tr>'; return; }
  tb.innerHTML = secciones.map(s => '<tr><td>' + s.nombre + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-sec="' + s.id + '">✏️</button><button class="btn-icon" data-del-sec="' + s.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-sec]').forEach(b => b.addEventListener('click', () => editSeccion(b.dataset.editSec)));
  tb.querySelectorAll('[data-del-sec]').forEach(b => b.addEventListener('click', () => delSeccion(b.dataset.delSec)));
}
document.getElementById('seccion-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await addDoc(collection(db, 'secciones'), { nombre: document.getElementById('seccion-nombre').value.trim(), fecha_creacion: Timestamp.now() });
    showToast('Sección guardada'); document.getElementById('seccion-form').reset();
  } catch (err) { console.error(err); showToast('Error al guardar', 'error'); }
});
function editSeccion(id) {
  const s = secciones.find(x => x.id === id); if (!s) return;
  document.getElementById('es-id').value = s.id;
  document.getElementById('es-nombre').value = s.nombre;
  document.getElementById('modal-seccion').classList.add('active');
}
document.getElementById('edit-seccion-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await updateDoc(doc(db, 'secciones', document.getElementById('es-id').value), { nombre: document.getElementById('es-nombre').value.trim() });
    showToast('Sección actualizada'); document.getElementById('modal-seccion').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
async function delSeccion(id) {
  if (!confirm('¿Eliminar esta sección?')) return;
  try { await deleteDoc(doc(db, 'secciones', id)); showToast('Sección eliminada'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
}

// ============================================================
//  HISTORIAL / ACTAS (entradas y salidas por fecha, detalle, reimprimir, anular)
// ============================================================
function histRango() {
  const fromEl = document.getElementById('hist-from');
  if (!fromEl) return null;
  const from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const toV = document.getElementById('hist-to').value;
  const to = toV ? new Date(toV + 'T23:59:59') : null;
  const estado = document.getElementById('hist-estado').value;
  return { from, to, estado };
}
function filtrarHistRecepciones() {
  const r = histRango(); if (!r) return facturas;
  return facturas.filter(f => {
    if (r.estado === 'vigentes' && f.anulada) return false;
    if (r.estado === 'anuladas' && !f.anulada) return false;
    const fd = toDate(f.fecha_recepcion);
    if (r.from && fd < r.from) return false;
    if (r.to && fd > r.to) return false;
    return true;
  });
}
function filtrarHistSalidas() {
  const r = histRango(); if (!r) return salidas;
  return salidas.filter(s => {
    if (r.estado === 'vigentes' && s.anulada) return false;
    if (r.estado === 'anuladas' && !s.anulada) return false;
    const fd = toDate(s.fecha_salida);
    if (r.from && fd < r.from) return false;
    if (r.to && fd > r.to) return false;
    return true;
  });
}
function initHistFiltros() {
  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('hist-from', hace30); set('hist-to', hoy); set('hist-estado', 'vigentes');
  updateHistRecepciones(); updateHistSalidas();
}
['hist-from', 'hist-to', 'hist-estado'].forEach(id => {
  const e = document.getElementById(id);
  if (e) e.addEventListener('input', () => { updateHistRecepciones(); updateHistSalidas(); });
});
document.getElementById('hist-limpiar').addEventListener('click', initHistFiltros);

function updateHistRecepciones() {
  const tb = document.getElementById('hist-recepciones'); if (!tb) return;
  const data = filtrarHistRecepciones();
  if (!data.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay recepciones con esos filtros</td></tr>'; return; }
  tb.innerHTML = data.map(f => '<tr class="' + (f.anulada ? 'row-anulada' : '') + '">' +
    '<td>' + f.n_acta + '</td><td>' + fdate(f.fecha_recepcion) + '</td><td>' + f.razon_social + '</td><td>' + f.n_factura + '</td><td>' + money(f.total) + '</td>' +
    '<td>' + (f.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">Vigente</span>') + '</td>' +
    '<td class="actions"><button class="btn btn-sm btn-secondary" data-hist-rec-det="' + f.id + '">Ver detalle</button>' +
    '<button class="btn btn-sm btn-secondary" data-rec-pdf="' + f.id + '">Recepción</button>' +
    '<button class="btn btn-sm btn-secondary" data-ing-pdf="' + f.id + '">Ingreso</button>' +
    (f.anulada ? '' : '<button class="btn btn-sm btn-danger" data-anular-rec="' + f.id + '">Anular</button>') + '</td></tr>').join('');
  tb.querySelectorAll('[data-hist-rec-det]').forEach(b => b.addEventListener('click', () => verDetalleFactura(b.dataset.histRecDet)));
  tb.querySelectorAll('[data-rec-pdf]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.recPdf); if (f) actaRecepcion(f); }));
  tb.querySelectorAll('[data-ing-pdf]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.ingPdf); if (f) actaIngresoPanol(f); }));
  tb.querySelectorAll('[data-anular-rec]').forEach(b => b.addEventListener('click', () => abrirAnular('recepcion', b.dataset.anularRec)));
}
function updateHistSalidas() {
  const tb = document.getElementById('hist-salidas'); if (!tb) return;
  const data = filtrarHistSalidas();
  if (!data.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay salidas con esos filtros</td></tr>'; return; }
  tb.innerHTML = data.map(s => '<tr class="' + (s.anulada ? 'row-anulada' : '') + '">' +
    '<td>' + s.n_acta + '</td><td>' + fdate(s.fecha_salida) + '</td><td>' + s.seccion + '</td><td>' + (s.solicitante || '-') + '</td><td>' + money(s.costo_total) + '</td>' +
    '<td>' + (s.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">Vigente</span>') + '</td>' +
    '<td class="actions"><button class="btn btn-sm btn-secondary" data-hist-sal-det="' + s.id + '">Ver detalle</button>' +
    '<button class="btn btn-sm btn-secondary" data-sal-pdf="' + s.id + '">Acta PDF</button>' +
    (s.anulada ? '' : '<button class="btn btn-sm btn-danger" data-anular-sal="' + s.id + '">Anular</button>') + '</td></tr>').join('');
  tb.querySelectorAll('[data-hist-sal-det]').forEach(b => b.addEventListener('click', () => verDetalleSalida(b.dataset.histSalDet)));
  tb.querySelectorAll('[data-sal-pdf]').forEach(b => b.addEventListener('click', () => { const s = salidas.find(x => x.id === b.dataset.salPdf); if (s) actaSalidaPanol(s); }));
  tb.querySelectorAll('[data-anular-sal]').forEach(b => b.addEventListener('click', () => abrirAnular('salida', b.dataset.anularSal)));
}

let salidaDetalle = null;
function verDetalleSalida(id) {
  const s = salidas.find(x => x.id === id); if (!s) return;
  salidaDetalle = s;
  document.getElementById('ms-titulo').textContent = 'Salida N° ' + (s.n_acta || '-') + (s.anulada ? ' (ANULADA)' : '');
  const dato = (l, v) => '<div><span class="dg-label">' + l + '</span>' + (v || '-') + '</div>';
  document.getElementById('ms-datos').innerHTML =
    dato('N° Acta Salida', s.n_acta) +
    dato('Sección', s.seccion) +
    dato('Solicitante', s.solicitante) +
    dato('Fecha salida', fdate(s.fecha_salida)) +
    (s.anulada ? dato('Motivo anulación', s.motivo_anulacion) : '');
  document.getElementById('ms-items').innerHTML = (s.items || []).map((it, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + it.codigo + '</td><td>' + it.nombre + '</td><td>' + num(it.cantidad) +
    '</td><td>' + it.unidad + '</td><td>' + money(it.costo_unit) + '</td><td>' + money(it.costo_total) + '</td></tr>').join('');
  document.getElementById('ms-totales').innerHTML =
    '<span>Costo Total:<strong>' + money(s.costo_total) + '</strong></span>';
  document.getElementById('modal-salida').classList.add('active');
}
document.getElementById('ms-pdf').addEventListener('click', () => { if (salidaDetalle) actaSalidaPanol(salidaDetalle); });

document.getElementById('hist-csv-rec').addEventListener('click', () => {
  const data = filtrarHistRecepciones().map(f => ({
    'N Acta': f.n_acta || '', 'N Factura': f.n_factura || '', 'Fecha Recepcion': fdate(f.fecha_recepcion),
    'Proveedor': f.razon_social || '', 'RUT': f.rut || '',
    'Neto': Number(f.neto) || 0, 'IVA': Number(f.iva) || 0, 'Total': Number(f.total) || 0,
    'Estado': f.anulada ? 'ANULADA' : 'VIGENTE'
  }));
  descargarCSV('entradas', data);
});
document.getElementById('hist-csv-sal').addEventListener('click', () => {
  const data = filtrarHistSalidas().map(s => ({
    'N Acta': s.n_acta || '', 'Fecha Salida': fdate(s.fecha_salida),
    'Seccion': s.seccion || '', 'Solicitante': s.solicitante || '',
    'Costo total': Number(s.costo_total) || 0, 'Estado': s.anulada ? 'ANULADA' : 'VIGENTE'
  }));
  descargarCSV('salidas', data);
});

function abrirAnular(tipo, id) {
  document.getElementById('an-tipo').value = tipo;
  document.getElementById('an-id').value = id;
  document.getElementById('an-motivo').value = '';
  document.getElementById('modal-anular').classList.add('active');
}
document.getElementById('anular-form').addEventListener('submit', async e => {
  e.preventDefault();
  const tipo = document.getElementById('an-tipo').value;
  const id = document.getElementById('an-id').value;
  const motivo = document.getElementById('an-motivo').value.trim();
  if (!motivo) { showToast('Ingrese el motivo', 'error'); return; }
  try {
    if (tipo === 'recepcion') {
      const f = facturas.find(x => x.id === id);
      for (const it of f.items) {
        const a = articulos.find(x => x.id === it.articulo_id);
        if (!a) continue;
        const newStock = Math.max(0, (Number(a.stock) || 0) - it.cantidad);
        const prevValor = (Number(a.stock) || 0) * (Number(a.costo_promedio) || 0);
        const newValor = Math.max(0, prevValor - it.cantidad * it.precio);
        const newCosto = newStock > 0 ? newValor / newStock : 0;
        await updateDoc(doc(db, 'articulos', a.id), { stock: newStock, costo_promedio: newCosto, valor_saldo: newStock * newCosto });
      }
      await updateDoc(doc(db, 'facturas', id), { anulada: true, motivo_anulacion: motivo, fecha_anulacion: Timestamp.now() });
    } else {
      const s = salidas.find(x => x.id === id);
      for (const it of s.items) {
        const a = articulos.find(x => x.id === it.articulo_id);
        if (!a) continue;
        const newStock = (Number(a.stock) || 0) + it.cantidad;
        const costo = Number(a.costo_promedio) || it.costo_unit || 0;
        await updateDoc(doc(db, 'articulos', a.id), { stock: newStock, valor_saldo: newStock * costo });
      }
      await updateDoc(doc(db, 'salidas', id), { anulada: true, motivo_anulacion: motivo, fecha_anulacion: Timestamp.now() });
    }
    showToast('Acta anulada y saldos revertidos');
    document.getElementById('modal-anular').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al anular', 'error'); }
});

// ============================================================
//  REPORTES
// ============================================================
const MONEDA = new Set(['Precio','Costo prom.','Saldo valorizado','Valorizado','Costo total','Valor entrada','Valor salida','Saldo valor','Precio unit.','Costo unit.','Neto','IVA','Total','Debe','Haber']);
const NUMERO = new Set(['Stock','Stock mín.','Cantidad','Entrada','Salida','Saldo','Diferencia','Cant.']);
let reportData = [], reportType = '';

function fmtCell(h, v) {
  if (MONEDA.has(h)) return money(v);
  if (NUMERO.has(h)) { if ((h === 'Entrada' || h === 'Salida') && (Number(v) || 0) === 0) return '-'; return num(v); }
  return (v === null || v === undefined || v === '') ? '-' : v;
}
function displayReport(title, data) {
  reportData = data;
  document.getElementById('report-title').textContent = title;
  const thead = document.getElementById('report-thead'), tbody = document.getElementById('report-tbody');
  if (!data.length) {
    thead.innerHTML = ''; tbody.innerHTML = '<tr><td class="empty-state">No hay datos</td></tr>';
  } else {
    const hs = Object.keys(data[0]);
    thead.innerHTML = '<tr>' + hs.map(h => '<th>' + h + '</th>').join('') + '</tr>';
    tbody.innerHTML = data.map(r => '<tr>' + hs.map(h => '<td>' + fmtCell(h, r[h]) + '</td>').join('') + '</tr>').join('');
  }
  document.getElementById('report-result').style.display = 'block';
  document.getElementById('report-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.reporteInventario = function () {
  reportType = 'inventario';
  displayReport('Inventario Valorizado', articulos.map(a => ({
    'Código': a.codigo, 'Nombre': a.nombre, 'Cuenta': a.cuenta_nombre || '-',
    'Stock': Number(a.stock) || 0, 'Unidad': a.unidad_medida, 'Stock mín.': Number(a.stock_minimo) || 0,
    'Costo prom.': Number(a.costo_promedio) || 0, 'Saldo valorizado': (Number(a.stock) || 0) * (Number(a.costo_promedio) || 0),
    'Estado': Number(a.stock) === 0 ? 'Sin Stock' : Number(a.stock) <= Number(a.stock_minimo) ? 'Stock Bajo' : 'Disponible'
  })));
};
window.reporteFamilia = function () {
  const agrupado = {};
  articulos.forEach(a => {
    const k = a.familia_nombre || 'SIN FAMILIA';
    if (!agrupado[k]) agrupado[k] = { 'Familia': k, 'Artículos': 0, 'Stock total': 0, 'Valorizado': 0 };
    agrupado[k]['Artículos'] += 1;
    agrupado[k]['Stock total'] += Number(a.stock) || 0;
    agrupado[k]['Valorizado'] += (Number(a.stock) || 0) * (Number(a.costo_promedio) || 0);
  });
  const data = Object.values(agrupado).sort((a, b) => a['Familia'].localeCompare(b['Familia']));
  const totalVal = data.reduce((s, r) => s + r['Valorizado'], 0);
  data.push({ 'Familia': 'TOTAL', 'Artículos': articulos.length, 'Stock total': '', 'Valorizado': totalVal });
  reportType = 'inventario_familia';
  displayReport('Inventario por familia', data);
};

window.reporteCritico = function () {
  reportType = 'critico';
  const bajos = articulos.filter(a => Number(a.stock) <= Number(a.stock_minimo));
  displayReport('Stock Crítico', bajos.map(a => ({
    'Código': a.codigo, 'Nombre': a.nombre, 'Stock': Number(a.stock) || 0, 'Stock mín.': Number(a.stock_minimo) || 0,
    'Diferencia': (Number(a.stock_minimo) || 0) - (Number(a.stock) || 0),
    'Estado': Number(a.stock) === 0 ? 'Sin Stock' : 'Stock Bajo'
  })));
};
function movsEnRango(fromId, toId, filtro) {
  const from = document.getElementById(fromId).value, to = document.getElementById(toId).value;
  let list = movimientos.filter(filtro || (() => true));
  if (from) { const fd = new Date(from + 'T00:00:00'); list = list.filter(m => toDate(m.fecha_doc || m.fecha_creacion) >= fd); }
  if (to) { const td = new Date(to + 'T23:59:59'); list = list.filter(m => toDate(m.fecha_doc || m.fecha_creacion) <= td); }
  return list.sort((a, b) => toDate(a.fecha_doc || a.fecha_creacion) - toDate(b.fecha_doc || b.fecha_creacion));
}
window.reporteMayor = function () {
  reportType = 'mayor';
  const artId = document.getElementById('rep-art').value;
  let list = movsEnRango('rep-mayor-from', 'rep-mayor-to', m => artId === 'all' ? true : m.articulo_id === artId);
  displayReport('Mayor de Existencias', list.map(m => ({
    'Fecha': fdate(m.fecha_doc || m.fecha_creacion), 'Código': m.codigo, 'Artículo': m.nombre,
    'Documento': (m.tipo_documento || '') + ' ' + (m.n_documento || ''),
    'Entrada': m.tipo === 'entrada' ? Number(m.cantidad) : 0,
    'Salida': m.tipo === 'salida' ? Number(m.cantidad) : 0,
    'Precio unit.': Number(m.precio_unit) || 0, 'Saldo': Number(m.saldo_cant) || 0, 'Saldo valor': Number(m.saldo_valor) || 0
  })));
};
window.reporteMovimientos = function () {
  reportType = 'movimientos';
  let list = movsEnRango('rep-mov-from', 'rep-mov-to');
  displayReport('Movimientos por Fecha', list.map(m => ({
    'Fecha': fdate(m.fecha_doc || m.fecha_creacion), 'Tipo': cap(m.tipo), 'Código': m.codigo, 'Artículo': m.nombre,
    'Cantidad': Number(m.cantidad) || 0, 'Costo total': Number(m.costo_total) || 0,
    'Documento': (m.tipo_documento || '') + ' ' + (m.n_documento || '')
  })));
};
window.reporteCostosSeccion = function () {
  reportType = 'costos_seccion';
  let list = movsEnRango('rep-sec-from', 'rep-sec-to', m => m.tipo === 'salida');
  const g = {};
  list.forEach(m => { const k = m.seccion || 'SIN SECCIÓN'; g[k] = g[k] || { cant: 0, costo: 0 }; g[k].cant += Number(m.cantidad) || 0; g[k].costo += Number(m.costo_total) || 0; });
  displayReport('Costos por Sección', Object.keys(g).map(k => ({ 'Sección': k, 'Cantidad': g[k].cant, 'Costo total': g[k].costo })));
};
window.reporteCostosArticulo = function () {
  reportType = 'costos_articulo';
  let list = movsEnRango('rep-cart-from', 'rep-cart-to', m => m.tipo === 'salida');
  const g = {};
  list.forEach(m => { const k = m.codigo; g[k] = g[k] || { nombre: m.nombre, cant: 0, costo: 0 }; g[k].cant += Number(m.cantidad) || 0; g[k].costo += Number(m.costo_total) || 0; });
  displayReport('Costos por Artículo', Object.keys(g).map(k => ({ 'Código': k, 'Artículo': g[k].nombre, 'Cantidad': g[k].cant, 'Costo total': g[k].costo })));
};

window.exportReportCSV = function () {
  if (!reportData.length) { showToast('No hay datos para exportar', 'error'); return; }
  const hs = Object.keys(reportData[0]);
  const csv = [hs.join(','), ...reportData.map(r => hs.map(h => { let v = r[h]; if (typeof v === 'string' && v.includes(',')) v = '"' + v + '"'; return v; }).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'reporte_' + reportType + '_' + new Date().toISOString().split('T')[0] + '.csv'; a.click();
  showToast('CSV exportado');
};
window.exportReportExcel = function () {
  if (!reportData.length) { showToast('No hay datos', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('No se cargó el componente Excel', 'error'); return; }
  const ws = XLSX.utils.json_to_sheet(reportData);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, 'reporte_' + reportType + '_' + new Date().toISOString().split('T')[0] + '.xlsx');
  showToast('Excel generado');
};
window.exportReportPDF = function () {
  if (!reportData.length) { showToast('No hay datos', 'error'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('No se cargó el componente PDF', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const hs = Object.keys(reportData[0]);
  const many = hs.length > 7;
  const d = new jsPDF({ orientation: many ? 'landscape' : 'portrait' });
  const title = document.getElementById('report-title').textContent;
  d.setFontSize(13); d.text(title, 14, 15);
  d.setFontSize(9); d.setTextColor(120);
  d.text(CONFIG.recinto + ' · ' + new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' · ' + reportData.length + ' registro(s)', 14, 21);
  d.autoTable({ head: [hs], body: reportData.map(r => hs.map(h => fmtCell(h, r[h]))), startY: 26,
    styles: { fontSize: many ? 7 : 9, cellPadding: 2 }, headStyles: { fillColor: [79, 70, 229] }, alternateRowStyles: { fillColor: [248, 250, 252] } });
  d.save('reporte_' + reportType + '_' + new Date().toISOString().split('T')[0] + '.pdf');
  showToast('PDF generado');
};
window.printReport = function () {
  if (!reportData.length) { showToast('No hay datos', 'error'); return; }
  const title = document.getElementById('report-title').textContent;
  const hs = Object.keys(reportData[0]);
  const filas = reportData.map(r => '<tr>' + hs.map(h => '<td>' + fmtCell(h, r[h]) + '</td>').join('') + '</tr>').join('');
  const win = window.open('', '_blank');
  if (!win) { showToast('Habilite las ventanas emergentes', 'error'); return; }
  win.document.write('<html><head><title>' + title + '</title><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;color:#1e293b;margin:24px}h1{font-size:18px;margin:0 0 4px}' +
    '.meta{font-size:12px;color:#64748b;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9;text-transform:uppercase;font-size:11px}' +
    'tr:nth-child(even) td{background:#f8fafc}@media print{body{margin:12mm}}</style></head><body>' +
    '<h1>' + title + '</h1><div class="meta">' + CONFIG.recinto + ' · ' + reportData.length + ' registro(s)</div>' +
    '<table><thead><tr>' + hs.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + filas + '</tbody></table>' +
    '<scr' + 'ipt>window.onload=function(){window.print();}</scr' + 'ipt></body></html>');
  win.document.close();
};

// ============================================================
//  BÚSQUEDA GLOBAL
// ============================================================
document.getElementById('global-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  const arts = q ? articulos.filter(a => String(a.nombre).toLowerCase().includes(q) || String(a.codigo).toLowerCase().includes(q) || String(a.cuenta_nombre || '').toLowerCase().includes(q)) : [];
  document.getElementById('search-art-count').textContent = arts.length + ' resultado' + (arts.length !== 1 ? 's' : '');
  const ta = document.getElementById('search-articulos');
  ta.innerHTML = arts.length ? arts.map(a => '<tr><td>' + a.codigo + '</td><td>' + a.nombre + '</td><td>' + (a.cuenta_nombre || '-') + '</td><td>' + num(a.stock) + '</td><td>' + money(a.costo_promedio) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty-state">Sin resultados</td></tr>';
  const movs = q ? movimientos.filter(m => String(m.nombre).toLowerCase().includes(q) || String(m.codigo || '').toLowerCase().includes(q)) : [];
  document.getElementById('search-mov-count').textContent = movs.length + ' resultado' + (movs.length !== 1 ? 's' : '');
  const tm = document.getElementById('search-movimientos');
  tm.innerHTML = movs.length ? movs.slice(0, 50).map(m => '<tr><td>' + fdatetime(m.fecha_creacion) + '</td><td><span class="badge ' + (m.tipo === 'entrada' ? 'badge-success' : 'badge-danger') + '">' + cap(m.tipo) + '</span></td><td>' + m.nombre + '</td><td>' + num(m.cantidad) + '</td><td>' + (m.tipo_documento || '') + ' ' + (m.n_documento || '') + '</td></tr>').join('') : '<tr><td colspan="5" class="empty-state">Sin resultados</td></tr>';
});

// ============================================================
//  Seed inicial + Inicialización
// ============================================================
async function seedIfEmpty(coll, docs) {
  const snap = await getDocs(collection(db, coll));
  if (!snap.empty) return;
  for (const d of docs) await addDoc(collection(db, coll), { ...d, fecha_creacion: Timestamp.now() });
}
async function seedInicial() {
  await seedIfEmpty('cuentas_contables', [
    { codigo: '53203010100000', nombre: 'Combustible Lubric P.Vehículos' },
    { codigo: '53204010000000', nombre: 'Materiales de Oficina' },
    { codigo: '53204070000000', nombre: 'Mat. y Utiles de Aseo' },
    { codigo: '53204090000000', nombre: 'Insumos Rep. y Acc.Comput' },
    { codigo: '53204100100002', nombre: 'Mat.P/Maten. y Reparación Indirectos' },
    { codigo: '55201010100002', nombre: 'Otros Mat.Rep. y Util.Diversos' }
  ]);
  await seedIfEmpty('firmantes', [
    { nombre: 'DAVID RÍOS CORDERO', grado: 'SUBOFICIAL (GDM)', cargo: 'ENC. CENTRAL DE DISTRIBUCIÓN', rut: '13.723.673-7', orden: 1 },
    { nombre: 'MAURICIO BENAVIDES MENDOZA', grado: 'TENIENTE PRIMERO AB.', cargo: 'JEFE DEPTO. ABASTECIMIENTO Y FZAS.', rut: '18.201.238-6', orden: 2 },
    { nombre: 'SEBASTIÁN FERNÁNDEZ DÍAZ', grado: 'CAPITÁN DE CORBETA', cargo: 'SUB-JEFE DEPTO. BITAR. SOCIAL IIa Z.N', rut: '15.071.331-5', orden: 3 }
  ]);
  // Usuario inicial si la colección está vacía (cambiar la contraseña al primer ingreso)
  const usrSnap = await getDocs(collection(db, 'usuarios'));
  if (usrSnap.empty) {
    await addDoc(collection(db, 'usuarios'), {
      nombre: 'ADMINISTRADOR INICIAL',
      username: 'admin',
      password_hash: await hashPassword('admin123'),
      rol: 'administrador',
      activo: true,
      fecha_creacion: Timestamp.now()
    });
    console.warn('Usuario inicial creado: admin / admin123 — cambie la contraseña.');
  }
  await seedIfEmpty('secciones', [
    { nombre: 'COCINA' }, { nombre: 'BAR' }, { nombre: 'PANADERÍA' }, { nombre: 'LAVANDERÍA' }, { nombre: 'JARDINES' }
  ]);
}

function initFechas() {
  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  [['rec-fecha-factura', hoy], ['rec-fecha-recepcion', hoy], ['sal-fecha', hoy]].forEach(([id, v]) => { const e = document.getElementById(id); if (e) e.value = v; });
  [['rep-mayor-from', hace30], ['rep-mayor-to', hoy], ['rep-sec-from', hace30], ['rep-sec-to', hoy],
   ['rep-cart-from', hace30], ['rep-cart-to', hoy], ['rep-mov-from', hace30], ['rep-mov-to', hoy]]
    .forEach(([id, v]) => { const e = document.getElementById(id); if (e) e.value = v; });
}

attachRut('rec-prov-rut', { permitirNombre: true });
attachRut('prov-rut'); attachRut('ep-rut'); attachRut('qp-rut');
attachRut('firm-rut'); attachRut('ef-rut');

async function init() {
  if (!db) return;
  llenarUnidades();
  initFechas();
  renderRecItems();
  renderSalItems();
  try { await seedInicial(); } catch (e) { console.error('Seed error:', e); }
  setupListeners();
  renderModulosChecks('usr-modulos', []);
  renderPermModulos();
  initFacFiltros();
  initHistFiltros();
  const sesion = leerSesion();
  if (sesion && sesion.username && sesion.rol) mostrarApp(sesion);
  else mostrarLogin();
}
init();