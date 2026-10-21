/* Paneles superpuestos del admin: detalle de unidad (drawer) y carga de gastos (diálogo). */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const L = GC.ledger;
  const esc = GC.esc;
  const fmt = GC.fmt;
  const icon = GC.icon;

  const EXPENSE_FIELDS = [
    ['ose', 'O.S.E. (agua)'],
    ['ute', 'U.T.E. (luz)'],
    ['cleaning', 'Limpieza'],
    ['fees', 'Honorarios'],
    ['reserve', 'Fondo de reserva'],
    ['extraordinary', 'Cuota extraordinaria'],
  ];

  function personCard(unit, role, activeRole) {
    const p = role === 'tenant' ? unit.tenant : unit.owner;
    return '<button class="person-card" style="text-align:left;background:none;cursor:pointer" data-action="drawer-role" data-key="' + esc(unit.n + ':' + role) + '" data-active="' + (role === activeRole) + '">' +
      '<div class="person-card__role">' + GC.ROLE_LABEL[role] + (unit.tenant ? (role === 'tenant' ? ' · gastos ordinarios' : ' · fondo de reserva y extraordinarios') : ' · todos los gastos') + '</div>' +
      '<div class="person-card__name">' + esc(p.name) + '</div><div class="person-card__contact">' + esc(p.phone) + ' · ' + esc(p.email) + '</div></button>';
  }

  GC.views.drawer = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const [n, role] = view.drawer.split(':');
    const unit = L.unit(b, n);
    const a = L.account(state, b, unit, role);
    const lines = L.chargeLines(unit, role, L.issuedExpense(b, state.currentMonth));
    const movements = L.movements(b, unit, role);

    const review = a.review
      ? '<div class="receipt">' + icon('file') + '<div><strong>' + esc(a.review.file) + '</strong><div class="muted" style="font-size:var(--text-xs)">Subido el ' + esc(fmt.date(a.review.uploadedAt)) + ' · cubre ' + fmt.money(a.balance) + '</div></div>' +
        '<div class="row-actions"><button class="btn btn--sm btn--primary" data-action="validate" data-key="' + esc(a.key) + '">' + icon('check') + 'Validar</button><button class="btn btn--sm" data-action="reject" data-key="' + esc(a.key) + '">Rechazar</button></div></div>'
      : '';

    const linesHtml = lines.length
      ? '<table class="ledger"><tbody>' + lines.map((l) => '<tr><td>' + esc(l.label) + ' <span class="muted">· ' + fmt.money(l.total) + ' × ' + fmt.percent(unit.coef) + '</span></td><td class="right num">' + fmt.money(l.amount, true) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td>Total ' + esc(fmt.monthLong(state.currentMonth)) + '</td><td class="right num">' + fmt.money(a.currentCharge, true) + '</td></tr></tfoot></table>'
      : '<p class="muted" style="font-size:var(--text-sm)">Sin gastos cargados para este mes.</p>';

    const movHtml = movements.length
      ? '<table class="ledger"><thead><tr><th>Fecha</th><th>Concepto</th><th class="right">Debe</th><th class="right">Haber</th><th class="right">Saldo</th></tr></thead><tbody>' +
        movements.map((m) => '<tr><td class="num" style="white-space:nowrap">' + esc(fmt.dateShort(m.date)) + '</td><td' + (m.note ? ' class="muted"' : '') + '>' + esc(m.concept) + '</td>' +
          '<td class="right num">' + (m.debit ? fmt.money(m.debit) : '') + '</td><td class="right num credit">' + (m.credit ? fmt.money(m.credit) : '') + '</td><td class="right num">' + fmt.money(m.balance) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="muted">Sin movimientos.</p>';

    return '<div class="scrim" data-action="close-overlay"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">' +
      '<div class="panel-head"><div><div class="unit-title"><h2 id="drawer-title">' + esc(unit.n) + '</h2><span class="muted">' + unit.floor + '.º piso · ' + esc(b.name) + '</span></div>' +
      '<div style="margin-top:6px">' + GC.views.status(a.status) + ' <span class="muted" style="font-size:var(--text-xs);margin-left:6px">Coeficiente ' + fmt.percent(unit.coef) + '</span></div></div>' +
      '<button class="icon-btn" data-action="close-overlay" aria-label="Cerrar">' + icon('close') + '</button></div>' +
      '<div class="panel-body"><div class="people">' + L.rolesOf(unit).map((r) => personCard(unit, r, role)).join('') + '</div>' +
      '<div class="balance-box"><div><div class="figure__label">Saldo de ' + esc(a.person.name) + '</div><div class="balance-box__value"' + (a.overdueMonths.length ? ' style="color:var(--overdue)"' : '') + '>' + fmt.money(a.balance, true) + '</div>' +
      '<div class="muted" style="font-size:var(--text-xs)">' + (a.unpaid.length ? 'Adeuda ' + esc(a.unpaid.map((m) => fmt.monthLong(m.month)).join(', ')) : 'Sin deuda') + '</div></div>' +
      '<a class="btn btn--sm" href="portal-residente.html?b=' + encodeURIComponent(b.id) + '&u=' + encodeURIComponent(a.key) + '">Ver su portal' + icon('arrow') + '</a></div>' + review +
      '<h3>Liquidación de ' + esc(fmt.monthLong(state.currentMonth)) + '</h3>' + linesHtml +
      '<h3>Cuenta corriente</h3>' + movHtml + '</div></aside>';
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
      return '<div class="field"><label for="exp-' + k + '">' + label + '</label><input class="input input--money" id="exp-' + k + '" name="' + k + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(value) + '"></div>';
    }).join('');

    return '<div class="scrim" data-action="close-overlay"></div><form class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" data-form="expense" novalidate>' +
      '<div class="panel-head"><div><h2 id="dialog-title" class="section-title" style="margin:0">Gastos del mes · ' + esc(b.name) + '</h2>' +
      '<p class="form-note">' + (existing ? 'Editando el borrador. Se precargan los montos guardados.' : 'Se precargan los montos del último mes como referencia.') + '</p></div>' +
      '<button class="icon-btn" type="button" data-action="close-overlay" aria-label="Cerrar">' + icon('close') + '</button></div>' +
      '<div class="panel-body"><div class="expense-form"><div class="expense-fields">' +
      '<div class="field is-stacked"><label for="exp-month">Mes</label><input class="input" id="exp-month" name="month" type="month" value="' + esc(month) + '" required></div>' + fields +
      '<div class="field is-stacked"><label for="exp-note">Detalle de la cuota extraordinaria</label><input class="input" id="exp-note" name="extraordinaryNote" maxlength="140" value="' + esc(existing ? existing.extraordinaryNote : '') + '" placeholder="Ej.: pintura de fachada"></div>' +
      '<p class="form-error" data-error hidden></p></div>' +
      '<div><div class="section-title" style="margin-bottom:var(--s-2)">Prorrateo por coeficiente</div><p class="form-note" style="margin-bottom:var(--s-3)">Así queda la liquidación de cada unidad. Se calcula con el coeficiente de copropiedad.</p><div data-preview></div></div></div></div>' +
      '<div class="panel-foot"><button class="btn" type="button" data-action="close-overlay">Cancelar</button><button class="btn btn--primary" type="submit">Guardar borrador</button></div></form>';
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
      return '<tr><td class="num">' + esc(u.n) + '</td><td class="right num">' + fmt.percent(u.coef) + '</td><td class="right num">' + (u.tenant ? fmt.money(tenant) : '<span class="muted">—</span>') +
        '</td><td class="right num">' + fmt.money(owner) + '</td><td class="right num" style="font-weight:600">' + fmt.money(tenant + owner) + '</td></tr>';
    }).join('');
    const total = L.expenseTotal(exp);
    const diff = Math.round(total - totalTenant - totalOwner);
    return '<table class="ledger preview-table"><thead><tr><th>Unidad</th><th class="right">Coef.</th><th class="right">Inquilino</th><th class="right">Propietario</th><th class="right">Total</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="2">Total distribuido</td><td class="right num">' + fmt.money(totalTenant) + '</td><td class="right num">' + fmt.money(totalOwner) + '</td><td class="right num">' + fmt.money(totalTenant + totalOwner) + '</td></tr></tfoot></table>' +
      '<p class="form-note" style="margin-top:var(--s-2)">' + (Math.abs(diff) <= 1 ? 'Coincide con el total cargado (' + fmt.money(total) + ').' : '<span class="form-error">Diferencia de ' + fmt.money(diff) + ' contra el total: revisá los coeficientes.</span>') + '</p>';
  };
})(window.GC);
