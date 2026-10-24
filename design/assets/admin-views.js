/* Vistas del panel de administración. Funciones puras: (estado, vista) → HTML.
 * El markup sigue el prototipo de design/ref (gc-admin.html): mismas clases y estructura.
 * Los datos vienen de la API (admin.js arma el estado); los montos llegan como texto y
 * los calcula el backend: acá solo se muestran (ADR-0011). */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const esc = GC.esc;
  const fmt = GC.fmt;

  const svg = (size, d, extra) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
  const ICON = {
    chevron: svg(18, '<path d="m9 6 6 6-6 6"/>'),
    grid: svg(18, '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    building: svg(18, '<path d="M5 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M15 10h3a1 1 0 0 1 1 1v9M3 20h18M9 8h2M9 12h2M9 16h2"/>'),
    exit: svg(18, '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>'),
    reset: svg(18, '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>'),
    search: svg(16, '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    palette: svg(18, '<path d="M12 4a8 8 0 1 0 0 16c1.4 0 2-1 1.6-2-.5-1.2.2-2.5 1.6-2.5H17a3 3 0 0 0 3-3A8 8 0 0 0 12 4z"/><circle cx="8" cy="11" r=".8"/><circle cx="12" cy="8" r=".8"/><circle cx="16" cy="11" r=".8"/>'),
    bell: svg(18, '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>'),
    wallet: svg(16, '<path d="M4 8a2 2 0 0 1 2-2h11v3M4 8v9a2 2 0 0 0 2 2h13V9H6a2 2 0 0 1-2-1zM15.5 14h.01"/>'),
    clock: svg(16, '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'),
    alert: svg(16, '<path d="M12 4 3.5 19h17zM12 10v4M12 16.5v.01"/>'),
    chat: svg(16, '<path d="M5 6h14v9H9l-4 3z"/>'),
    safe: svg(16, '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>'),
    arrow: svg(14, '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>'),
    arrowLg: svg(20, '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>'),
    eye: svg(16, '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    bolt: svg(18, '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'),
    bars: svg(18, '<path d="M5 20V11M12 20V5M19 20v-7"/>'),
    list: svg(18, '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
    plus: svg(16, '<path d="M12 5v14M5 12h14"/>'),
    check: svg(16, '<path d="M5 12.5 10 17.5 19 7.5"/>'),
    close: svg(18, '<path d="M6 6l12 12M18 6 6 18"/>'),
  };
  GC.views.ICON = ICON;

  const STATUS = { pagado: 'Al día', revision: 'En revisión', pendiente: 'Pendiente', moroso: 'Moroso', 'sin-cargar': 'Sin liquidación' };
  const LEGEND = { pagado: 'al día', revision: 'en revisión', pendiente: 'pendientes', moroso: 'morosos', 'sin-cargar': 'sin liquidación' };
  const THEMES = [['lagoon', 'Lagoon', '#0e4a5e', '#12909f'], ['noche', 'Azul noche', '#14233d', '#2a86bd'], ['berenjena', 'Berenjena', '#3b1f45', '#1f9e80'], ['bosque', 'Bosque', '#1d3b2f', '#b88a3a'], ['grafito', 'Grafito', '#25282e', '#d9604f']];
  GC.views.STATUS = STATUS;

  const pill = (status, label) => '<span class="pill st-' + status + '">' + esc(label || STATUS[status]) + '</span>';
  GC.views.pill = pill;
  /** Porcentaje para barras y textos (solo visual). */
  const pct = (part, whole) => (Number(whole) ? Math.round((Number(part) / Number(whole)) * 100) : 0);
  const legend = (counts) => Object.keys(LEGEND).filter((k) => counts[k] > 0).map((k) => counts[k] + ' ' + LEGEND[k]).join(' · ');
  const monthWord = (key) => fmt.monthLong(key).split(' ')[0];
  const shortName = (b) => b.name.replace('Edificio ', '');
  const loading = (text) => '<p class="empty">' + esc(text || 'Cargando…') + '</p>';
  GC.views.loading = loading;

  function matchesQuery(text, query) {
    const q = (query || '').trim().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }

  /** Cuentas del edificio ordenadas por unidad y con el propietario primero. */
  function sortedAccounts(accounts) {
    return accounts.slice().sort((x, y) => x.unit.localeCompare(y.unit, 'es', { numeric: true }) || (x.role === 'owner' ? -1 : 1));
  }
  GC.views.sortedAccounts = sortedAccounts;

  const hasTenant = (accounts, unit) => accounts.some((a) => a.unit === unit && a.role === 'tenant');
  GC.views.hasTenant = hasTenant;

  function statusCounts(accounts) {
    const counts = { pagado: 0, revision: 0, pendiente: 0, moroso: 0, 'sin-cargar': 0 };
    accounts.forEach((a) => { counts[a.status] += 1; });
    return counts;
  }

  // ── Barra lateral ──────────────────────────────────────────────────────
  GC.views.side = function (state, view) {
    const queueN = state.queue.length;
    const buildings = state.buildings.map((b) => {
      const on = view.route === 'building' && view.buildingId === b.id;
      return '<button type="button" class="nv' + (on ? ' act' : '') + '" data-action="open-building" data-id="' + esc(b.id) + '" data-tip="' + esc(b.name) + '"' + (on ? ' aria-current="page"' : '') + '>' +
        ICON.building + '<span class="nm">' + esc(b.name) + '</span>' + (b.counts.revision ? '<span class="cnt">' + b.counts.revision + '</span>' : '') + '</button>';
    }).join('');
    return '<span class="glass" aria-hidden="true"></span>' +
      '<div class="brand"><span class="mark">' + esc(state.company.name.charAt(0)) + '</span><span class="bt"><b>' + esc(state.company.name) + '</b><small>Administración</small></span></div>' +
      '<button type="button" class="tg" data-action="toggle-nav" aria-label="' + (view.nav ? 'Plegar el menú' : 'Desplegar el menú') + '" aria-expanded="' + view.nav + '">' + ICON.chevron + '</button>' +
      '<nav class="rail" aria-label="Principal">' +
      '<button type="button" class="nv' + (view.route === 'home' ? ' act' : '') + '" data-action="go-home" data-tip="Cartera">' + ICON.grid + '<span class="nm">Cartera</span>' + (queueN ? '<span class="cnt">' + queueN + '</span>' : '') + '</button>' +
      '<div class="nvl">Edificios</div>' + buildings + '</nav>' +
      '<div class="foot"><button type="button" class="nv" data-action="logout" data-tip="Cerrar sesión">' + ICON.exit + '<span class="nm">Cerrar sesión</span></button></div>';
  };

  // ── Barra superior ─────────────────────────────────────────────────────
  GC.views.topbar = function (state, view) {
    const menu = view.themeOpen
      ? '<div class="thmp" role="menu"><div class="thmh">Tema de color</div>' + THEMES.map(([id, label, c1, c2]) =>
        '<button type="button" class="thmo' + (view.theme === id ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (view.theme === id) + '" data-action="theme" data-theme-id="' + id + '">' +
        '<span class="thmv"><i style="background:' + c1 + '"></i><i class="l"><b style="background:' + c2 + '"></b></i></span><span>' + label + '</span></button>').join('') + '</div>'
      : '';
    const initials = state.company.name.split(/\s+/).map((w) => w.charAt(0)).join('').replace(/[^A-ZÁÉÍÓÚÑ]/g, '').slice(0, 2);
    // Solo si el empleado trabaja para más de una administración.
    const orgs = state.orgs.length > 1
      ? '<label><span class="vh">Administración</span><select class="inp" data-action="org" style="min-height:34px;width:auto">' + state.orgs.map((o) =>
        '<option value="' + esc(o.id) + '"' + (o.id === state.orgId ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select></label>'
      : '';
    return '<div class="topbar"><label class="tsearch">' + ICON.search + '<input type="search" placeholder="Buscar edificio, unidad o residente" aria-label="Buscar" data-action="search" value="' + esc(view.query) + '" maxlength="60"></label>' +
      '<div class="tright">' + orgs + '<div class="thw"><button type="button" class="ibtn" aria-label="Elegir tema" aria-expanded="' + view.themeOpen + '" title="Tema" data-action="theme-toggle">' + ICON.palette + '</button>' + menu + '</div>' +
      '<button type="button" class="ibtn ibell" aria-label="Notificaciones" data-action="go-review">' + ICON.bell + (state.queue.length ? '<i></i>' : '') + '</button>' +
      '<div class="usr"><span class="av" aria-hidden="true">' + esc(initials) + '</span><span class="wn"><b>' + esc(state.company.name) + '</b><small>' + esc(state.userName || 'Administración') + '</small></span></div></div></div>';
  };

  function fig(icon, label, value, foot, extra) {
    return '<div><div class="fl"><span class="ic" aria-hidden="true">' + icon + '</span>' + esc(label) + '</div><div class="fv' + (extra && extra.cls ? ' ' + extra.cls : '') + '">' + value + '</div><div class="fs">' + foot + '</div>' + (extra && extra.bar != null ? '<div class="thin"><i style="width:' + extra.bar + '%"></i></div>' : '') + '</div>';
  }

  // ── Cartera ────────────────────────────────────────────────────────────
  GC.views.home = function (state, view) {
    const T = state.totals;
    const queue = state.queue;
    const unloaded = state.buildings.filter((b) => b.settlement !== 'issued').length;
    const p = pct(T.collected, T.expected);
    const dueDays = Array.from(new Set(state.buildings.map((b) => b.due_day)));

    const queueHtml = queue.length
      ? '<div class="list" style="margin-top:12px">' + queue.map((r) => '<button type="button" class="gr queue" data-action="open-receipt" data-receipt="' + esc(r.id) + '">' +
        '<span><b style="font-weight:500">' + esc(r.person) + '</b><small>' + esc(r.building) + ', apto ' + esc(r.unit) + ' · ' + esc(GC.ROLE_LABEL[r.role]) + ' · ' + esc(GC.fileLabel(r.file)) + ' · transferido el ' + esc(fmt.date(r.date)) + '</small></span>' +
        '<span class="mono r">' + fmt.money(r.amount) + '</span><span class="rvt">Ver comprobante ' + ICON.arrow + '</span></button>').join('') + '</div>'
      : '<p class="empty">No hay comprobantes esperando validación.</p>';

    const rows = state.buildings.filter((b) => matchesQuery(b.name + ' ' + b.address, view.query)).map((b) => {
      const bp = pct(b.collected, b.expected);
      const rev = Number(b.expected) ? Math.min(pct(b.in_review, b.expected), 100) : 0;
      const issued = b.settlement === 'issued';
      const al = b.counts.moroso > 0 ? ['al-red', 'Con morosos'] : (b.counts.revision > 0 || !issued) ? ['al-amber', 'Requiere atención'] : ['al-green', 'Al día'];
      return '<button type="button" class="gr brow ' + al[0] + (b.severe ? ' sev' : '') + '" data-action="open-building" data-id="' + esc(b.id) + '"><span class="aldot" title="' + al[1] + '"></span>' +
        '<span class="bn"><b>' + esc(b.name) + '</b><small>' + esc(b.address) + ' · ' + b.units + ' unidades</small></span>' +
        '<span class="bp"><span class="bpt"><b class="bpp">' + bp + ' %</b><span class="muted">' + fmt.money(b.collected) + ' de ' + fmt.money(b.expected) + '</span></span>' +
        '<span class="pbar" aria-hidden="true"><i class="pb1" style="width:' + bp + '%"></i><i class="pb2" style="left:' + bp + '%;width:' + rev + '%"></i></span><span class="lg">' + esc(legend(b.counts)) + '</span>' +
        (issued ? '' : '<span class="warn" style="display:block">' + (b.settlement === 'draft' ? 'Falta emitir' : 'Faltan cargar') + ' los gastos de ' + esc(fmt.monthLong(state.month)) + '</span>') + '</span>' +
        '<span class="bd"><small>Deuda vencida</small><span class="mono">' + fmt.money(b.debt) + '</span></span><span class="go" aria-hidden="true">' + ICON.arrowLg + '</span></button>';
    }).join('');

    return '<header><h1 class="title">Cartera de ' + esc(state.company.name) + '</h1>' +
      '<div class="meta"><span>' + esc(fmt.monthTitle(state.month)) + '</span><span>' + state.buildings.length + ' edificios</span><span>' + T.accounts + ' cuentas</span>' +
      (dueDays.length === 1 ? '<span>Vencimiento: día ' + esc(dueDays[0]) + '</span>' : '') + '</div></header>' +
      '<section class="figs" aria-label="Cifras del mes">' +
      fig(ICON.wallet, 'Cobrado en ' + monthWord(state.month), fmt.money(T.collected), 'de ' + fmt.money(T.expected) + ' · ' + p + ' %', { bar: p }) +
      fig(ICON.clock, 'En revisión', '<span class="mk">' + fmt.money(T.in_review) + '</span>', queue.length + ' comprobantes por validar') +
      fig(ICON.alert, 'Deuda vencida', fmt.money(T.debt), T.delinquent + ' cuentas morosas', { cls: 'red' }) +
      fig(ICON.chat, 'Reclamos abiertos', String(T.open_claims), unloaded ? unloaded + (unloaded === 1 ? ' edificio' : ' edificios') + ' sin gastos del mes' : 'Todos los meses cargados') + '</section>' +
      '<section id="queue"><h2 class="sh">Comprobantes para validar<small>Contrastalos con la cuenta del banco antes de aprobar</small></h2>' + queueHtml + '</section>' +
      '<section><h2 class="sh">Edificios</h2><div class="list" style="margin-top:8px">' + (rows || '<p class="empty">Ningún edificio coincide con la búsqueda.</p>') + '</div></section>';
  };

  // ── Edificio ───────────────────────────────────────────────────────────
  const TABS = [['cobros', 'Cobros'], ['resumen', 'Resumen'], ['gastos', 'Gastos'], ['comunicaciones', 'Comunicaciones']];

  GC.views.building = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const d = state.detail[view.buildingId];
    if (!d) return loading();
    const openClaims = d.claims.filter((c) => c.status !== 'resolved').length;
    const counts = { cobros: b.counts.revision, comunicaciones: openClaims };
    const tabs = '<div class="tabs" role="tablist" style="margin-top:-12px">' + TABS.map(([id, label]) =>
      '<button type="button" role="tab" class="tab' + (view.tab === id ? ' on' : '') + '" aria-selected="' + (view.tab === id) + '" data-action="tab" data-tab="' + id + '">' + label +
      (counts[id] ? '<span class="cnt">' + counts[id] + '</span>' : '') + '</button>').join('') + '</div>';
    const body = { cobros, resumen, gastos, comunicaciones }[view.tab](state, view, b, d);

    return '<header class="head"><div><nav class="crumbs" aria-label="Ruta"><button type="button" data-action="go-home">Cartera</button><span>/</span><span>' + esc(b.name) + '</span></nav>' +
      '<h1 class="title">' + esc(b.name) + '</h1><div class="meta"><span>' + esc(b.address) + (b.neighborhood ? ', ' + esc(b.neighborhood) : '') + '</span><span>' + b.units + ' unidades</span>' +
      '<span title="Suma de coeficientes de copropiedad">Coeficientes: ' + fmt.percent(d.summary.funds.coefficient_sum) + '</span></div></div>' +
      '<div class="acts"><button type="button" class="btn sec" data-action="export-csv">Exportar a Excel</button><button type="button" class="btn pri" data-action="open-expense">Cargar gastos</button></div></header>' +
      tabs + body;
  };

  function buildingFigs(state, b, d) {
    const p = pct(b.collected, b.expected);
    return '<section class="figs">' +
      fig(ICON.wallet, 'Cobrado en ' + monthWord(state.month), fmt.money(b.collected), 'de ' + fmt.money(b.expected) + ' · ' + p + ' %', { bar: p }) +
      fig(ICON.clock, 'En revisión', '<span class="mk">' + fmt.money(b.in_review) + '</span>', b.counts.revision + ' comprobantes') +
      fig(ICON.alert, 'Deuda vencida', fmt.money(b.debt), b.counts.moroso + ' cuentas morosas', { cls: 'red' }) +
      fig(ICON.safe, 'Fondo de reserva', fmt.money(d.summary.funds.reserve), 'Acumulado a la fecha') + '</section>';
  }

  // ── Cobros ─────────────────────────────────────────────────────────────
  const FILTERS = [['todos', 'Todos'], ['revision', 'En revisión'], ['moroso', 'Morosos'], ['pendiente', 'Pendientes'], ['pagado', 'Al día']];

  function cobros(state, view, b, d) {
    const all = sortedAccounts(d.accounts);
    const counts = statusCounts(all);
    const chips = '<div class="chips" role="group" aria-label="Filtrar por estado">' + FILTERS.map(([id, label]) =>
      '<button type="button" class="ch' + (view.filter === id ? ' on' : '') + '" aria-pressed="' + (view.filter === id) + '" data-action="filter" data-filter="' + id + '">' + label + ' <b>' + (id === 'todos' ? all.length : counts[id]) + '</b></button>').join('') + '</div>';

    const visible = all.filter((a) => (view.filter === 'todos' || a.status === view.filter) && matchesQuery(a.unit + ' ' + a.person.name, view.query));
    let lastUnit = null;
    const rows = visible.map((a) => {
      const first = a.unit !== lastUnit;
      lastUnit = a.unit;
      const late = a.overdue_months.length;
      return '<div class="gr cob' + (first ? ' first' : '') + '">' +
        '<button type="button" class="open" data-action="open-unit" data-occ="' + esc(a.id) + '"><span class="u mono">' + (first ? esc(a.unit) : '') + '</span><span class="who"><b>' + esc(a.person.name) + '</b><small>' +
        esc(GC.ROLE_LABEL[a.role]) + (a.role === 'owner' && hasTenant(all, a.unit) ? ' · fondo y extraordinarios' : '') + '</small></span></button>' +
        '<span class="mono r">' + (Number(a.charge) ? fmt.money(a.charge) : '—') + '</span>' +
        '<span class="mono r' + (late ? ' red' : '') + '">' + fmt.money(a.balance) + '</span>' +
        '<span>' + pill(a.status) + '<small>' + (late ? late + (late === 1 ? ' mes' : ' meses') + ' de atraso' : '') + '</small></span>' +
        '<span class="acts" style="justify-content:flex-end">' + (a.status === 'revision' ? '<button type="button" class="rvb" data-action="open-receipt" data-occ="' + esc(a.id) + '">' + ICON.eye + '<span>Ver comprobante</span><span class="ar">' + ICON.arrow + '</span></button>' : '') + '</span></div>';
    }).join('');

    return buildingFigs(state, b, d) + '<section>' + chips +
      '<div class="scroll" style="margin-top:20px"><div class="list"><div class="gr cob th"><span>Unidad y responsable</span><span class="r">Cargo del mes</span><span class="r">Saldo</span><span>Estado</span><span></span></div>' + rows + '</div></div>' +
      (rows ? '' : '<p class="empty">Ninguna cuenta coincide con el filtro.</p>') + '</section>';
  }

  // ── Resumen ────────────────────────────────────────────────────────────
  function resumen(state, view, b, d) {
    const s = d.summary;
    const current = d.settlements.find((x) => x.month === state.month);
    let gastosHtml;
    if (b.settlement === 'issued') {
      const items = s.items.filter((it) => Number(it.amount) > 0);
      const max = Math.max.apply(null, items.map((it) => Number(it.amount)).concat(1));
      gastosHtml = '<p class="sub">Celeste: los paga siempre el propietario.</p>' + items.map((it) =>
        '<div class="cc"><span>' + esc(it.concept) + '<small class="muted" style="display:block;font-size:11px">' + esc(it.detail || '') + '</small></span>' +
        '<span class="cb"><i class="' + (it.type === 'owner_only' ? 'own' : '') + '" style="width:' + ((Number(it.amount) / max) * 100).toFixed(1) + '%"></i></span><span class="mono r">' + fmt.money(it.amount) + '</span></div>').join('') +
        '<div class="tot"><span>Total del mes</span><span class="mono">' + fmt.money(current ? current.total : '0') + '</span></div>';
    } else {
      const draft = b.settlement === 'draft';
      gastosHtml = '<p class="empty">' + (draft ? 'Los gastos de ' + esc(fmt.monthLong(state.month)) + ' están en borrador. Emitilos desde la pestaña Gastos.' : 'Todavía no se cargaron los gastos de ' + esc(fmt.monthLong(state.month)) + '.') + '</p>' +
        (draft ? '<button type="button" class="btn pri" data-action="tab" data-tab="gastos">Ir a Gastos</button>' : '<button type="button" class="btn pri" data-action="open-expense">Cargar gastos</button>');
    }

    const accountId = (unit, role) => (d.accounts.find((a) => a.unit === unit && a.role === role) || {}).id || '';
    const morHtml = s.delinquent.length
      ? '<div class="scroll" style="margin-top:10px"><div class="list"><div class="gr mor th"><span>Unidad</span><span>Responsable</span><span>Meses adeudados</span><span class="r">Deuda vencida</span></div>' +
        s.delinquent.map((m) => '<div class="gr mor"><button type="button" class="mono" style="font-weight:500" data-action="open-unit" data-occ="' + esc(accountId(m.unit, m.role)) + '">' + esc(m.unit) + '</button>' +
          '<span>' + esc(m.person) + ' <span class="muted">· ' + esc(GC.ROLE_LABEL[m.role]) + '</span></span><span>' + esc(m.months.map((k) => fmt.monthShort(k)).join(', ')) + '</span>' +
          '<span class="mono r" style="color:#98140b">' + fmt.money(m.debt) + '</span></div>').join('') + '</div></div>'
      : '<p class="empty">Ninguna cuenta con meses vencidos.</p>';

    return '<section class="two"><div><h2 class="sh">Gastos de ' + esc(fmt.monthLong(state.month)) + '</h2>' + gastosHtml + '</div>' +
      '<div><h2 class="sh">Fondos</h2><div style="margin-top:8px">' +
      '<div class="fund"><span>Fondo de reserva</span><span class="mono">' + fmt.money(s.funds.reserve) + '</span></div>' +
      '<div class="fund"><span>Cobrado este mes</span><span class="mono">' + fmt.money(s.funds.collected) + '</span></div>' +
      '<div class="fund"><span>Por cobrar</span><span class="mono">' + fmt.money(s.funds.receivable) + '</span></div>' +
      '<div class="fund"><span>Coeficientes asignados</span><span class="mono">' + fmt.percent(s.funds.coefficient_sum) + '</span></div></div></div></section>' +
      '<section id="morosidad"><h2 class="sh">Morosidad</h2>' + morHtml + '</section>';
  }

  // ── Gastos ─────────────────────────────────────────────────────────────
  const SHORT = { 'O.S.E. (agua)': 'O.S.E.', 'U.T.E. (luz)': 'U.T.E.', 'Honorarios de administración': 'Honorarios', 'Fondo de reserva': 'F. reserva', 'Cuota extraordinaria': 'Extraord.' };

  function gastos(state, view, b, d) {
    const n = (v) => (Number(v) ? fmt.money(v).replace('$ ', '') : '—');
    const cols = d.concepts;
    const grid = cols.length === 6 ? '' : ' style="grid-template-columns:minmax(0,1.3fr) repeat(' + cols.length + ',minmax(70px,1fr)) minmax(80px,1fr) 110px"';
    const rows = d.settlements.slice().sort((x, y) => y.month.localeCompare(x.month)).map((e) => {
      const byConcept = Object.fromEntries(e.items.map((it) => [it.concept_id, it.amount]));
      return '<div class="gr gas"' + grid + '><span style="font-weight:500">' + esc(fmt.monthTitle(e.month)) + '</span>' +
        cols.map((c) => '<span class="mono r">' + n(byConcept[c.id]) + '</span>').join('') +
        '<span class="mono r" style="font-weight:600">' + fmt.money(e.total) + '</span>' +
        '<span>' + (e.status === 'issued' ? pill('pagado', 'Emitido') + ' <button type="button" class="lk" data-action="settlement-pdf" data-month="' + esc(e.month) + '">PDF</button>' +
          ' <a class="lk" href="/api/v1/buildings/' + encodeURIComponent(b.id) + '/settlements/' + esc(e.month) + '/export" download>Excel</a>'
          : pill('revision', 'Borrador') + ' <button type="button" class="lk" data-action="open-expense" data-month="' + esc(e.month) + '">Editar</button> <button type="button" class="lk" data-action="issue-expense" data-month="' + esc(e.month) + '">Emitir</button>') + '</span></div>';
    }).join('');
    // Listado de impresión (D4): quienes reciben la liquidación en papel, con su PDF.
    const paper = b.settlement === 'issued' ? sortedAccounts(d.accounts).filter((a) => a.receives_paper && Number(a.charge)) : [];
    const paperHtml = paper.length
      ? '<p class="sub" style="margin:0 0 16px">Para imprimir (reciben en papel): ' + paper.map((a) => '<button type="button" class="lk" data-action="unit-pdf" data-occ="' + esc(a.id) + '">Apto ' + esc(a.unit) + ' · ' + esc(a.person.name) + '</button>').join(', ') + '</p>'
      : '';
    return '<section>' + paperHtml + '<div class="head" style="align-items:center"><p class="sub" style="max-width:62ch;margin:0">Los meses en borrador se pueden corregir. Al emitir, la liquidación queda fija en el libro mayor: cualquier corrección posterior se hace con un asiento de ajuste.</p>' +
      '<button type="button" class="btn pri" data-action="open-expense">Cargar mes</button></div>' +
      '<div class="scroll" style="margin-top:24px"><div class="list" style="min-width:900px"><div class="gr gas th"' + grid + '><span>Mes</span>' +
      cols.map((c) => '<span class="r">' + esc(SHORT[c.name] || c.name) + '</span>').join('') + '<span class="r">Total</span><span>Estado</span></div>' +
      (rows || '<p class="empty">Sin gastos cargados.</p>') + '</div></div></section>';
  }

  // ── Comunicaciones ─────────────────────────────────────────────────────
  const THREAD_STATUS = { pending: ['pendiente', 'Pendiente'], in_progress: ['revision', 'En proceso'], resolved: ['pagado', 'Resuelto'] };
  GC.views.THREAD_STATUS = THREAD_STATUS;

  function comunicaciones(state, view, b, d) {
    const sub = '<div class="chips" role="group" aria-label="Comunicaciones">' +
      '<button type="button" class="ch' + (view.commSub === 'avisos' ? ' on' : '') + '" data-action="comm-sub" data-sub="avisos">Avisos <b>' + d.notices.length + '</b></button>' +
      '<button type="button" class="ch' + (view.commSub === 'hilos' ? ' on' : '') + '" data-action="comm-sub" data-sub="hilos">Reclamos y reportes <b>' + d.claims.length + '</b></button></div>';

    if (view.commSub === 'avisos') {
      const list = d.notices.length
        ? d.notices.map((n) => '<article class="notice"><div class="nt"><span>' + esc(n.title) + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('')
        : '<p class="empty">Todavía no hay avisos publicados.</p>';
      return '<section>' + sub + '<div class="cm" style="margin-top:32px"><form data-form="notice" novalidate><h2 class="sh">Nuevo aviso</h2><p class="sub">Lo ven todos los residentes de ' + esc(b.name) + ' en su portal.</p>' +
        '<div class="fld"><label for="n-t">Asunto</label><input class="inp" id="n-t" name="title" type="text" maxlength="120" required></div>' +
        '<div class="fld"><label for="n-b">Mensaje</label><textarea class="inp ta" id="n-b" name="body" rows="5" maxlength="1200" required></textarea></div>' +
        '<p class="ferr" data-error hidden></p><button type="submit" class="btn pri">Publicar aviso</button></form><div>' + list + '</div></div></section>';
    }

    const curId = view.threadId && d.claims.some((t) => t.id === view.threadId) ? view.threadId : (d.claims[0] || {}).id;
    const list = d.claims.map((t) => '<button type="button" class="ti' + (curId === t.id ? ' on' : '') + '" data-action="open-thread" data-id="' + esc(t.id) + '"><b>' + esc(t.title) + '</b><span>' + esc(t.author) + ' · apto ' + esc(t.unit) + '</span>' +
      '<span><span class="pill st-' + THREAD_STATUS[t.status][0] + '" style="margin-top:6px">' + THREAD_STATUS[t.status][1] + '</span></span></button>').join('');
    const cur = curId && state.claims[curId];
    let detail = '';
    if (curId && !cur) detail = '<div>' + loading() + '</div>';
    else if (cur) {
      detail = '<div><div class="head" style="align-items:flex-start;gap:12px"><div><h2 class="sh">' + esc(cur.title) + '</h2><p class="sub">' + esc(cur.author) + ' · apto ' + esc(cur.unit) + ' · ' + esc(fmt.date(cur.date)) + '</p></div>' +
        '<label><span class="vh">Estado</span><select class="inp" data-action="thread-status" data-id="' + esc(cur.id) + '" style="min-height:34px;width:auto">' +
        Object.keys(THREAD_STATUS).map((k) => '<option value="' + k + '"' + (cur.status === k ? ' selected' : '') + '>' + THREAD_STATUS[k][1] + '</option>').join('') + '</select></label></div>' +
        '<div class="msgs">' + cur.messages.map((m) => '<div class="msg' + (m.from_admin ? ' me' : '') + '"><small>' + esc(m.author) + ' · ' + esc(fmt.dateShort(m.date.slice(0, 10))) + '</small>' + esc(m.text) + '</div>').join('') + '</div>' +
        '<form class="acts" data-form="reply" data-id="' + esc(cur.id) + '"><input class="inp" id="reply" name="text" type="text" aria-label="Respuesta" placeholder="Escribir respuesta…" maxlength="1000" autocomplete="off" style="flex:1"><button type="submit" class="btn pri">Enviar</button></form></div>';
    }
    return '<section>' + sub + '<div class="cm" style="margin-top:32px"><div class="th2">' + (list || '<p class="empty" style="padding:12px">No hay reclamos ni reportes.</p>') + '</div>' + detail + '</div></section>';
  }

  // ── Botones flotantes y paneles (atajos, gráfica, tareas) ──────────────
  GC.views.fabs = function (state, view) {
    const openN = state.tasks.filter((t) => !t.done).length;
    const fab = (id, label, icon, extra) => '<button type="button" class="fab' + (view.panel === id ? ' on' : '') + '" aria-label="' + label + '" aria-pressed="' + (view.panel === id) + '" title="' + label + '" data-action="panel" data-panel="' + id + '">' + icon + (extra || '') + '</button>';
    let pop = '';
    if (view.panel === 'sc') pop = shortcuts(state);
    else if (view.panel === 'ch') pop = chart(state);
    else if (view.panel === 'tk') pop = taskPanel(state, view);
    return '<div class="fabs" role="toolbar" aria-label="Paneles">' + fab('sc', 'Atajos', ICON.bolt) + fab('ch', 'Cobrado por mes', ICON.bars) +
      fab('tk', 'Tareas', ICON.list, openN ? '<span class="cnt">' + openN + '</span>' : '') + '</div>' + pop;
  };

  function shortcuts(state) {
    if (!state.buildings.length) return '<aside class="pop" aria-label="Atajos"><h2 class="rh">Atajos</h2><p class="empty">Todavía no hay edificios.</p></aside>';
    const noCur = state.buildings.filter((b) => b.settlement !== 'issued');
    const worst = state.buildings.slice().sort((x, y) => y.counts.moroso - x.counts.moroso)[0];
    return '<aside class="pop" aria-label="Atajos"><h2 class="rh">Atajos</h2><div class="sc">' +
      '<button type="button" class="sct" data-action="shortcut-load" data-id="' + esc((noCur[0] || state.buildings[0]).id) + '"><span class="sci">' + ICON.plus + '</span><span class="scl">Cargar gastos del mes<small>' + (noCur.length ? esc(noCur.map(shortName).join(', ')) + ' sin cargar' : 'Todo al día') + '</small></span></button>' +
      '<button type="button" class="sct" data-action="go-review"><span class="sci">' + ICON.check + '</span><span class="scl">Revisar comprobantes<small>' + state.queue.length + ' esperando</small></span></button>' +
      '<button type="button" class="sct" data-action="shortcut-moro" data-id="' + esc(worst.id) + '"><span class="sci red">' + ICON.alert + '</span><span class="scl">Ver morosos<small>' + state.totals.delinquent + ' cuentas</small></span></button></div></aside>';
  }

  function chart(state) {
    let body;
    if (!state.history) body = loading();
    else if (!state.history.length) body = '<p class="empty">Todavía no hay liquidaciones emitidas.</p>';
    else {
      body = '<div class="chart" role="img" aria-label="Cobrado por mes en los edificios">' + state.history.map((m) => {
        const p = pct(m.collected, m.charged);
        return '<div class="cbar" title="' + esc(fmt.monthLong(m.month) + ': ' + fmt.money(m.collected) + ' de ' + fmt.money(m.charged)) + '"><span class="cbv">' + p + '%</span><span class="cbt"><i class="cbf" style="height:' + p + '%"></i></span><span class="cbl">' + esc(fmt.monthShort(m.month).split(' ')[0]) + '</span></div>';
      }).join('') + '</div>';
    }
    return '<aside class="pop" aria-label="Cobrado por mes"><h2 class="rh">Cobrado por mes<small>sobre lo emitido</small></h2>' + body + '</aside>';
  }

  function taskPanel(state, view) {
    const isHome = view.route === 'home';
    const scope = isHome ? (view.taskFilter === 'all' ? null : view.taskFilter) : view.buildingId;
    const name = (id) => shortName(state.buildings.find((b) => b.id === id) || { name: '' });
    const days = (d) => Math.round((Date.parse(d) - Date.parse(state.today)) / 864e5);
    const list = state.tasks.filter((t) => !scope || t.building_id === scope)
      .sort((x, y) => Number(x.done) - Number(y.done) || (x.due_date || '9').localeCompare(y.due_date || '9'))
      .map((t) => {
        const dd = t.due_date ? days(t.due_date) : null;
        const due = dd === null || t.done ? '' : '<span class="due' + (dd <= 1 ? ' warn' : '') + '">' + (dd < 0 ? 'Vencida' : dd === 0 ? 'Hoy' : dd === 1 ? 'Mañana' : 'En ' + dd + ' días') + '</span>';
        return '<li class="tk' + (t.done ? ' done' : '') + '"><button type="button" class="tkc" role="checkbox" aria-checked="' + !!t.done + '" aria-label="Marcar tarea" data-action="task-toggle" data-id="' + esc(t.id) + '"><span>' + ICON.check + '</span></button>' +
          '<span class="tkb"><span class="tkt">' + esc(t.text) + '</span><span class="tkm"><b>' + esc(name(t.building_id)) + '</b>' + due + '</span></span></li>';
      }).join('');
    const filters = isHome
      ? '<div class="tf" role="group" aria-label="Filtrar tareas por edificio">' + [['all', 'Todas']].concat(state.buildings.map((b) => [b.id, shortName(b)])).map(([id, label]) =>
        '<button type="button" class="tfc' + (view.taskFilter === id ? ' on' : '') + '" aria-pressed="' + (view.taskFilter === id) + '" data-action="task-filter" data-id="' + esc(id) + '">' + esc(label) + '</button>').join('') + '</div>'
      : '';
    return '<aside class="pop" aria-label="Tareas"><h2 class="rh">Tareas<small>' + esc(scope ? name(scope) : 'Toda la cartera') + '</small></h2>' + filters +
      '<ul class="tl">' + list + '</ul>' + (list ? '' : '<p class="empty" style="padding:8px 0">Sin tareas pendientes.</p>') +
      '<form class="tadd" data-form="task"><input class="inp" name="text" type="text" placeholder="Nueva tarea" aria-label="Nueva tarea" maxlength="90">' +
      (isHome ? '<select class="inp" name="bid" aria-label="Edificio">' + state.buildings.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select>' : '') +
      '<button type="submit" class="btn pri sm">Sumar</button></form></aside>';
  }
})(window.GC);
