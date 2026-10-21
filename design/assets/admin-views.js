/* Vistas del panel de administración. Funciones puras: (estado, vista) → HTML. */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const L = GC.ledger;
  const esc = GC.esc;
  const fmt = GC.fmt;
  const icon = GC.icon;

  const LEGEND_COLORS = { pagado: 'var(--paid)', revision: '#d9a441', pendiente: 'var(--line-strong)', moroso: 'var(--overdue)', 'sin-cargar': 'var(--review-soft)' };

  const status = GC.views.status;

  function bar(summary) {
    const segs = L.segments(summary.counts, summary.total);
    if (!segs.length) return '<div class="collection-bar" aria-hidden="true"></div>';
    return '<div class="collection-bar" role="img" aria-label="' +
      esc(segs.map((s) => s.count + ' ' + GC.STATUS_LABEL[s.key].toLowerCase()).join(', ')) + '">' +
      segs.map((s, i) => '<span class="seg-' + s.key + '" style="width:' + s.pct.toFixed(2) + '%;animation-delay:' + i * 60 + 'ms"></span>').join('') +
      '</div>';
  }

  function legend(counts) {
    return '<div class="legend">' + ['pagado', 'revision', 'pendiente', 'moroso', 'sin-cargar']
      .filter((k) => counts[k] > 0)
      .map((k) => '<span><i style="background:' + LEGEND_COLORS[k] + '"></i>' + counts[k] + ' ' + esc(GC.STATUS_LABEL[k].toLowerCase()) + '</span>')
      .join('') + '</div>';
  }

  // ── Sidebar ────────────────────────────────────────────────────────────

  GC.views.side = function (state, view) {
    const buildings = state.buildings.map((b) => {
      const s = L.buildingSummary(state, b);
      const current = view.route === 'building' && view.buildingId === b.id;
      return '<button class="nav-item nav-building" data-action="open-building" data-id="' + esc(b.id) + '"' +
        (current ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-building__top"><span>' + esc(b.name) + '<br><span class="nav-building__addr">' + esc(b.address) + '</span></span>' +
        (s.counts.revision ? '<span class="pill-count" title="Comprobantes para validar">' + s.counts.revision + '</span>' : '') +
        '</span>' + bar(s) + '</button>';
    }).join('');

    return '<div class="brand"><div class="brand__mark">C</div><div><div class="brand__name">' + esc(state.company.name) +
      '</div><div class="brand__sub">Administración de edificios</div></div></div>' +
      '<nav aria-label="Principal">' +
      '<button class="nav-item" data-action="go-home"' + (view.route === 'home' ? ' aria-current="page"' : '') + '>' + icon('home') + 'Cartera</button>' +
      '<div class="side__label">Edificios</div>' + buildings + '</nav>' +
      '<div class="side__foot">' +
      '<a class="nav-item" href="portal-residente.html">' + icon('arrow') + 'Portal de residentes</a>' +
      '<button class="nav-item" data-action="reset-demo">' + icon('reset') + 'Reiniciar datos de demo</button>' +
      '<div class="side__user">' + esc(state.company.email) + '</div></div>';
  };

  // ── Cartera (home) ─────────────────────────────────────────────────────
  GC.views.home = function (state) {
    const summaries = state.buildings.map((b) => ({ b, s: L.buildingSummary(state, b) }));
    const total = summaries.reduce((acc, { s }) => ({
      expected: acc.expected + s.expected,
      collected: acc.collected + s.collected,
      inReview: acc.inReview + s.inReview,
      debt: acc.debt + s.debt,
      threads: acc.threads + s.openThreads,
      counts: Object.keys(s.counts).reduce((c, k) => ({ ...c, [k]: (c[k] || 0) + s.counts[k] }), acc.counts),
      accounts: acc.accounts + s.total,
    }), { expected: 0, collected: 0, inReview: 0, debt: 0, threads: 0, counts: {}, accounts: 0 });
    const pct = total.expected ? Math.round((total.collected / total.expected) * 100) : 0;
    const queue = summaries.flatMap(({ b, s }) => s.accounts.filter((a) => a.review).map((a) => ({ b, a })));
    const unloaded = summaries.filter(({ s }) => !s.expense);

    const rows = summaries.map(({ b, s }) => '<button class="building-row" data-action="open-building" data-id="' + esc(b.id) + '">' +
      '<div><div class="building-row__name">' + esc(b.name) + '</div><div class="building-row__addr">' + esc(b.address) + ' · ' + b.units.length + ' unidades</div></div>' +
      '<div>' + bar(s) + legend(s.counts) +
      (s.expense ? '' : '<div class="warn-line">' + (s.draft ? 'Falta emitir' : 'Faltan cargar') + ' los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '</div>') + '</div>' +
      '<div><div class="cell-label">Cobrado del mes</div><div class="cell-value">' + fmt.money(s.collected) + '</div><div class="cell-label">de ' + fmt.money(s.expected) + '</div></div>' +
      '<div><div class="cell-label">Deuda vencida</div><div class="cell-value"' + (s.debt ? ' style="color:var(--overdue)"' : '') + '>' + fmt.money(s.debt) + '</div></div>' +
      '<span class="building-row__go">' + icon('arrow') + '</span></button>').join('');

    const queueHtml = queue.length
      ? '<div class="queue">' + queue.map(({ b, a }) => '<div class="queue-item">' +
        '<span class="queue-item__icon">' + icon('file') + '</span>' +
        '<div><div class="queue-item__title">' + esc(a.person.name) + ' · ' + esc(b.name) + ', apto ' + esc(a.unit.n) + '</div>' +
        '<div class="queue-item__sub">' + esc(a.review.file) + ' · subido el ' + esc(fmt.date(a.review.uploadedAt)) + ' · ' + esc(GC.ROLE_LABEL[a.role]) + '</div></div>' +
        '<span class="num">' + fmt.money(a.balance) + '</span>' +
        '<div class="queue-item__actions"><button class="btn btn--sm btn--primary" data-action="validate" data-building="' + esc(b.id) + '" data-key="' + esc(a.key) + '">' + icon('check') + 'Validar</button>' +
        '<button class="btn btn--sm" data-action="reject" data-building="' + esc(b.id) + '" data-key="' + esc(a.key) + '">Rechazar</button></div></div>').join('') + '</div>'
      : '<div class="queue"><div class="empty">No hay comprobantes esperando validación.</div></div>';

    return '<header class="page-head"><div class="page-title-row"><div><h1 class="page-title">Cartera de ' + esc(state.company.name) + '</h1>' +
      '<div class="page-meta"><span>' + esc(fmt.monthTitle(state.currentMonth)) + '</span><span>' + state.buildings.length + ' edificios</span><span>' +
      total.accounts + ' cuentas</span><span>Vencimiento: día ' + state.dueDay + '</span></div></div></div></header>' +
      '<div class="figures" style="margin-top:var(--s-6);border-top:1px solid var(--line)">' +
      '<div class="figure"><div class="figure__label">Cobrado en ' + esc(fmt.monthLong(state.currentMonth)) + '</div>' +
      '<div class="figure__value figure__value--hero">' + fmt.money(total.collected) + ' <small>/ ' + fmt.money(total.expected) + ' · ' + pct + ' %</small></div>' +
      bar({ counts: total.counts, total: total.accounts }) + legend(total.counts) + '</div>' +
      '<div class="figure figure--review"><div class="figure__label">En revisión</div><div class="figure__value">' + fmt.money(total.inReview) + '</div><div class="figure__foot">' + queue.length + ' comprobantes por validar</div></div>' +
      '<div class="figure figure--overdue"><div class="figure__label">Deuda vencida</div><div class="figure__value">' + fmt.money(total.debt) + '</div><div class="figure__foot">' + (total.counts.moroso || 0) + ' cuentas morosas</div></div>' +
      '<div class="figure"><div class="figure__label">Reclamos abiertos</div><div class="figure__value">' + total.threads + '</div><div class="figure__foot">' +
      (unloaded.length ? unloaded.length + ' edificio sin gastos del mes' : 'Todos los meses cargados') + '</div></div></div>' +
      '<section class="section" aria-labelledby="queue-title"><h2 class="section-title" id="queue-title">Comprobantes para validar<small>Contrastalos con la cuenta de Scotiabank antes de aprobar</small></h2>' + queueHtml + '</section>' +
      '<section aria-labelledby="portfolio-title"><h2 class="section-title" id="portfolio-title" style="padding:0 var(--s-8)">Edificios</h2><div class="portfolio" style="border-top:1px solid var(--line)">' + rows + '</div></section>';
  };

  // ── Edificio: cabecera y pestañas ──────────────────────────────────────
  const TABS = [['cobros', 'Cobros'], ['resumen', 'Resumen'], ['gastos', 'Gastos'], ['comunicaciones', 'Comunicaciones']];

  GC.views.building = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const s = L.buildingSummary(state, b);
    const coefSum = L.coefficientSum(b);
    const counts = { cobros: s.counts.revision, comunicaciones: s.openThreads };
    const tabs = '<div class="tabs" role="tablist">' + TABS.map(([id, label]) =>
      '<button class="tab" role="tab" data-action="tab" data-tab="' + id + '" aria-selected="' + (view.tab === id) + '">' + label +
      (counts[id] ? '<span class="count">' + counts[id] + '</span>' : '') + '</button>').join('') + '</div>';

    const body = { cobros: cobros, resumen: resumen, gastos: gastos, comunicaciones: comunicaciones }[view.tab](state, view, b, s);

    return '<header class="page-head"><nav class="crumbs" aria-label="Ruta"><button data-action="go-home">Cartera</button><span>/</span><span>' + esc(b.name) + '</span></nav>' +
      '<div class="page-title-row"><div><h1 class="page-title">' + esc(b.name) + '</h1><div class="page-meta"><span>' + esc(b.address) + ', ' + esc(b.barrio) + '</span><span>' +
      b.units.length + ' unidades</span><span title="Suma de coeficientes de copropiedad">Coeficientes: ' + fmt.percent(coefSum) + '</span></div></div>' +
      '<div class="page-actions"><button class="btn" data-action="export-csv">' + icon('download') + 'Exportar a Excel</button>' +
      '<button class="btn btn--primary" data-action="open-expense">' + icon('plus') + 'Cargar gastos</button></div></div>' + tabs + '</header>' + body;
  };

  function figuresFor(state, s) {
    const pct = s.expected ? Math.round((s.collected / s.expected) * 100) : 0;
    return '<div class="figures"><div class="figure"><div class="figure__label">Cobrado en ' + esc(fmt.monthLong(state.currentMonth)) + '</div>' +
      '<div class="figure__value figure__value--hero">' + fmt.money(s.collected) + ' <small>/ ' + fmt.money(s.expected) + ' · ' + pct + ' %</small></div>' + bar(s) + legend(s.counts) + '</div>' +
      '<div class="figure figure--review"><div class="figure__label">En revisión</div><div class="figure__value">' + fmt.money(s.inReview) + '</div><div class="figure__foot">' + s.counts.revision + ' comprobantes</div></div>' +
      '<div class="figure figure--overdue"><div class="figure__label">Deuda vencida</div><div class="figure__value">' + fmt.money(s.debt) + '</div><div class="figure__foot">' + s.counts.moroso + ' cuentas morosas</div></div>' +
      '<div class="figure"><div class="figure__label">Fondo de reserva</div><div class="figure__value">' + fmt.money(s.reserveFund) + '</div><div class="figure__foot">Acumulado a la fecha</div></div></div>';
  }

  // ── Cobros ─────────────────────────────────────────────────────────────
  const FILTERS = [['todos', 'Todos'], ['revision', 'En revisión'], ['moroso', 'Morosos'], ['pendiente', 'Pendientes'], ['pagado', 'Al día']];

  function matches(a, view) {
    if (view.filter !== 'todos' && a.status !== view.filter) return false;
    const q = (view.query || '').trim().toLowerCase();
    if (!q) return true;
    return a.unit.n.includes(q) || a.person.name.toLowerCase().includes(q);
  }

  function cobros(state, view, b, s) {
    const chips = '<div class="chips" role="group" aria-label="Filtrar por estado">' + FILTERS.map(([id, label]) => {
      const n = id === 'todos' ? s.total : s.counts[id];
      return '<button class="chip" data-action="filter" data-filter="' + id + '" aria-pressed="' + (view.filter === id) + '">' + label + ' <b>' + n + '</b></button>';
    }).join('') + '</div>';

    const visible = s.accounts.filter((a) => matches(a, view));
    const byUnit = b.units.map((u) => ({ u, rows: visible.filter((a) => a.unit.n === u.n) })).filter((g) => g.rows.length);

    const body = byUnit.map(({ u, rows }) => rows.map((a, i) => {
      const actions = a.review
        ? '<div class="row-actions"><button class="btn btn--sm btn--primary" data-action="validate" data-key="' + esc(a.key) + '">' + icon('check') + 'Validar</button>' +
          '<button class="btn btn--sm" data-action="reject" data-key="' + esc(a.key) + '">Rechazar</button></div>'
        : '';
      const overdue = a.overdueMonths.length ? '<span class="overdue-note">' + a.overdueMonths.length + (a.overdueMonths.length === 1 ? ' mes' : ' meses') + ' de atraso</span>' : '';
      return '<tr class="is-clickable' + (i === 0 ? ' unit-start' : ' unit-cont') + '" data-action="open-unit" data-key="' + esc(a.key) + '" tabindex="0">' +
        (i === 0 ? '<td class="unit-cell" rowspan="' + rows.length + '">' + esc(u.n) + '<small>' + fmt.percent(u.coef) + '</small></td>' : '') +
        '<td><div class="who">' + esc(a.person.name) + '<small>' + esc(GC.ROLE_LABEL[a.role]) + (a.unit.tenant && a.role === 'owner' ? ' · fondo y extraordinarios' : '') + '</small></div></td>' +
        '<td class="right num">' + (a.currentCharge ? fmt.money(a.currentCharge) : '—') + '</td>' +
        '<td class="right num"' + (a.overdueMonths.length ? ' style="color:var(--overdue)"' : '') + '>' + fmt.money(a.balance) + '</td>' +
        '<td>' + status(a.status) + overdue + '</td><td class="right">' + actions + '</td></tr>';
    }).join('')).join('');

    return figuresFor(state, s) +
      '<div class="toolbar">' + chips + '<label class="search"><span class="visually-hidden">Buscar</span>' + icon('search') +
      '<input class="input" type="search" placeholder="Buscar unidad o nombre" data-action="search" value="' + esc(view.query) + '"></label></div>' +
      '<div class="table-wrap"><table class="ledger"><thead><tr><th>Unidad</th><th>Responsable</th><th class="right">Cargo del mes</th><th class="right">Saldo</th><th>Estado</th><th class="right"><span class="visually-hidden">Acciones</span></th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="6"><div class="empty">Ninguna cuenta coincide con el filtro.</div></td></tr>') + '</tbody></table></div>';
  }

  // ── Resumen ────────────────────────────────────────────────────────────
  function resumen(state, view, b, s) {
    const exp = s.expense;
    let breakdown;
    if (exp) {
      const max = Math.max.apply(null, GC.CONCEPTS.map(([k]) => Number(exp[k]) || 0));
      breakdown = '<div class="concept-bars">' + GC.CONCEPTS.filter(([k]) => Number(exp[k]) > 0).map(([k, label], i) =>
        '<div class="concept"><span>' + esc(label) + (k === 'extraordinary' && exp.extraordinaryNote ? '<br><span class="muted" style="font-size:var(--text-xs)">' + esc(exp.extraordinaryNote) + '</span>' : '') + '</span>' +
        '<div class="concept__track"><div class="concept__fill' + (k === 'reserve' || k === 'extraordinary' ? ' concept__fill--owner' : '') + '" style="width:' + ((exp[k] / max) * 100).toFixed(1) + '%;animation-delay:' + i * 50 + 'ms"></div></div>' +
        '<span class="num" style="text-align:right">' + fmt.money(exp[k]) + '</span></div>').join('') + '</div>' +
        '<div class="concept-total"><span>Total del mes</span><span class="num">' + fmt.money(s.expenseTotal) + '</span></div>' +
        '<div class="legend" style="margin-top:var(--s-4)"><span><i style="background:var(--brand)"></i>Ordinarios · inquilino, o propietario si no hay inquilino</span><span><i style="background:#8a6d3b"></i>Siempre el propietario</span></div>';
    } else {
      breakdown = '<div class="empty">' + (s.draft ? 'Los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + ' están en borrador. Emitilos desde la pestaña Gastos.' : 'Todavía no se cargaron los gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '.') + '<br><br><button class="btn btn--primary" data-action="' + (s.draft ? 'tab" data-tab="gastos' : 'open-expense') + '">' + (s.draft ? 'Ir a Gastos' : icon('plus') + 'Cargar gastos') + '</button></div>';
    }

    const morosos = s.accounts.filter((a) => a.overdueMonths.length);
    const morososHtml = morosos.length
      ? '<table class="ledger"><thead><tr><th>Unidad</th><th>Responsable</th><th>Meses adeudados</th><th class="right">Deuda vencida</th></tr></thead><tbody>' +
        morosos.map((a) => '<tr class="is-clickable" data-action="open-unit" data-key="' + esc(a.key) + '" tabindex="0"><td class="num">' + esc(a.unit.n) + '</td><td>' + esc(a.person.name) + ' <span class="muted">· ' + esc(GC.ROLE_LABEL[a.role]) + '</span></td>' +
          '<td>' + esc(a.overdueMonths.map((m) => fmt.monthShort(m.month)).join(', ')) + '</td><td class="right num" style="color:var(--overdue)">' +
          fmt.money(a.overdueMonths.reduce((x, m) => x + m.amount, 0)) + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="section"><div class="empty">Ninguna cuenta con meses vencidos.</div></div>';

    return figuresFor(state, s) + '<div class="split"><section class="section"><h2 class="section-title">Gastos de ' + esc(fmt.monthLong(state.currentMonth)) + '</h2>' + breakdown + '</section>' +
      '<section class="section"><h2 class="section-title">Fondos</h2>' +
      '<div class="fund"><span>Fondo de reserva</span><span class="fund__value">' + fmt.money(s.reserveFund) + '</span></div>' +
      '<div class="fund"><span>Cobrado este mes</span><span class="fund__value">' + fmt.money(s.collected) + '</span></div>' +
      '<div class="fund"><span>Por cobrar este mes</span><span class="fund__value">' + fmt.money(Math.max(s.expected - s.collected, 0)) + '</span></div>' +
      '<div class="fund"><span>Coeficientes asignados</span><span class="fund__value">' + fmt.percent(L.coefficientSum(b)) + '</span></div></section></div>' +
      '<section><h2 class="section-title" style="padding:var(--s-6) var(--s-8) 0">Morosidad</h2>' + morososHtml + '</section>';
  }

  // ── Gastos ─────────────────────────────────────────────────────────────
  function gastos(state, view, b) {
    const rows = b.expenses.slice().reverse().map((e) => '<tr><td>' + esc(fmt.monthTitle(e.month)) + '</td>' +
      GC.CONCEPTS.map(([k]) => '<td class="right num">' + (Number(e[k]) ? fmt.money(e[k]).replace('$ ', '') : '—') + '</td>').join('') +
      '<td class="right num" style="font-weight:600">' + fmt.money(L.expenseTotal(e)) + '</td>' +
      '<td>' + (e.status === 'emitido' ? status('pagado', 'Emitido') : status('revision', 'Borrador')) + '</td>' +
      '<td class="right"><div class="row-actions">' + (e.status === 'emitido'
        ? '<span class="muted" style="font-size:var(--text-xs)">Inmutable</span>'
        : '<button class="btn btn--sm" data-action="open-expense" data-month="' + esc(e.month) + '">Editar</button><button class="btn btn--sm btn--primary" data-action="issue-expense" data-month="' + esc(e.month) + '">Emitir</button>') +
      '</div></td></tr>').join('');
    return '<div class="toolbar"><p class="form-note" style="max-width:62ch">Los meses en borrador se pueden corregir. Al emitir, la liquidación queda fija en el libro mayor: cualquier corrección posterior se hace con un asiento de ajuste.</p>' +
      '<button class="btn btn--primary" data-action="open-expense">' + icon('plus') + 'Cargar mes</button></div>' +
      '<div class="table-wrap"><table class="ledger"><thead><tr><th>Mes</th><th class="right">O.S.E.</th><th class="right">U.T.E.</th><th class="right">Limpieza</th><th class="right">Honorarios</th><th class="right">F. reserva</th><th class="right">Extraord.</th><th class="right">Total</th><th>Estado</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10"><div class="empty">Sin gastos cargados.</div></td></tr>') + '</tbody></table></div>';
  }

  // ── Comunicaciones ─────────────────────────────────────────────────────
  const THREAD_STATUS = { pendiente: ['pendiente', 'Pendiente'], 'en-proceso': ['revision', 'En proceso'], resuelto: ['pagado', 'Resuelto'] };

  function comunicaciones(state, view, b) {
    const sub = '<div class="subtabs chips" role="group"><button class="chip" data-action="comm-sub" data-sub="avisos" aria-pressed="' + (view.commSub === 'avisos') + '">Avisos <b>' + b.notices.length + '</b></button>' +
      '<button class="chip" data-action="comm-sub" data-sub="hilos" aria-pressed="' + (view.commSub === 'hilos') + '">Reclamos y reportes <b>' + b.threads.length + '</b></button></div>';

    if (view.commSub === 'avisos') {
      const list = b.notices.length
        ? b.notices.map((n) => '<article class="notice"><div class="notice__title"><span>' + esc(n.title) + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('')
        : '<div class="empty">Todavía no hay avisos publicados.</div>';
      return sub + '<div class="notice-grid"><form class="notice-form" data-form="notice" novalidate><div class="section-title" style="margin:0">Nuevo aviso</div>' +
        '<div class="field"><label for="notice-title">Asunto</label><input class="input" id="notice-title" name="title" maxlength="120" required></div>' +
        '<div class="field"><label for="notice-body">Mensaje</label><textarea class="textarea" id="notice-body" name="body" rows="5" maxlength="1200" required></textarea></div>' +
        '<p class="form-error" data-error hidden></p><p class="form-note">Lo ven todos los residentes de ' + esc(b.name) + ' en su portal.</p>' +
        '<button class="btn btn--primary" type="submit">Publicar aviso</button></form><div>' + list + '</div></div>';
    }

    const current = b.threads.find((t) => t.id === view.threadId) || b.threads[0];
    const list = b.threads.map((t) => {
      const [cls, label] = THREAD_STATUS[t.status];
      return '<button class="thread-item" data-action="open-thread" data-id="' + esc(t.id) + '" aria-current="' + (current && current.id === t.id) + '">' +
        '<span class="thread-item__title">' + esc(t.title) + '</span><span class="thread-item__meta"><span>' + esc(t.author) + ' · apto ' + esc(t.unit) + '</span>' + status(cls, label) + '</span>' +
        '<span class="thread-item__meta"><span>' + (t.kind === 'reclamo' ? 'Reclamo' : 'Reporte') + '</span><span>' + esc(fmt.dateShort(t.date)) + '</span></span></button>';
    }).join('');

    const detail = current
      ? '<div class="comms__head"><div><div class="section-title" style="margin:0">' + esc(current.title) + '</div><div class="muted" style="font-size:var(--text-xs)">' + esc(current.author) + ' · apto ' + esc(current.unit) + ' · ' + esc(fmt.date(current.date)) + '</div></div>' +
        '<label><span class="visually-hidden">Estado</span><select class="select" data-action="thread-status" data-id="' + esc(current.id) + '" style="min-height:32px">' +
        Object.keys(THREAD_STATUS).map((k) => '<option value="' + k + '"' + (current.status === k ? ' selected' : '') + '>' + THREAD_STATUS[k][1] + '</option>').join('') + '</select></label></div>' +
        '<div class="comms__body"><div class="thread">' + current.messages.map((m) => '<div class="msg' + (m.from === 'admin' ? ' msg--mine' : '') + '"><div class="msg__who">' + esc(m.name) + '<time>' + esc(fmt.dateShort(m.date)) + '</time></div>' + esc(m.text) + '</div>').join('') + '</div></div>' +
        '<form class="composer" data-form="reply" data-id="' + esc(current.id) + '"><label class="visually-hidden" for="reply">Respuesta</label><input class="input" id="reply" name="text" placeholder="Escribir respuesta…" maxlength="1000" autocomplete="off"><button class="btn btn--primary" type="submit">Enviar</button></form>'
      : '<div class="empty">No hay reclamos ni reportes.</div>';

    return sub + '<div class="comms" style="margin-top:var(--s-4);border-top:1px solid var(--line)"><div class="comms__list">' + (list || '<div class="empty">Sin hilos.</div>') + '</div><div class="comms__detail">' + detail + '</div></div>';
  }

})(window.GC);
