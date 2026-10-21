/* Portal de residentes: estado de cuenta, liquidación, comprobante, avisos y reclamos. */
(function (GC) {
  'use strict';

  const L = GC.ledger;
  const store = GC.store;
  const esc = GC.esc;
  const fmt = GC.fmt;
  const icon = GC.icon;

  const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
  const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
  const DEFAULT_ACCOUNT = { buildingId: 'minas', key: '102:tenant' };

  const root = document.querySelector('[data-portal]');

  /** Cuenta a mostrar: viene de ?b=…&u=… (link desde el admin) y se valida contra los datos. */
  function resolveAccount() {
    const params = new URLSearchParams(location.search);
    const state = store.get();
    const buildingId = params.get('b');
    const key = params.get('u');
    const b = state.buildings.find((x) => x.id === buildingId);
    if (b && key && /^\d{1,4}:(owner|tenant)$/.test(key)) {
      const unit = L.unit(b, key.split(':')[0]);
      if (unit && (key.endsWith(':owner') || unit.tenant)) return { buildingId, key };
    }
    return DEFAULT_ACCOUNT;
  }

  const who = resolveAccount();
  let view = { tab: 'liquidacion', month: null, error: '' };

  function context() {
    const state = store.get();
    const b = state.buildings.find((x) => x.id === who.buildingId);
    const [n, role] = who.key.split(':');
    const unit = L.unit(b, n);
    return { state, b, unit, role, account: L.account(state, b, unit, role) };
  }

  // ── Vistas ─────────────────────────────────────────────────────────────
  function dueCard(ctx) {
    const { state, b, account: a } = ctx;
    const dueDate = state.dueDay + ' de ' + fmt.monthLong(state.currentMonth).split(' ')[0];
    const copy = {
      pagado: ['Estás al día', fmt.money(0), 'No tenés pagos pendientes. Gracias.'],
      revision: ['Recibimos tu comprobante', fmt.money(a.balance, true), 'La administración lo está verificando con el banco. Te avisamos cuando quede registrado.'],
      pendiente: ['Tenés para pagar', fmt.money(a.balance, true), 'Liquidación de ' + fmt.monthLong(state.currentMonth) + '. Vencimiento: ' + dueDate + '.'],
      moroso: ['Tenés ' + a.unpaid.length + (a.unpaid.length === 1 ? ' mes' : ' meses') + ' sin pagar', fmt.money(a.balance, true), 'Adeudás ' + a.unpaid.map((m) => fmt.monthLong(m.month)).join(', ') + '. Si ya pagaste, subí el comprobante.'],
      'sin-cargar': ['Todavía no hay liquidación', fmt.money(a.balance, true), 'La administración aún no publicó la liquidación de ' + fmt.monthLong(state.currentMonth) + '.'],
    }[a.status];

    const canUpload = a.balance > 0 && a.status !== 'revision';
    const steps = canUpload
      ? '<div class="steps"><div class="step"><span class="step__n">1</span><div><div class="step__title">Transferí el monto</div><p>' + esc(b.bank) + '<br>En el concepto poné: <strong>Apto ' + esc(ctx.unit.n) + '</strong>.</p></div></div>' +
        '<div class="step"><span class="step__n">2</span><div><div class="step__title">Subí el comprobante</div><p>Una foto o el PDF del banco. Lo revisamos en el día.</p>' +
        '<label class="upload"><span class="visually-hidden">Elegir comprobante</span><input type="file" accept="image/*,application/pdf" data-action="upload"><span class="btn btn--primary btn--lg">' + icon('upload') + 'Subir comprobante</span></label>' +
        (view.error ? '<p class="form-error" role="alert" style="margin-top:8px">' + esc(view.error) + '</p>' : '') + '</div></div></div>'
      : (a.review ? '<div class="receipt" style="margin-top:var(--s-6)">' + icon('file') + '<div><strong>' + esc(a.review.file) + '</strong><div class="muted" style="font-size:var(--text-sm)">Subido el ' + esc(fmt.date(a.review.uploadedAt)) + '</div></div></div>' : '');

    return '<section class="due due--' + a.status + '" aria-live="polite"><div class="due__label">' + esc(copy[0]) + '</div><div class="due__amount">' + copy[1] + '</div>' +
      '<p class="due__sub">' + esc(copy[2]) + '</p>' + steps + '</section>';
  }

  function liquidacion(ctx) {
    const { b, unit, role } = ctx;
    const months = L.issuedExpenses(b).map((e) => e.month).sort().reverse();
    if (!months.length) return '<div class="card"><div class="empty">Todavía no hay liquidaciones publicadas.</div></div>';
    const month = view.month && months.includes(view.month) ? view.month : months[0];
    const acc = b.accounts[unit.n + ':' + role] || { paid: {} };

    const pills = months.map((m) => {
      const charge = L.charge(unit, role, L.expenseFor(b, m));
      const paid = acc.paid[m] || charge === 0;
      return '<button class="month" data-action="month" data-month="' + esc(m) + '" aria-pressed="' + (m === month) + '"><span class="month__name">' + esc(fmt.monthTitle(m)) + '</span>' +
        GC.views.status(paid ? 'pagado' : (m < ctx.state.currentMonth ? 'moroso' : 'pendiente'), paid ? 'Pagado' : 'Sin pagar') + '</button>';
    }).join('');

    const exp = L.expenseFor(b, month);
    const lines = L.chargeLines(unit, role, exp);
    const total = L.charge(unit, role, exp);
    const table = '<table class="ledger"><thead><tr><th>Concepto</th><th class="right">Total del edificio</th><th class="right">Te corresponde</th></tr></thead><tbody>' +
      lines.map((l) => '<tr><td>' + esc(l.label) + (l.key === 'extraordinary' && exp.extraordinaryNote ? '<small>' + esc(exp.extraordinaryNote) + '</small>' : '') + '</td><td class="right num muted">' + fmt.money(l.total) + '</td><td class="right num">' + fmt.money(l.amount, true) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total ' + esc(fmt.monthLong(month)) + '</td><td></td><td class="right num">' + fmt.money(total, true) + '</td></tr></tfoot></table>';

    const movements = L.movements(b, unit, role).slice(0, 8);
    const history = '<table class="ledger"><thead><tr><th>Fecha</th><th>Movimiento</th><th class="right">Importe</th><th class="right">Saldo</th></tr></thead><tbody>' +
      movements.map((m) => '<tr><td class="num" style="white-space:nowrap">' + esc(fmt.dateShort(m.date)) + '</td><td>' + esc(m.concept) + '</td><td class="right num' + (m.credit ? ' credit' : '') + '">' +
        (m.debit ? fmt.money(m.debit) : m.credit ? '− ' + fmt.money(m.credit) : '') + '</td><td class="right num">' + fmt.money(m.balance) + '</td></tr>').join('') + '</tbody></table>';

    const person = role === 'tenant' ? unit.tenant : unit.owner;
    return '<section class="card" aria-labelledby="liq-title"><div class="card__head"><div><h2 class="card__title" id="liq-title">Liquidación de ' + esc(fmt.monthLong(month)) + '</h2>' +
      '<div class="muted" style="font-size:var(--text-sm)">Tu coeficiente: ' + fmt.percent(unit.coef) + ' · ' + esc(GC.ROLE_LABEL[role]) + '</div></div>' +
      '<button class="btn no-print" data-action="print">' + icon('printer') + 'Imprimir o guardar PDF</button></div>' +
      '<div class="print-only card__body"><strong>' + esc(ctx.state.company.name) + '</strong> · ' + esc(b.name) + ', ' + esc(b.address) + '<br>' + esc(person.name) + ' · Apto ' + esc(unit.n) + ' · ' + esc(GC.ROLE_LABEL[role]) + '</div>' +
      '<div class="months" role="group" aria-label="Elegir mes">' + pills + '</div>' + table + '</section>' +
      '<section class="card no-print" aria-labelledby="hist-title"><div class="card__head"><h2 class="card__title" id="hist-title">Tu cuenta corriente</h2></div>' + history + '</section>';
  }

  function avisos(ctx) {
    const list = ctx.b.notices.length
      ? ctx.b.notices.map((n) => '<article class="notice"><div class="notice__title"><span>' + esc(n.title) + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('')
      : '<div class="empty">No hay avisos.</div>';
    return '<section class="card">' + list + '</section>';
  }

  const THREAD_STATUS = { pendiente: ['pendiente', 'Recibido'], 'en-proceso': ['revision', 'En proceso'], resuelto: ['pagado', 'Resuelto'] };

  function reclamos(ctx) {
    const mine = ctx.b.threads.filter((t) => t.unit === ctx.unit.n);
    const list = mine.map((t) => '<article class="claim"><div class="claim__head"><span>' + esc(t.title) + '<br><span class="muted" style="font-size:var(--text-sm);font-weight:400">' + (t.kind === 'reclamo' ? 'Reclamo' : 'Reporte') + ' · ' + esc(fmt.date(t.date)) + '</span></span>' +
      GC.views.status(THREAD_STATUS[t.status][0], THREAD_STATUS[t.status][1]) + '</div><div class="thread">' +
      t.messages.map((m) => '<div class="msg' + (m.from === 'resident' ? ' msg--mine' : '') + '"><div class="msg__who">' + esc(m.name) + '<time>' + esc(fmt.dateShort(m.date)) + '</time></div>' + esc(m.text) + '</div>').join('') +
      '</div><form class="composer" data-form="reply" data-id="' + esc(t.id) + '"><label class="visually-hidden" for="r-' + esc(t.id) + '">Responder</label><input class="input" id="r-' + esc(t.id) + '" name="text" placeholder="Escribir…" maxlength="1000" autocomplete="off"><button class="btn btn--primary" type="submit">Enviar</button></form></article>').join('');

    return '<section class="card"><div class="card__head"><h2 class="card__title">Avisar un problema a la administración</h2></div><form class="card__body claim-form" data-form="claim" novalidate>' +
      '<div class="field"><label for="claim-kind">Tipo</label><select class="select" id="claim-kind" name="kind"><option value="reporte">Algo se rompió o no funciona</option><option value="reclamo">Reclamo a la administración</option></select></div>' +
      '<div class="field"><label for="claim-title">¿Qué pasa?</label><input class="input" id="claim-title" name="title" maxlength="120" placeholder="Ej.: no anda el portero eléctrico"></div>' +
      '<div class="field"><label for="claim-body">Contanos más (opcional)</label><textarea class="textarea" id="claim-body" name="body" rows="3" maxlength="1000"></textarea></div>' +
      '<p class="form-error" data-error hidden></p><div><button class="btn btn--primary btn--lg" type="submit">Enviar a la administración</button></div></form>' + list + '</section>';
  }

  function render() {
    const ctx = context();
    const person = ctx.role === 'tenant' ? ctx.unit.tenant : ctx.unit.owner;
    const first = person.name.split(' ')[0];
    const ownThreads = ctx.b.threads.filter((t) => t.unit === ctx.unit.n && t.status !== 'resuelto').length;
    const tabs = [['liquidacion', 'Mi liquidación', 0], ['avisos', 'Avisos', ctx.b.notices.length], ['reclamos', 'Problemas y reclamos', ownThreads]];
    const body = { liquidacion, avisos, reclamos }[view.tab](ctx);

    document.title = 'Mi cuenta · ' + ctx.b.name;
    root.innerHTML = '<header class="portal-top"><div class="brand" style="padding:0"><div class="brand__mark">C</div><div><div class="brand__name">' + esc(ctx.b.name) + '</div>' +
      '<div class="brand__sub">Administra ' + esc(ctx.state.company.name) + '</div></div></div><a href="admin.html">Panel de administración</a></header>' +
      '<main class="portal-main"><div class="hello"><h1>Hola, ' + esc(first) + '</h1><p>Apartamento ' + esc(ctx.unit.n) + ' · ' + esc(GC.ROLE_LABEL[ctx.role]) + (ctx.unit.tenant ? (ctx.role === 'tenant' ? ' · pagás los gastos comunes' : ' · pagás fondo de reserva y extraordinarios') : '') + '</p></div>' +
      dueCard(ctx) +
      '<div class="tabs" role="tablist">' + tabs.map(([id, label, n]) => '<button class="tab" role="tab" data-action="tab" data-tab="' + id + '" aria-selected="' + (view.tab === id) + '">' + label + (n ? '<span class="count">' + n + '</span>' : '') + '</button>').join('') + '</div>' +
      body + '<p class="portal-foot">¿Dudas? Escribinos a ' + esc(ctx.state.company.email) + '. También podés pedir la liquidación en papel.</p></main>';
  }

  // ── Acciones ───────────────────────────────────────────────────────────
  function handleUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!RECEIPT_TYPES.includes(file.type) && !/\.(jpe?g|png|heic|webp|pdf)$/i.test(file.name)) {
      view = { ...view, error: 'Ese archivo no es una foto ni un PDF. Probá de nuevo.' };
      return render();
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      view = { ...view, error: 'El archivo pesa más de 10 MB. Probá con una foto más chica.' };
      return render();
    }
    const name = file.name.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_').slice(0, 80);
    view = { ...view, error: '' };
    store.update((s) => L.uploadReceipt(s, who.buildingId, who.key, name));
    GC.toast('Comprobante enviado. Te avisamos cuando esté validado.');
  }

  const forms = {
    claim(form) {
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const body = String(data.get('body') || '').trim();
      const kind = data.get('kind') === 'reclamo' ? 'reclamo' : 'reporte';
      const errorEl = form.querySelector('[data-error]');
      if (title.length < 4) {
        errorEl.textContent = 'Contanos en pocas palabras qué pasa.';
        errorEl.hidden = false;
        return;
      }
      const ctx = context();
      const person = ctx.role === 'tenant' ? ctx.unit.tenant : ctx.unit.owner;
      const thread = {
        id: GC.uid('t'), kind, unit: ctx.unit.n, author: person.name, title, status: 'pendiente', date: ctx.state.today,
        messages: [{ from: 'resident', name: person.name, date: ctx.state.today, text: body || title }],
      };
      store.update((s) => L.addThread(s, who.buildingId, thread));
      GC.toast('Enviado. La administración te va a responder acá.');
    },
    reply(form) {
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) return;
      const ctx = context();
      const person = ctx.role === 'tenant' ? ctx.unit.tenant : ctx.unit.owner;
      store.update((s) => L.reply(s, who.buildingId, form.dataset.id, { from: 'resident', name: person.name, date: ctx.state.today, text }));
    },
  };

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    if (el.dataset.action === 'tab') view = { ...view, tab: el.dataset.tab, error: '' };
    else if (el.dataset.action === 'month') view = { ...view, month: el.dataset.month };
    else if (el.dataset.action === 'print') return window.print();
    else return;
    render();
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-action="upload"]')) handleUpload(event.target);
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    forms[form.dataset.form](form);
  });

  store.subscribe(render);
  render();
})(window.GC);
