/* Paneles superpuestos del admin: detalle de unidad (drawer), carga de gastos y revisión de comprobante.
 * El markup sigue el prototipo de design/ref (gc-admin.html). */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const L = GC.ledger;
  const esc = GC.esc;
  const fmt = GC.fmt;
  const ICON = GC.views.ICON;

  const EXPENSE_FIELDS = [
    ['ose', 'O.S.E. (agua)'],
    ['ute', 'U.T.E. (luz)'],
    ['cleaning', 'Limpieza'],
    ['fees', 'Honorarios'],
    ['reserve', 'Fondo de reserva'],
    ['extraordinary', 'Cuota extraordinaria'],
  ];

  GC.views.drawer = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const [n, role] = view.drawer.split(':');
    const unit = L.unit(b, n);
    const a = L.account(state, b, unit, role);
    const lines = L.chargeLines(unit, role, L.issuedExpense(b, state.currentMonth));
    const moves = L.movements(b, unit, role).slice(0, 6);
    const coef = fmt.percent(unit.coef);

    const roles = L.rolesOf(unit).map((r) => '<button type="button" class="ch' + (r === role ? ' on' : '') + '" data-action="open-unit" data-key="' + esc(unit.n + ':' + r) + '">' +
      GC.ROLE_LABEL[r] + (unit.tenant ? (r === 'tenant' ? ' · gastos ordinarios' : ' · reserva y extraordinarios') : ' · todos los gastos') + '</button>').join('');

    const review = a.review
      ? '<button type="button" class="rcp" data-action="open-receipt" data-key="' + esc(a.key) + '"><span><b>' + esc(a.review.file) + '</b><small style="display:block;color:#5d6573">Subido el ' + esc(fmt.date(a.review.uploadedAt)) + ' · cubre ' + fmt.money(a.balance, true) + '</small></span>' +
        '<span class="rvt">Ver comprobante ' + ICON.arrow + '</span></button>'
      : '';

    return '<button type="button" class="scrim" aria-label="Cerrar detalle" data-action="close-overlay"></button>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Detalle de unidad">' +
      '<div class="dh"><div><div class="ut"><span class="mono">' + esc(unit.n) + '</span><span class="muted">' + unit.floor + '.º piso · ' + esc(b.name) + '</span></div>' +
      '<div style="margin-top:10px;display:flex;gap:12px;align-items:center">' + GC.views.pill(a.status) + '<span class="muted" style="font-size:12px">Coeficiente ' + coef + '</span></div></div>' +
      '<button type="button" class="x" aria-label="Cerrar" data-action="close-overlay">' + ICON.close + '</button></div>' +
      '<div><div class="rl">' + roles + '</div><p style="margin-top:14px;font-weight:600;font-size:15px">' + esc(a.person.name) + '</p>' +
      '<p class="muted" style="font-size:12px">' + esc(a.person.phone) + ' · ' + esc(a.person.email) + '</p></div>' +
      '<div><div class="fl">Saldo de ' + esc(a.person.name) + '</div><div class="big" style="margin-top:2px;color:' + (a.overdueMonths.length ? '#98140b' : '#201f23') + '">' + fmt.money(a.balance, true) + '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:2px">' + (a.unpaid.length ? 'Adeuda ' + esc(a.unpaid.map((m) => fmt.monthLong(m.month)).join(', ')) : 'Sin deuda') + '</p>' +
      '<div style="margin-top:12px"><a class="btn sec sm" href="portal-residente.html?b=' + encodeURIComponent(b.id) + '&u=' + encodeURIComponent(a.key) + '" style="margin-left:-12px;text-decoration:none">Ver su portal</a></div></div>' +
      review +
      '<div><h3 class="sh" style="font-size:14px">Liquidación de ' + esc(fmt.monthLong(state.currentMonth)) + '</h3>' +
      (lines.length ? lines.map((l) => '<div class="ln"><span>' + esc(l.label) + ' <small>· ' + fmt.money(l.total) + ' × ' + coef + '</small></span><span class="mono">' + fmt.money(l.amount, true) + '</span></div>').join('')
        : '<p class="muted">Sin gastos cargados para este mes.</p>') +
      '<div class="ln" style="font-weight:600;border-top:1px solid rgba(0,0,80,.15);margin-top:4px"><span>Total ' + esc(fmt.monthLong(state.currentMonth)) + '</span><span class="mono">' + fmt.money(a.currentCharge, true) + '</span></div></div>' +
      '<div><h3 class="sh" style="font-size:14px">Últimos movimientos</h3>' +
      (moves.length ? moves.map((m) => '<div class="mv"><span class="mono muted">' + esc(fmt.dateShort(m.date)) + '</span><span' + (m.note ? ' class="muted"' : '') + '>' + esc(m.concept) + '</span>' +
        '<span class="mono r' + (m.credit ? ' cr' : '') + '">' + (m.debit ? fmt.money(m.debit) : m.credit ? '− ' + fmt.money(m.credit) : '') + '</span><span class="mono r">' + fmt.money(m.balance) + '</span></div>').join('')
        : '<p class="muted">Sin movimientos.</p>') + '</div></aside>';
  };

  // ── Revisión de comprobante ────────────────────────────────────────────
  GC.views.receiptDialog = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.receipt.buildingId);
    const [n, role] = view.receipt.key.split(':');
    const unit = L.unit(b, n);
    const a = L.account(state, b, unit, role);
    if (!a.review) return '';
    const where = b.name + ', apto ' + unit.n + ' · ' + GC.ROLE_LABEL[role];
    const checks = ['El monto coincide con el saldo a cubrir', 'La cuenta de destino es la de la administración', 'La referencia aparece en el extracto bancario'];
    const data = ' data-building="' + esc(b.id) + '" data-key="' + esc(a.key) + '"';
    return '<button type="button" class="scrim rvs" aria-label="Cerrar comprobante" data-action="close-receipt"></button>' +
      '<div class="dlg rv" role="dialog" aria-modal="true" aria-label="Revisar comprobante">' +
      '<div class="dh"><div><h2 class="title" style="font-size:22px">Comprobante de ' + esc(a.person.name) + '</h2><p class="muted" style="margin-top:4px;font-size:13px">' + esc(where) + ' · subido el ' + esc(fmt.date(a.review.uploadedAt)) + '</p></div>' +
      '<button type="button" class="x" aria-label="Cerrar" data-action="close-receipt">' + ICON.close + '</button></div>' +
      '<div class="rvg"><div><div class="rvdoc"><div class="rvtop"><span class="rvbank">Banco Demo</span><span class="rvok">Transferencia realizada</span></div>' +
      '<div class="rvamt"><small>Monto transferido</small><span>' + fmt.money(a.balance) + '</span></div>' +
      '<dl class="rvl"><div><dt>Fecha</dt><dd>' + esc(fmt.date(a.review.uploadedAt)) + '</dd></div><div><dt>Origen</dt><dd>' + esc(a.person.name) + '</dd></div>' +
      '<div><dt>Destino</dt><dd>' + esc(state.company.name) + ' · cta. ···· 4821</dd></div><div><dt>Referencia</dt><dd class="mono">TRF-' + (480000 + Number(unit.n) * 37) + '</dd></div></dl></div>' +
      '<p class="muted" style="font-size:11px;margin-top:10px">' + esc(a.review.file) + ' · vista de ejemplo</p></div>' +
      '<div class="rvr"><div><div class="fl">Debe cubrir</div><div class="big" style="margin-top:2px">' + fmt.money(a.balance) + '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:2px">' + (a.unpaid.length ? esc(a.unpaid.map((m) => fmt.monthLong(m.month)).join(', ')) : 'Sin deuda') + '</p></div>' +
      '<fieldset class="chk"><legend class="fl">Antes de aprobar</legend>' + checks.map((c, i) => '<label class="ck"><input type="checkbox" id="k' + i + '"><span>' + c + '</span></label>').join('') + '</fieldset>' +
      '<div class="pf" style="margin-top:auto"><button type="button" class="btn sec" data-action="reject"' + data + '>Rechazar</button><button type="button" class="btn pri" data-action="validate"' + data + '>Aprobar comprobante</button></div></div></div></div>';
  };

  // ── Diálogo de gastos ──────────────────────────────────────────────────
  function nextMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
  }

  GC.views.defaultExpenseMonth = function (state, building) {
    if (!L.expenseFor(building, state.currentMonth)) return state.currentMonth;
    const draft = building.expenses.find((e) => e.status !== 'emitido');
    if (draft) return draft.month;
    return nextMonth(building.expenses[building.expenses.length - 1].month);
  };

  GC.views.expenseDialog = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const month = view.dialog.month;
    const existing = L.expenseFor(b, month);
    const base = existing || b.expenses[b.expenses.length - 1] || {};
    const fields = EXPENSE_FIELDS.map(([k, label]) => {
      const value = existing ? existing[k] : (k === 'extraordinary' ? 0 : base[k] || 0);
      return '<div class="fld"><label for="f-' + k + '">' + label + '</label><input class="inp mono" id="f-' + k + '" name="' + k + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(value) + '"></div>';
    }).join('');

    return '<button type="button" class="scrim" aria-label="Cerrar" data-action="close-overlay"></button>' +
      '<form class="dlg" role="dialog" aria-modal="true" aria-label="Gastos del mes" data-form="expense" novalidate>' +
      '<div class="dh"><div><h2 class="title" style="font-size:22px">Gastos del mes</h2><p class="muted" style="margin-top:4px;font-size:13px">' + esc(b.name) + ' · ' +
      (existing ? 'editando el borrador con los montos guardados.' : 'se precargan los montos del último mes como referencia.') + '</p></div>' +
      '<button type="button" class="x" aria-label="Cerrar" data-action="close-overlay">' + ICON.close + '</button></div>' +
      '<div class="ef"><div><div class="fld" style="grid-template-columns:1fr"><label for="x-m">Mes</label><input class="inp" id="x-m" name="month" type="month" value="' + esc(month) + '" required></div>' + fields +
      '<div class="fld" style="grid-template-columns:1fr;margin-top:14px"><label for="x-n">Detalle de la cuota extraordinaria</label><input class="inp" id="x-n" name="extraordinaryNote" type="text" maxlength="140" value="' + esc(existing ? existing.extraordinaryNote : '') + '" placeholder="Ej.: pintura de fachada"></div>' +
      '<p class="ferr" data-error hidden></p></div>' +
      '<div><h3 class="sh" style="font-size:14px">Prorrateo por coeficiente</h3><p class="sub">Así queda la liquidación de cada unidad.</p><div data-preview></div></div></div>' +
      '<div class="pf"><button type="button" class="btn sec" data-action="close-overlay">Cancelar</button><button type="submit" class="btn pri">Guardar borrador</button></div></form>';
  };

  /** Lee y valida el formulario. Devuelve { expense } o { error }. */
  GC.views.readExpenseForm = function (form, state, building) {
    const data = new FormData(form);
    const month = String(data.get('month') || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'Elegí el mes de la liquidación.' };
    const existing = L.expenseFor(building, month);
    if (existing && existing.status === 'emitido') {
      return { error: GC.fmt.monthTitle(month) + ' ya fue emitido y no se puede modificar. Registrá un ajuste.' };
    }
    const exp = { month, status: 'abierto', extraordinaryNote: String(data.get('extraordinaryNote') || '').trim().slice(0, 140) };
    for (const [k, label] of EXPENSE_FIELDS) {
      const raw = String(data.get(k) || '0').trim();
      const value = Number(raw === '' ? 0 : raw);
      if (!Number.isFinite(value) || value < 0) return { error: label + ': ingresá un monto válido (0 o más).' };
      if (value > 10000000) return { error: label + ': el monto parece demasiado alto.' };
      exp[k] = Math.round(value);
    }
    if (L.expenseTotal(exp) <= 0) return { error: 'La liquidación no puede quedar en $ 0.' };
    if (exp.extraordinary > 0 && !exp.extraordinaryNote) return { error: 'Contá a qué corresponde la cuota extraordinaria.' };
    return { expense: exp };
  };

  GC.views.expensePreview = function (building, exp) {
    let totalTenant = 0;
    let totalOwner = 0;
    const rows = building.units.map((u) => {
      const tenant = u.tenant ? L.charge(u, 'tenant', exp) : 0;
      const owner = L.charge(u, 'owner', exp);
      totalTenant += tenant;
      totalOwner += owner;
      return '<div class="pv"><span class="mono">' + esc(u.n) + '</span><span class="mono r">' + (u.tenant ? fmt.money(tenant) : '—') + '</span><span class="mono r">' + fmt.money(owner) + '</span><span class="mono r" style="font-weight:600">' + fmt.money(tenant + owner) + '</span></div>';
    }).join('');
    const total = L.expenseTotal(exp);
    const diff = Math.round(total - totalTenant - totalOwner);
    return '<div class="pv hd"><span>Unidad</span><span class="r">Inquilino</span><span class="r">Propietario</span><span class="r">Total</span></div>' + rows +
      '<div class="tot"><span>Total distribuido</span><span class="mono">' + fmt.money(totalTenant + totalOwner) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin-top:6px">' + (Math.abs(diff) <= 1 ? 'Coincide con el total cargado (' + fmt.money(total) + ').' : '<span style="color:#98140b">Diferencia de ' + fmt.money(diff) + ' contra el total: revisá los coeficientes.</span>') + '</p>';
  };
})(window.GC);
