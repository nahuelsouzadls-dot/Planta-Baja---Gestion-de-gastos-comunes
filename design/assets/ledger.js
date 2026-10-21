/*
 * Reglas de negocio (funciones puras). Espejan lo que hace el backend:
 *  - Prorrateo por coeficiente de copropiedad.
 *  - Inquilino paga gastos ordinarios; propietario paga fondo de reserva y
 *    extraordinarios. Si la unidad no está alquilada, el propietario paga todo.
 *  - Los pagos se validan a mano contra la cuenta del banco.
 */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const round2 = (n) => Math.round(n * 100) / 100;

  const ORDINARY = [
    ['ose', 'O.S.E. (agua)'],
    ['ute', 'U.T.E. (luz)'],
    ['cleaning', 'Limpieza'],
    ['fees', 'Honorarios de administración'],
  ];
  const OWNER_ONLY = [
    ['reserve', 'Fondo de reserva'],
    ['extraordinary', 'Cuota extraordinaria'],
  ];

  GC.CONCEPTS = ORDINARY.concat(OWNER_ONLY);
  GC.ROLE_LABEL = { owner: 'Propietario', tenant: 'Inquilino' };
  GC.STATUS_LABEL = {
    pagado: 'Al día',
    revision: 'En revisión',
    pendiente: 'Pendiente',
    moroso: 'Moroso',
    'sin-cargar': 'Sin liquidación',
  };

  const L = {};

  L.expenseTotal = function (exp) {
    return GC.CONCEPTS.reduce((sum, [key]) => sum + (Number(exp[key]) || 0), 0);
  };

  L.expenseFor = function (building, month) {
    return building.expenses.find((e) => e.month === month) || null;
  };

  /** Solo los meses emitidos generan cargos: un borrador no afecta saldos. */
  L.issuedExpenses = function (building) {
    return building.expenses.filter((e) => e.status === 'emitido');
  };

  L.issuedExpense = function (building, month) {
    const exp = L.expenseFor(building, month);
    return exp && exp.status === 'emitido' ? exp : null;
  };

  /** Conceptos que paga un rol de una unidad para un mes, ya prorrateados. */
  L.chargeLines = function (unit, role, exp) {
    if (!exp) return [];
    const coef = Number(unit.coef);
    let concepts;
    if (!unit.tenant) concepts = GC.CONCEPTS;
    else concepts = role === 'tenant' ? ORDINARY : OWNER_ONLY;
    return concepts
      .map(([key, label]) => ({ key, label, total: Number(exp[key]) || 0, amount: round2((Number(exp[key]) || 0) * coef) }))
      .filter((line) => line.total > 0);
  };

  L.charge = function (unit, role, exp) {
    return round2(L.chargeLines(unit, role, exp).reduce((s, l) => s + l.amount, 0));
  };

  L.unit = function (building, n) {
    return building.units.find((u) => u.n === n);
  };

  L.rolesOf = function (unit) {
    return unit.tenant ? ['owner', 'tenant'] : ['owner'];
  };

  /** Resumen de una cuenta (unidad + rol) a la fecha del estado. */
  L.account = function (state, building, unit, role) {
    const key = unit.n + ':' + role;
    const acc = building.accounts[key] || { paid: {}, review: null, events: [] };
    const months = L.issuedExpenses(building).map((e) => e.month).sort();
    const unpaid = months
      .map((month) => ({ month, amount: L.charge(unit, role, L.expenseFor(building, month)) }))
      .filter((m) => m.amount > 0 && !acc.paid[m.month]);
    const balance = round2(unpaid.reduce((s, m) => s + m.amount, 0));
    const overdueMonths = unpaid.filter((m) => m.month < state.currentMonth);
    const currentExp = L.issuedExpense(building, state.currentMonth);

    let status;
    if (acc.review) status = 'revision';
    else if (overdueMonths.length) status = 'moroso';
    else if (!currentExp) status = 'sin-cargar';
    else if (unpaid.length) status = 'pendiente';
    else status = 'pagado';

    const person = role === 'tenant' ? unit.tenant : unit.owner;
    return {
      key,
      unit,
      role,
      person,
      status,
      balance,
      unpaid,
      overdueMonths,
      currentCharge: L.charge(unit, role, currentExp),
      review: acc.review,
      raw: acc,
    };
  };

  L.accounts = function (state, building) {
    return building.units.flatMap((unit) => L.rolesOf(unit).map((role) => L.account(state, building, unit, role)));
  };

  /** Movimientos de la cuenta corriente, del más reciente al más antiguo. */
  L.movements = function (building, unit, role) {
    const acc = building.accounts[unit.n + ':' + role] || { paid: {}, events: [] };
    const rows = [];
    L.issuedExpenses(building).slice().sort((a, b) => a.month.localeCompare(b.month)).forEach((exp) => {
      const amount = L.charge(unit, role, exp);
      if (amount <= 0) return;
      rows.push({ date: exp.month + '-01', concept: 'Liquidación ' + GC.fmt.monthLong(exp.month), debit: amount, credit: 0 });
    });
    Object.keys(acc.paid).forEach((month) => {
      const amount = L.charge(unit, role, L.expenseFor(building, month));
      if (amount <= 0) return;
      const p = acc.paid[month];
      rows.push({ date: p.date, concept: 'Pago ' + GC.fmt.monthLong(month) + ' — transferencia Scotiabank', debit: 0, credit: amount });
    });
    (acc.events || []).forEach((ev) => rows.push({ date: ev.date, concept: ev.text, debit: 0, credit: 0, note: true }));
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1));
    let running = 0;
    const withBalance = rows.map((r) => {
      running = round2(running + r.debit - r.credit);
      return { ...r, balance: running };
    });
    return withBalance.reverse();
  };

  /** Totales del mes en curso para un edificio. */
  L.buildingSummary = function (state, building) {
    const accounts = L.accounts(state, building);
    const exp = L.issuedExpense(building, state.currentMonth);
    const counts = { pagado: 0, revision: 0, pendiente: 0, moroso: 0, 'sin-cargar': 0 };
    let expected = 0;
    let collected = 0;
    let inReview = 0;
    let debt = 0;
    accounts.forEach((a) => {
      counts[a.status] += 1;
      expected += a.currentCharge;
      if (a.raw.paid[state.currentMonth]) collected += a.currentCharge;
      if (a.review) inReview += a.balance;
      debt += a.overdueMonths.reduce((s, m) => s + m.amount, 0);
    });
    const reserveCollected = L.issuedExpenses(building)
      .reduce((s, e) => s + (Number(e.reserve) || 0), 0);
    return {
      accounts,
      counts,
      total: accounts.length,
      expense: exp,
      draft: Boolean(!exp && L.expenseFor(building, state.currentMonth)),
      expenseTotal: exp ? L.expenseTotal(exp) : 0,
      expected: round2(expected),
      collected: round2(collected),
      inReview: round2(inReview),
      debt: round2(debt),
      reserveFund: building.reserveOpening + reserveCollected,
      openThreads: building.threads.filter((t) => t.status !== 'resuelto').length,
    };
  };

  /** Segmentos para la barra de cobranza (proporción de cuentas por estado). */
  L.segments = function (counts, total) {
    return ['pagado', 'revision', 'pendiente', 'moroso', 'sin-cargar']
      .filter((k) => counts[k] > 0)
      .map((k) => ({ key: k, pct: (counts[k] / Math.max(total, 1)) * 100, count: counts[k] }));
  };

  L.coefficientSum = function (building) {
    return building.units.reduce((s, u) => s + Number(u.coef), 0);
  };

  // ── Actualizaciones inmutables del estado ──────────────────────────────

  function mapBuilding(state, buildingId, fn) {
    return { ...state, buildings: state.buildings.map((b) => (b.id === buildingId ? fn(b) : b)) };
  }

  function mapAccount(building, key, fn) {
    const current = building.accounts[key] || { paid: {}, review: null, events: [] };
    return { ...building, accounts: { ...building.accounts, [key]: fn(current) } };
  }

  L.validatePayment = function (state, buildingId, key) {
    return mapBuilding(state, buildingId, (b) => {
      const [n, role] = key.split(':');
      const summary = L.account(state, b, L.unit(b, n), role);
      return mapAccount(b, key, (acc) => {
        const paid = { ...acc.paid };
        summary.unpaid.forEach((m) => {
          paid[m.month] = { date: state.today, receipt: acc.review ? acc.review.file : 'validado' };
        });
        return { ...acc, paid, review: null };
      });
    });
  };

  L.rejectPayment = function (state, buildingId, key, reason) {
    return mapBuilding(state, buildingId, (b) => mapAccount(b, key, (acc) => ({
      ...acc,
      review: null,
      events: (acc.events || []).concat({
        date: state.today,
        text: 'Comprobante rechazado' + (reason ? ' — ' + reason : '') + (acc.review ? ' (' + acc.review.file + ')' : ''),
      }),
    })));
  };

  L.uploadReceipt = function (state, buildingId, key, fileName) {
    return mapBuilding(state, buildingId, (b) => mapAccount(b, key, (acc) => ({
      ...acc,
      review: { file: fileName, uploadedAt: state.today },
    })));
  };

  L.saveExpense = function (state, buildingId, exp) {
    return mapBuilding(state, buildingId, (b) => {
      const others = b.expenses.filter((e) => e.month !== exp.month);
      return { ...b, expenses: others.concat(exp).sort((x, y) => x.month.localeCompare(y.month)) };
    });
  };

  L.issueExpense = function (state, buildingId, month) {
    return mapBuilding(state, buildingId, (b) => ({
      ...b,
      expenses: b.expenses.map((e) => (e.month === month ? { ...e, status: 'emitido' } : e)),
    }));
  };

  L.addNotice = function (state, buildingId, title, body) {
    return mapBuilding(state, buildingId, (b) => ({
      ...b,
      notices: [{ id: GC.uid('n'), date: state.today, title, body }].concat(b.notices),
    }));
  };

  L.addThread = function (state, buildingId, thread) {
    return mapBuilding(state, buildingId, (b) => ({ ...b, threads: [thread].concat(b.threads) }));
  };

  L.reply = function (state, buildingId, threadId, message) {
    return mapBuilding(state, buildingId, (b) => ({
      ...b,
      threads: b.threads.map((t) => (t.id === threadId ? { ...t, messages: t.messages.concat(message) } : t)),
    }));
  };

  L.setThreadStatus = function (state, buildingId, threadId, status) {
    return mapBuilding(state, buildingId, (b) => ({
      ...b,
      threads: b.threads.map((t) => (t.id === threadId ? { ...t, status } : t)),
    }));
  };

  GC.ledger = L;
})(window.GC);
