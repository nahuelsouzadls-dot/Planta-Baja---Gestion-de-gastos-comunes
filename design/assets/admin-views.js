/* Vistas del panel de administración. Funciones puras: (estado, vista) → HTML.
 * El markup sigue el prototipo de design/ref (gc-admin.html): mismas clases y estructura. */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const L = GC.ledger;
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
  const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
  const legend = (counts) => Object.keys(LEGEND).filter((k) => counts[k] > 0).map((k) => counts[k] + ' ' + LEGEND[k]).join(' · ');
  const monthWord = (key) => fmt.monthLong(key).split(' ')[0];
  const shortName = (b) => b.name.replace('Edificio ', '');

  function summaries(state) {
    return state.buildings.map((b) => ({ b, s: L.buildingSummary(state, b) }));
  }

  function queueOf(state) {
    return summaries(state).flatMap(({ b, s }) => s.accounts.filter((a) => a.review).map((a) => ({ b, a })));
  }
  GC.views.queueOf = queueOf;

  function matchesQuery(text, query) {
    const q = (query || '').trim().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }

  // ── Barra lateral ──────────────────────────────────────────────────────
  GC.views.side = function (state, view) {
    const queueN = queueOf(state).length;
    const buildings = state.buildings.map((b) => {
      const s = L.buildingSummary(state, b);
      const on = view.route === 'building' && view.buildingId === b.id;
      return '<button type="button" class="nv' + (on ? ' act' : '') + '" data-action="open-building" data-id="' + esc(b.id) + '" data-tip="' + esc(b.name) + '"' + (on ? ' aria-current="page"' : '') + '>' +
        ICON.building + '<span class="nm">' + esc(b.name) + '</span>' + (s.counts.revision ? '<span class="cnt">' + s.counts.revision + '</span>' : '') + '</button>';
    }).join('');
    return '<span class="glass" aria-hidden="true"></span>' +
      '<div class="brand"><span class="mark">C</span><span class="bt"><b>' + esc(state.company.name) + '</b><small>Administración</small></span></div>' +
      '<button type="button" class="tg" data-action="toggle-nav" aria-label="' + (view.nav ? 'Plegar el menú' : 'Desplegar el menú') + '" aria-expanded="' + view.nav + '">' + ICON.chevron + '</button>' +
      '<nav class="rail" aria-label="Principal">' +
      '<button type="button" class="nv' + (view.route === 'home' ? ' act' : '') + '" data-action="go-home" data-tip="Cartera">' + ICON.grid + '<span class="nm">Cartera</span>' + (queueN ? '<span class="cnt">' + queueN + '</span>' : '') + '</button>' +
      '<div class="nvl">Edificios</div>' + buildings + '</nav>' +
      '<div class="foot"><a href="portal-residente.html" class="nv" data-tip="Portal de residentes">' + ICON.exit + '<span class="nm">Portal de residentes</span></a>' +
      '<button type="button" class="nv" data-action="reset-demo" data-tip="Reiniciar datos de demo">' + ICON.reset + '<span class="nm">Reiniciar datos de demo</span></button></div>';
  };

  // ── Barra superior ─────────────────────────────────────────────────────
  GC.views.topbar = function (state, view) {
    const menu = view.themeOpen
      ? '<div class="thmp" role="menu"><div class="thmh">Tema de color</div>' + THEMES.map(([id, label, c1, c2]) =>
        '<button type="button" class="thmo' + (view.theme === id ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (view.theme === id) + '" data-action="theme" data-theme-id="' + id + '">' +
        '<span class="thmv"><i style="background:' + c1 + '"></i><i class="l"><b style="background:' + c2 + '"></b></i></span><span>' + label + '</span></button>').join('') + '</div>'
      : '';
    const initials = state.company.name.split(/\s+/).map((w) => w.charAt(0)).join('').replace(/[^A-ZÁÉÍÓÚÑ]/g, '').slice(0, 2);
    return '<div class="topbar"><label class="tsearch">' + ICON.search + '<input type="search" placeholder="Buscar edificio, unidad o residente" aria-label="Buscar" data-action="search" value="' + esc(view.query) + '" maxlength="60"></label>' +
      '<div class="tright"><div class="thw"><button type="button" class="ibtn" aria-label="Elegir tema" aria-expanded="' + view.themeOpen + '" title="Tema" data-action="theme-toggle">' + ICON.palette + '</button>' + menu + '</div>' +
      '<button type="button" class="ibtn ibell" aria-label="Notificaciones" data-action="go-review">' + ICON.bell + (queueOf(state).length ? '<i></i>' : '') + '</button>' +
      '<div class="usr"><span class="av" aria-hidden="true">' + esc(initials) + '</span><span class="wn"><b>' + esc(state.company.name) + '</b><small>Administración</small></span></div></div></div>';
  };

  function fig(icon, label, value, foot, extra) {
    return '<div><div class="fl"><span class="ic" aria-hidden="true">' + icon + '</span>' + esc(label) + '</div><div class="fv' + (extra && extra.cls ? ' ' + extra.cls : '') + '">' + value + '</div><div class="fs">' + foot + '</div>' + (extra && extra.bar != null ? '<div class="thin"><i style="width:' + extra.bar + '%"></i></div>' : '') + '</div>';
  }

  // ── Cartera ────────────────────────────────────────────────────────────
  GC.views.home = function (state, view) {
    const all = summaries(state);
    const T = all.reduce((t, { s }) => ({
      expected: t.expected + s.expected, collected: t.collected + s.collected, inReview: t.inReview + s.inReview, debt: t.debt + s.debt,
      threads: t.threads + s.openThreads, accounts: t.accounts + s.total, moro: t.moro + s.counts.moroso,
    }), { expected: 0, collected: 0, inReview: 0, debt: 0, threads: 0, accounts: 0, moro: 0 });
    const queue = queueOf(state);
    const unloaded = all.filter(({ s }) => !s.expense).length;
    const p = pct(T.collected, T.expected);

    const queueHtml = queue.length
      ? '<div class="list" style="margin-top:12px">' + queue.map(({ b, a }) => '<button type="button" class="gr queue" data-action="open-receipt" data-building="' + esc(b.id) + '" data-key="' + esc(a.key) + '">' +
        '<span><b style="font-weight:500">' + esc(a.person.name) + '</b><small>' + esc(b.name) + ', apto ' + esc(a.unit.n) + ' · ' + esc(GC.ROLE_LABEL[a.role]) + ' · ' + esc(a.review.file) + ' · subido el ' + esc(fmt.date(a.review.uploadedAt)) + '</small></span>' +
        '<span class="mono r">' + fmt.money(a.balance) + '</span><span class="rvt">Ver comprobante ' + ICON.arrow + '</span></button>').join('') + '</div>'
      : '<p class="empty">No hay comprobantes esperando validación.</p>';

    const rows = all.filter(({ b }) => matchesQuery(b.name + ' ' + b.address, view.query)).map(({ b, s }) => {
      const bp = pct(s.collected, s.expected);
      const rev = s.expected ? Math.min(pct(s.inReview, s.expected), 100) : 0;
      const al = s.counts.moroso > 0 ? ['al-red', 'Con morosos'] : (s.counts.revision > 0 || !s.expense) ? ['al-amber', 'Requiere atención'] : ['al-green', 'Al día'];
      const sev = s.accounts.some((a) => a.overdueMonths.length >= 2) ? ' sev' : '';
      return '<button type="button" class="gr brow ' + al[0] + sev + '" data-action="open-building" data-id="' + esc(b.id) + '"><span class="aldot" title="' + al[1] + '"></span>' +
        '<span class="bn"><b>' + esc(b.name) + '</b><small>' + esc(b.address) + ' · ' + b.units.length + ' unidades</small></span>' +
        '<span class="bp"><span class="bpt"><b class="bpp">' + bp + ' %</b><span class="muted">' + fmt.money(s.collected) + ' de ' + fmt.money(s.expected) + '</span></span>' +
        '<span class="pbar" aria-hidden="true"><i class="pb1" style="width:' + bp + '%"></i><i class="pb2" style="left:' + bp + '%;width:' + rev + '%"></i></span><span class="lg">' + esc(legend(s.counts)) + '</span>' +
        (s.expense ? '' : '<span class="warn" style="display:block">' + (s.draft ? 'Falta emitir' : 'Faltan cargar') + ' los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '</span>') + '</span>' +
        '<span class="bd"><small>Deuda vencida</small><span class="mono">' + fmt.money(s.debt) + '</span></span><span class="go" aria-hidden="true">' + ICON.arrowLg + '</span></button>';
    }).join('');

    return '<header><h1 class="title">Cartera de ' + esc(state.company.name) + '</h1>' +
      '<div class="meta"><span>' + esc(fmt.monthTitle(state.currentMonth)) + '</span><span>' + state.buildings.length + ' edificios</span><span>' + T.accounts + ' cuentas</span><span>Vencimiento: día ' + state.dueDay + '</span></div></header>' +
      '<section class="figs" aria-label="Cifras del mes">' +
      fig(ICON.wallet, 'Cobrado en ' + monthWord(state.currentMonth), fmt.money(T.collected), 'de ' + fmt.money(T.expected) + ' · ' + p + ' %', { bar: p }) +
      fig(ICON.clock, 'En revisión', '<span class="mk">' + fmt.money(T.inReview) + '</span>', queue.length + ' comprobantes por validar') +
      fig(ICON.alert, 'Deuda vencida', fmt.money(T.debt), T.moro + ' cuentas morosas', { cls: 'red' }) +
      fig(ICON.chat, 'Reclamos abiertos', String(T.threads), unloaded ? unloaded + ' edificio sin gastos del mes' : 'Todos los meses cargados') + '</section>' +
      '<section id="queue"><h2 class="sh">Comprobantes para validar<small>Contrastalos con la cuenta del banco antes de aprobar</small></h2>' + queueHtml + '</section>' +
      '<section><h2 class="sh">Edificios</h2><div class="list" style="margin-top:8px">' + (rows || '<p class="empty">Ningún edificio coincide con la búsqueda.</p>') + '</div></section>';
  };

  // ── Edificio ───────────────────────────────────────────────────────────
  const TABS = [['cobros', 'Cobros'], ['resumen', 'Resumen'], ['gastos', 'Gastos'], ['comunicaciones', 'Comunicaciones']];

  GC.views.building = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const s = L.buildingSummary(state, b);
    const counts = { cobros: s.counts.revision, comunicaciones: s.openThreads };
    const tabs = '<div class="tabs" role="tablist" style="margin-top:-12px">' + TABS.map(([id, label]) =>
      '<button type="button" role="tab" class="tab' + (view.tab === id ? ' on' : '') + '" aria-selected="' + (view.tab === id) + '" data-action="tab" data-tab="' + id + '">' + label +
      (counts[id] ? '<span class="cnt">' + counts[id] + '</span>' : '') + '</button>').join('') + '</div>';
    const body = { cobros, resumen, gastos, comunicaciones }[view.tab](state, view, b, s);

    return '<header class="head"><div><nav class="crumbs" aria-label="Ruta"><button type="button" data-action="go-home">Cartera</button><span>/</span><span>' + esc(b.name) + '</span></nav>' +
      '<h1 class="title">' + esc(b.name) + '</h1><div class="meta"><span>' + esc(b.address) + ', ' + esc(b.barrio) + '</span><span>' + b.units.length + ' unidades</span>' +
      '<span title="Suma de coeficientes de copropiedad">Coeficientes: ' + fmt.percent(L.coefficientSum(b)) + '</span></div></div>' +
      '<div class="acts"><button type="button" class="btn sec" data-action="export-csv">Exportar a Excel</button><button type="button" class="btn pri" data-action="open-expense">Cargar gastos</button></div></header>' +
      tabs + body;
  };

  function buildingFigs(state, s) {
    const p = pct(s.collected, s.expected);
    return '<section class="figs">' +
      fig(ICON.wallet, 'Cobrado en ' + monthWord(state.currentMonth), fmt.money(s.collected), 'de ' + fmt.money(s.expected) + ' · ' + p + ' %', { bar: p }) +
      fig(ICON.clock, 'En revisión', '<span class="mk">' + fmt.money(s.inReview) + '</span>', s.counts.revision + ' comprobantes') +
      fig(ICON.alert, 'Deuda vencida', fmt.money(s.debt), s.counts.moroso + ' cuentas morosas', { cls: 'red' }) +
      fig(ICON.safe, 'Fondo de reserva', fmt.money(s.reserveFund), 'Acumulado a la fecha') + '</section>';
  }

  // ── Cobros ─────────────────────────────────────────────────────────────
  const FILTERS = [['todos', 'Todos'], ['revision', 'En revisión'], ['moroso', 'Morosos'], ['pendiente', 'Pendientes'], ['pagado', 'Al día']];

  function cobros(state, view, b, s) {
    const chips = '<div class="chips" role="group" aria-label="Filtrar por estado">' + FILTERS.map(([id, label]) =>
      '<button type="button" class="ch' + (view.filter === id ? ' on' : '') + '" aria-pressed="' + (view.filter === id) + '" data-action="filter" data-filter="' + id + '">' + label + ' <b>' + (id === 'todos' ? s.total : s.counts[id]) + '</b></button>').join('') + '</div>';

    const visible = s.accounts.filter((a) => (view.filter === 'todos' || a.status === view.filter) && matchesQuery(a.unit.n + ' ' + a.person.name, view.query));
    const rows = b.units.flatMap((u) => visible.filter((a) => a.unit.n === u.n).map((a, i) => {
      const late = a.overdueMonths.length;
      return '<div class="gr cob' + (i === 0 ? ' first' : '') + '">' +
        '<button type="button" class="open" data-action="open-unit" data-key="' + esc(a.key) + '"><span class="u mono">' + (i === 0 ? esc(u.n) : '') + '</span><span class="who"><b>' + esc(a.person.name) + '</b><small>' +
        esc(GC.ROLE_LABEL[a.role]) + (u.tenant && a.role === 'owner' ? ' · fondo y extraordinarios' : '') + '</small></span></button>' +
        '<span class="mono r">' + (a.currentCharge ? fmt.money(a.currentCharge) : '—') + '</span>' +
        '<span class="mono r' + (late ? ' red' : '') + '">' + fmt.money(a.balance) + '</span>' +
        '<span>' + pill(a.status) + '<small>' + (late ? late + (late === 1 ? ' mes' : ' meses') + ' de atraso' : '') + '</small></span>' +
        '<span class="acts" style="justify-content:flex-end">' + (a.review ? '<button type="button" class="rvb" data-action="open-receipt" data-key="' + esc(a.key) + '">' + ICON.eye + '<span>Ver comprobante</span><span class="ar">' + ICON.arrow + '</span></button>' : '') + '</span></div>';
    })).join('');

    return buildingFigs(state, s) + '<section>' + chips +
      '<div class="scroll" style="margin-top:20px"><div class="list"><div class="gr cob th"><span>Unidad y responsable</span><span class="r">Cargo del mes</span><span class="r">Saldo</span><span>Estado</span><span></span></div>' + rows + '</div></div>' +
      (rows ? '' : '<p class="empty">Ninguna cuenta coincide con el filtro.</p>') + '</section>';
  }

  // ── Resumen ────────────────────────────────────────────────────────────
  function resumen(state, view, b, s) {
    const exp = s.expense;
    let gastosHtml;
    if (exp) {
      const keys = GC.CONCEPTS.map(([k]) => k);
      const max = Math.max.apply(null, keys.map((k) => Number(exp[k]) || 0));
      gastosHtml = '<p class="sub">Celeste: los paga siempre el propietario.</p>' + GC.CONCEPTS.filter(([k]) => Number(exp[k]) > 0).map(([k, label]) =>
        '<div class="cc"><span>' + esc(label) + '<small class="muted" style="display:block;font-size:11px">' + esc(k === 'extraordinary' ? exp.extraordinaryNote || '' : '') + '</small></span>' +
        '<span class="cb"><i class="' + (k === 'reserve' || k === 'extraordinary' ? 'own' : '') + '" style="width:' + ((exp[k] / max) * 100).toFixed(1) + '%"></i></span><span class="mono r">' + fmt.money(exp[k]) + '</span></div>').join('') +
        '<div class="tot"><span>Total del mes</span><span class="mono">' + fmt.money(s.expenseTotal) + '</span></div>';
    } else {
      gastosHtml = '<p class="empty">' + (s.draft ? 'Los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + ' están en borrador. Emitilos desde la pestaña Gastos.' : 'Todavía no se cargaron los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '.') + '</p>' +
        (s.draft ? '<button type="button" class="btn pri" data-action="tab" data-tab="gastos">Ir a Gastos</button>' : '<button type="button" class="btn pri" data-action="open-expense">Cargar gastos</button>');
    }

    const morosos = s.accounts.filter((a) => a.overdueMonths.length);
    const morHtml = morosos.length
      ? '<div class="scroll" style="margin-top:10px"><div class="list"><div class="gr mor th"><span>Unidad</span><span>Responsable</span><span>Meses adeudados</span><span class="r">Deuda vencida</span></div>' +
        morosos.map((a) => '<div class="gr mor"><button type="button" class="mono" style="font-weight:500" data-action="open-unit" data-key="' + esc(a.key) + '">' + esc(a.unit.n) + '</button>' +
          '<span>' + esc(a.person.name) + ' <span class="muted">· ' + esc(GC.ROLE_LABEL[a.role]) + '</span></span><span>' + esc(a.overdueMonths.map((m) => fmt.monthShort(m.month)).join(', ')) + '</span>' +
          '<span class="mono r" style="color:#98140b">' + fmt.money(a.overdueMonths.reduce((x, m) => x + m.amount, 0)) + '</span></div>').join('') + '</div></div>'
      : '<p class="empty">Ninguna cuenta con meses vencidos.</p>';

    return '<section class="two"><div><h2 class="sh">Gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '</h2>' + gastosHtml + '</div>' +
      '<div><h2 class="sh">Fondos</h2><div style="margin-top:8px">' +
      '<div class="fund"><span>Fondo de reserva</span><span class="mono">' + fmt.money(s.reserveFund) + '</span></div>' +
      '<div class="fund"><span>Cobrado este mes</span><span class="mono">' + fmt.money(s.collected) + '</span></div>' +
      '<div class="fund"><span>Por cobrar este mes</span><span class="mono">' + fmt.money(Math.max(s.expected - s.collected, 0)) + '</span></div>' +
      '<div class="fund"><span>Coeficientes asignados</span><span class="mono">' + fmt.percent(L.coefficientSum(b)) + '</span></div></div></div></section>' +
      '<section id="morosidad"><h2 class="sh">Morosidad</h2>' + morHtml + '</section>';
  }

  // ── Gastos ─────────────────────────────────────────────────────────────
  function gastos(state, view, b) {
    const n = (v) => (Number(v) ? fmt.money(v).replace('$ ', '') : '—');
    const rows = b.expenses.slice().reverse().map((e) => '<div class="gr gas"><span style="font-weight:500">' + esc(fmt.monthTitle(e.month)) + '</span>' +
      GC.CONCEPTS.map(([k]) => '<span class="mono r">' + n(e[k]) + '</span>').join('') +
      '<span class="mono r" style="font-weight:600">' + fmt.money(L.expenseTotal(e)) + '</span>' +
      '<span>' + (e.status === 'emitido' ? pill('pagado', 'Emitido')
        : pill('revision', 'Borrador') + ' <button type="button" class="lk" data-action="open-expense" data-month="' + esc(e.month) + '">Editar</button> <button type="button" class="lk" data-action="issue-expense" data-month="' + esc(e.month) + '">Emitir</button>') + '</span></div>').join('');
    return '<section><div class="head" style="align-items:center"><p class="sub" style="max-width:62ch;margin:0">Los meses en borrador se pueden corregir. Al emitir, la liquidación queda fija en el libro mayor: cualquier corrección posterior se hace con un asiento de ajuste.</p>' +
      '<button type="button" class="btn pri" data-action="open-expense">Cargar mes</button></div>' +
      '<div class="scroll" style="margin-top:24px"><div class="list" style="min-width:900px"><div class="gr gas th"><span>Mes</span><span class="r">O.S.E.</span><span class="r">U.T.E.</span><span class="r">Limpieza</span><span class="r">Honorarios</span><span class="r">F. reserva</span><span class="r">Extraord.</span><span class="r">Total</span><span>Estado</span></div>' +
      (rows || '<p class="empty">Sin gastos cargados.</p>') + '</div></div></section>';
  }

  // ── Comunicaciones ─────────────────────────────────────────────────────
  const THREAD_STATUS = { pendiente: ['pendiente', 'Pendiente'], 'en-proceso': ['revision', 'En proceso'], resuelto: ['pagado', 'Resuelto'] };

  function comunicaciones(state, view, b) {
    const sub = '<div class="chips" role="group" aria-label="Comunicaciones">' +
      '<button type="button" class="ch' + (view.commSub === 'avisos' ? ' on' : '') + '" data-action="comm-sub" data-sub="avisos">Avisos <b>' + b.notices.length + '</b></button>' +
      '<button type="button" class="ch' + (view.commSub === 'hilos' ? ' on' : '') + '" data-action="comm-sub" data-sub="hilos">Reclamos y reportes <b>' + b.threads.length + '</b></button></div>';

    if (view.commSub === 'avisos') {
      const list = b.notices.length
        ? b.notices.map((n) => '<article class="notice"><div class="nt"><span>' + esc(n.title) + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('')
        : '<p class="empty">Todavía no hay avisos publicados.</p>';
      return '<section>' + sub + '<div class="cm" style="margin-top:32px"><form data-form="notice" novalidate><h2 class="sh">Nuevo aviso</h2><p class="sub">Lo ven todos los residentes de ' + esc(b.name) + ' en su portal.</p>' +
        '<div class="fld"><label for="n-t">Asunto</label><input class="inp" id="n-t" name="title" type="text" maxlength="120" required></div>' +
        '<div class="fld"><label for="n-b">Mensaje</label><textarea class="inp ta" id="n-b" name="body" rows="5" maxlength="1200" required></textarea></div>' +
        '<p class="ferr" data-error hidden></p><button type="submit" class="btn pri">Publicar aviso</button></form><div>' + list + '</div></div></section>';
    }

    const cur = b.threads.find((t) => t.id === view.threadId) || b.threads[0];
    const list = b.threads.map((t) => '<button type="button" class="ti' + (cur && cur.id === t.id ? ' on' : '') + '" data-action="open-thread" data-id="' + esc(t.id) + '"><b>' + esc(t.title) + '</b><span>' + esc(t.author) + ' · apto ' + esc(t.unit) + '</span>' +
      '<span><span class="pill st-' + THREAD_STATUS[t.status][0] + '" style="margin-top:6px">' + THREAD_STATUS[t.status][1] + '</span></span></button>').join('');
    const detail = cur
      ? '<div><div class="head" style="align-items:flex-start;gap:12px"><div><h2 class="sh">' + esc(cur.title) + '</h2><p class="sub">' + esc(cur.author) + ' · apto ' + esc(cur.unit) + ' · ' + esc(fmt.date(cur.date)) + '</p></div>' +
        '<label><span class="vh">Estado</span><select class="inp" data-action="thread-status" data-id="' + esc(cur.id) + '" style="min-height:34px;width:auto">' +
        Object.keys(THREAD_STATUS).map((k) => '<option value="' + k + '"' + (cur.status === k ? ' selected' : '') + '>' + THREAD_STATUS[k][1] + '</option>').join('') + '</select></label></div>' +
        '<div class="msgs">' + cur.messages.map((m) => '<div class="msg' + (m.from === 'admin' ? ' me' : '') + '"><small>' + esc(m.name) + ' · ' + esc(fmt.dateShort(m.date)) + '</small>' + esc(m.text) + '</div>').join('') + '</div>' +
        '<form class="acts" data-form="reply" data-id="' + esc(cur.id) + '"><input class="inp" id="reply" name="text" type="text" aria-label="Respuesta" placeholder="Escribir respuesta…" maxlength="1000" autocomplete="off" style="flex:1"><button type="submit" class="btn pri">Enviar</button></form></div>'
      : '';
    return '<section>' + sub + '<div class="cm" style="margin-top:32px"><div class="th2">' + (list || '<p class="empty" style="padding:12px">No hay reclamos ni reportes.</p>') + '</div>' + detail + '</div></section>';
  }

  // ── Botones flotantes y paneles (atajos, gráfica, tareas) ──────────────
  GC.views.fabs = function (state, view, tasks) {
    const openN = tasks.filter((t) => !t.done).length;
    const fab = (id, label, icon, extra) => '<button type="button" class="fab' + (view.panel === id ? ' on' : '') + '" aria-label="' + label + '" aria-pressed="' + (view.panel === id) + '" title="' + label + '" data-action="panel" data-panel="' + id + '">' + icon + (extra || '') + '</button>';
    let pop = '';
    if (view.panel === 'sc') pop = shortcuts(state);
    else if (view.panel === 'ch') pop = chart(state);
    else if (view.panel === 'tk') pop = taskPanel(state, view, tasks);
    return '<div class="fabs" role="toolbar" aria-label="Paneles">' + fab('sc', 'Atajos', ICON.bolt) + fab('ch', 'Cobrado por mes', ICON.bars) +
      fab('tk', 'Tareas', ICON.list, openN ? '<span class="cnt">' + openN + '</span>' : '') + '</div>' + pop;
  };

  function shortcuts(state) {
    const all = summaries(state);
    const noCur = all.filter(({ s }) => !s.expense).map(({ b }) => b);
    const worst = all.slice().sort((x, y) => y.s.counts.moroso - x.s.counts.moroso)[0];
    const moro = all.reduce((n, { s }) => n + s.counts.moroso, 0);
    return '<aside class="pop" aria-label="Atajos"><h2 class="rh">Atajos</h2><div class="sc">' +
      '<button type="button" class="sct" data-action="shortcut-load" data-id="' + esc((noCur[0] || state.buildings[0]).id) + '"><span class="sci">' + ICON.plus + '</span><span class="scl">Cargar gastos del mes<small>' + (noCur.length ? esc(noCur.map(shortName).join(', ')) + ' sin cargar' : 'Todo al día') + '</small></span></button>' +
      '<button type="button" class="sct" data-action="go-review"><span class="sci">' + ICON.check + '</span><span class="scl">Revisar comprobantes<small>' + queueOf(state).length + ' esperando</small></span></button>' +
      '<button type="button" class="sct" data-action="shortcut-moro" data-id="' + esc(worst.b.id) + '"><span class="sci red">' + ICON.alert + '</span><span class="scl">Ver morosos<small>' + moro + ' cuentas</small></span></button></div></aside>';
  }

  function chart(state) {
    const months = Array.from(new Set(state.buildings.flatMap((b) => L.issuedExpenses(b).map((e) => e.month)))).sort().slice(-6);
    const bars = months.map((m) => {
      let issued = 0;
      let unpaid = 0;
      state.buildings.forEach((b) => {
        const exp = L.issuedExpense(b, m);
        if (!exp) return;
        L.accounts(state, b).forEach((a) => {
          issued += L.charge(a.unit, a.role, exp);
          a.unpaid.forEach((x) => { if (x.month === m) unpaid += x.amount; });
        });
      });
      const p = pct(issued - unpaid, issued);
      return '<div class="cbar" title="' + esc(fmt.monthLong(m) + ': ' + fmt.money(issued - unpaid) + ' de ' + fmt.money(issued)) + '"><span class="cbv">' + p + '%</span><span class="cbt"><i class="cbf" style="height:' + p + '%"></i></span><span class="cbl">' + esc(fmt.monthShort(m).split(' ')[0]) + '</span></div>';
    }).join('');
    return '<aside class="pop" aria-label="Cobrado por mes"><h2 class="rh">Cobrado por mes<small>sobre lo emitido</small></h2><div class="chart" role="img" aria-label="Cobrado por mes en los edificios">' + bars + '</div></aside>';
  }

  function taskPanel(state, view, tasks) {
    const isHome = view.route === 'home';
    const scope = isHome ? (view.taskFilter === 'all' ? null : view.taskFilter) : view.buildingId;
    const name = (id) => shortName(state.buildings.find((b) => b.id === id) || { name: '' });
    const days = (d) => Math.round((Date.parse(d) - Date.parse(state.today)) / 864e5);
    const list = tasks.filter((t) => !scope || t.bid === scope)
      .sort((x, y) => Number(x.done) - Number(y.done) || (x.due || '9').localeCompare(y.due || '9'))
      .map((t) => {
        const dd = t.due ? days(t.due) : null;
        const due = dd === null || t.done ? '' : '<span class="due' + (dd <= 1 ? ' warn' : '') + '">' + (dd < 0 ? 'Vencida' : dd === 0 ? 'Hoy' : dd === 1 ? 'Mañana' : 'En ' + dd + ' días') + '</span>';
        return '<li class="tk' + (t.done ? ' done' : '') + '"><button type="button" class="tkc" role="checkbox" aria-checked="' + !!t.done + '" aria-label="Marcar tarea" data-action="task-toggle" data-id="' + esc(t.id) + '"><span>' + ICON.check + '</span></button>' +
          '<span class="tkb"><span class="tkt">' + esc(t.text) + '</span><span class="tkm"><b>' + esc(name(t.bid)) + '</b>' + due + '</span></span></li>';
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
