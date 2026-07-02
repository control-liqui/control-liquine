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
  apiKey: "AIzaSyCGLhqCndD9zpSraPhYLAMul6jtvavcoek",
  authDomain: "inventario-49d3b.firebaseapp.com",
  projectId: "inventario-49d3b",
  storageBucket: "inventario-49d3b.firebasestorage.app",
  messagingSenderId: "837690492755",
  appId: "1:837690492755:web:9882ffec8433786556c3a6",
  measurementId: "G-HRH7SSM5ZB"
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
let articulos = [], proveedores = [], cuentas = [], firmantes = [], secciones = [];
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
  administrador: ['dashboard','recepcion','salidas','inventario','articulos','proveedores','cuentas','firmantes','secciones','historial','reportes','buscar'],
  bodeguero:     ['dashboard','recepcion','salidas','inventario','articulos','proveedores','historial','buscar'],
  jefe_finanzas: ['dashboard','inventario','historial','reportes','buscar'],
  subjefe:       ['dashboard','inventario','historial','reportes','buscar'],
  encargado:     ['dashboard','salidas','inventario','buscar'],
  contador:      ['dashboard','inventario','reportes','buscar'],
  auditor:       ['dashboard','inventario','historial','reportes','buscar']
};

function aplicarRol(rol) {
  const permitidas = ROLES_VIEWS[rol] || ROLES_VIEWS.administrador;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.style.display = permitidas.includes(n.dataset.view) ? '' : 'none';
  });
  const activa = document.querySelector('.nav-item.active');
  if (!activa || activa.style.display === 'none') irAVista('dashboard');
}

function irAVista(viewId) {
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

const roleSelect = document.getElementById('role-select');
const rolGuardado = localStorage.getItem('rol_actual') || 'administrador';
roleSelect.value = rolGuardado;
aplicarRol(rolGuardado);
roleSelect.addEventListener('change', () => {
  localStorage.setItem('rol_actual', roleSelect.value);
  aplicarRol(roleSelect.value);
});

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

  onSnapshot(query(collection(db, 'facturas'), orderBy('fecha_creacion', 'desc')), snap => {
    facturas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboard(); updateHistRecepciones();
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
    String(a.codigo).toUpperCase().includes(v) || String(a.nombre).toUpperCase().includes(v)
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
  }
);

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
  const ivaEl = document.getElementById('rec-iva');
  if (document.activeElement !== ivaEl) ivaEl.value = Math.round(neto * CONFIG.iva);
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
  let list = [...articulos];
  if (cf !== 'all') list = list.filter(a => String(a.cuenta_codigo) === String(cf));
  if (sf !== 'all') list = list.filter(a => {
    const st = Number(a.stock), mn = Number(a.stock_minimo);
    if (sf === 'available') return st > mn;
    if (sf === 'low') return st > 0 && st <= mn;
    if (sf === 'out') return st === 0;
    return true;
  });
  if (!list.length) { tb.innerHTML = '<tr><td colspan="10" class="empty-state">No hay artículos que mostrar</td></tr>'; return; }
  tb.innerHTML = list.map(a => {
    const st = Number(a.stock) || 0, mn = Number(a.stock_minimo) || 0, cp = Number(a.costo_promedio) || 0;
    let estado = 'Disponible', bc = 'badge-success';
    if (st === 0) { estado = 'Sin Stock'; bc = 'badge-danger'; }
    else if (st <= mn) { estado = 'Stock Bajo'; bc = 'badge-warning'; }
    return '<tr>' +
      '<td>' + a.codigo + '</td><td>' + a.nombre + '</td><td>' + (a.cuenta_nombre || '-') + '</td>' +
      '<td>' + num(st) + '</td><td>' + a.unidad_medida + '</td><td>' + num(mn) + '</td>' +
      '<td>' + money(cp) + '</td><td>' + money(st * cp) + '</td>' +
      '<td><span class="badge ' + bc + '">' + estado + '</span></td>' +
      '<td class="actions"><button class="btn-icon" data-edit-art="' + a.id + '">✏️</button>' +
      '<button class="btn-icon" data-del-art="' + a.id + '">🗑️</button></td></tr>';
  }).join('');
  tb.querySelectorAll('[data-edit-art]').forEach(b => b.addEventListener('click', () => editArticulo(b.dataset.editArt)));
  tb.querySelectorAll('[data-del-art]').forEach(b => b.addEventListener('click', () => delArticulo(b.dataset.delArt)));
}
['inv-cuenta-filter','inv-status-filter'].forEach(id => {
  const e = document.getElementById(id); if (e) e.addEventListener('change', updateInventoryTable);
});

// ============================================================
//  ARTÍCULOS (CRUD)
// ============================================================
function updateArticulosTable() {
  const tb = document.getElementById('articulos-table'); if (!tb) return;
  document.getElementById('art-count').textContent = articulos.length + ' artículo' + (articulos.length !== 1 ? 's' : '');
  if (!articulos.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">No hay artículos</td></tr>'; return; }
  tb.innerHTML = articulos.map(a => '<tr>' +
    '<td>' + a.codigo + '</td><td>' + a.nombre + '</td><td>' + a.unidad_medida + '</td><td>' + num(a.stock_minimo) + '</td>' +
    '<td>' + (a.cuenta_nombre || '-') + '</td>' +
    '<td class="actions"><button class="btn-icon" data-edit-art="' + a.id + '">✏️</button><button class="btn-icon" data-del-art="' + a.id + '">🗑️</button></td></tr>').join('');
  tb.querySelectorAll('[data-edit-art]').forEach(b => b.addEventListener('click', () => editArticulo(b.dataset.editArt)));
  tb.querySelectorAll('[data-del-art]').forEach(b => b.addEventListener('click', () => delArticulo(b.dataset.delArt)));
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
    await addDoc(collection(db, 'articulos'), {
      codigo, nombre, unidad_medida: unidad, stock_minimo: stockmin,
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
  document.getElementById('modal-articulo').classList.add('active');
}
document.getElementById('edit-articulo-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('ea-id').value;
  const cuentaCod = document.getElementById('ea-cuenta').value;
  try {
    await updateDoc(doc(db, 'articulos', id), {
      nombre: document.getElementById('ea-nombre').value.trim(),
      unidad_medida: document.getElementById('ea-unidad').value,
      stock_minimo: parseFloat(document.getElementById('ea-stockmin').value) || 0,
      cuenta_codigo: cuentaCod, cuenta_nombre: cuentaNombre(cuentaCod)
    });
    showToast('Artículo actualizado');
    document.getElementById('modal-articulo').classList.remove('active');
  } catch (err) { console.error(err); showToast('Error al actualizar', 'error'); }
});
async function delArticulo(id) {
  if (!confirm('¿Eliminar este artículo? (No se recomienda si tiene movimientos)')) return;
  try { await deleteDoc(doc(db, 'articulos', id)); showToast('Artículo eliminado'); }
  catch (e) { console.error(e); showToast('Error al eliminar', 'error'); }
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
//  HISTORIAL / ACTAS (reimprimir + anular)
// ============================================================
function updateHistRecepciones() {
  const tb = document.getElementById('hist-recepciones'); if (!tb) return;
  if (!facturas.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay recepciones</td></tr>'; return; }
  tb.innerHTML = facturas.map(f => '<tr class="' + (f.anulada ? 'row-anulada' : '') + '">' +
    '<td>' + f.n_acta + '</td><td>' + fdate(f.fecha_recepcion) + '</td><td>' + f.razon_social + '</td><td>' + f.n_factura + '</td><td>' + money(f.total) + '</td>' +
    '<td>' + (f.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">Vigente</span>') + '</td>' +
    '<td class="actions"><button class="btn btn-sm btn-secondary" data-rec-pdf="' + f.id + '">Recepción</button>' +
    '<button class="btn btn-sm btn-secondary" data-ing-pdf="' + f.id + '">Ingreso</button>' +
    (f.anulada ? '' : '<button class="btn btn-sm btn-danger" data-anular-rec="' + f.id + '">Anular</button>') + '</td></tr>').join('');
  tb.querySelectorAll('[data-rec-pdf]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.recPdf); if (f) actaRecepcion(f); }));
  tb.querySelectorAll('[data-ing-pdf]').forEach(b => b.addEventListener('click', () => { const f = facturas.find(x => x.id === b.dataset.ingPdf); if (f) actaIngresoPanol(f); }));
  tb.querySelectorAll('[data-anular-rec]').forEach(b => b.addEventListener('click', () => abrirAnular('recepcion', b.dataset.anularRec)));
}
function updateHistSalidas() {
  const tb = document.getElementById('hist-salidas'); if (!tb) return;
  if (!salidas.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay salidas</td></tr>'; return; }
  tb.innerHTML = salidas.map(s => '<tr class="' + (s.anulada ? 'row-anulada' : '') + '">' +
    '<td>' + s.n_acta + '</td><td>' + fdate(s.fecha_salida) + '</td><td>' + s.seccion + '</td><td>' + (s.solicitante || '-') + '</td><td>' + money(s.costo_total) + '</td>' +
    '<td>' + (s.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">Vigente</span>') + '</td>' +
    '<td class="actions"><button class="btn btn-sm btn-secondary" data-sal-pdf="' + s.id + '">Acta PDF</button>' +
    (s.anulada ? '' : '<button class="btn btn-sm btn-danger" data-anular-sal="' + s.id + '">Anular</button>') + '</td></tr>').join('');
  tb.querySelectorAll('[data-sal-pdf]').forEach(b => b.addEventListener('click', () => { const s = salidas.find(x => x.id === b.dataset.salPdf); if (s) actaSalidaPanol(s); }));
  tb.querySelectorAll('[data-anular-sal]').forEach(b => b.addEventListener('click', () => abrirAnular('salida', b.dataset.anularSal)));
}

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
const MONEDA = new Set(['Precio','Costo prom.','Saldo valorizado','Costo total','Valor entrada','Valor salida','Saldo valor','Precio unit.','Costo unit.','Neto','IVA','Total','Debe','Haber']);
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
}
init();