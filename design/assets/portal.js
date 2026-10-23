/* Portal de residentes: estado de cuenta, liquidación, comprobantes, avisos y reclamos.
 * El markup sigue el prototipo de design/ref (gc-portal.html): mismas clases y estructura. */
(function (GC) {
  'use strict';

  const L = GC.ledger;
  const store = GC.store;
  const esc = GC.esc;
  const fmt = GC.fmt;

  const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
  const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
  const DEFAULT_ACCOUNT = { buildingId: 'minas', key: '101:owner' };
  const YEARS_BACK = 5;
  const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const THEMES = [['lagoon', 'Lagoon', '#0e4a5e', '#12909f'], ['noche', 'Azul noche', '#14233d', '#2a86bd'], ['berenjena', 'Berenjena', '#3b1f45', '#1f9e80'], ['bosque', 'Bosque', '#1d3b2f', '#b88a3a'], ['grafito', 'Grafito', '#25282e', '#d9604f']];
  const THREAD_STATUS = { pendiente: ['st-pendiente', 'Recibido'], 'en-proceso': ['st-revision', 'En proceso'], resuelto: ['st-pagado', 'Resuelto'] };
  const RECEIPT_STATUS = { ok: ['st-pagado', 'Aprobado'], rev: ['st-revision', 'En revisión'], bad: ['st-moroso', 'Rechazado'] };

  const svg = (size, sw, d) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    building: svg(18, 1.8, '<path d="M5 21V4h9v17M14 9h5v12M3 21h18M8.5 8h2M8.5 12h2M8.5 16h2"/>'),
    palette: svg(18, 1.7, '<path d="M12 4a8 8 0 1 0 0 16c1.4 0 2-1 1.6-2-.5-1.2.2-2.5 1.6-2.5H17a3 3 0 0 0 3-3A8 8 0 0 0 12 4z"/><circle cx="8" cy="11" r=".8"/><circle cx="12" cy="8" r=".8"/><circle cx="16" cy="11" r=".8"/>'),
    upload: svg(18, 2, '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>'),
    prev: svg(16, 2, '<path d="m15 6-6 6 6 6"/>'),
    next: svg(16, 2, '<path d="m9 6 6 6-6 6"/>'),
    prevSm: svg(14, 2, '<path d="m15 6-6 6 6 6"/>'),
    nextSm: svg(14, 2, '<path d="m9 6 6 6-6 6"/>'),
    down: svg(14, 2, '<path d="m6 9 6 6 6-6"/>'),
    chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  };

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

  function storedTheme() {
    try { return localStorage.getItem('gc-theme') || 'lagoon'; } catch (err) { return 'lagoon'; }
  }

  const who = resolveAccount();
  let view = {
    tab: 'liquidacion', month: null, monthOpen: false, year: null, themeOpen: false, theme: storedTheme(),
    movs: false, kind: 'reporte', thread: null, receipt: null, copied: null, approved: false, error: '',
  };

  function context() {
    const state = store.get();
    const b = state.buildings.find((x) => x.id === who.buildingId);
    const [n, role] = who.key.split(':');
    const unit = L.unit(b, n);
    const acc = b.accounts[who.key] || { paid: {}, review: null, events: [] };
    return { state, b, unit, role, acc, person: role === 'tenant' ? unit.tenant : unit.owner, account: L.account(state, b, unit, role) };
  }

  const ymKey = (y, m) => y + '-' + String(m + 1).padStart(2, '0');

  /** Punto de estado de un mes: ok (pagado), warn (pendiente), bad (vencido). */
  function monthDot(ctx, month) {
    const charge = L.charge(ctx.unit, ctx.role, L.expenseFor(ctx.b, month));
    if (charge === 0 || ctx.acc.paid[month]) return ['ok', 'Pagado'];
    return [month < ctx.state.currentMonth ? 'bad' : 'warn', 'Sin pagar'];
  }

  // ── Vistas ─────────────────────────────────────────────────────────────
  function themeMenu() {
    if (!view.themeOpen) return '';
    return '<div class="thmp" role="menu"><div class="thmh">Tema de color</div>' +
      THEMES.map(([id, label, c1, c2]) => '<button type="button" class="thmo' + (view.theme === id ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (view.theme === id) + '" data-action="theme" data-theme-id="' + id + '">' +
        '<span class="thmv"><i style="background:' + c1 + '"></i><i class="l"><b style="background:' + c2 + '"></b></i></span><span>' + label + '</span></button>').join('') + '</div>';
  }

  function dueCard(ctx) {
    const { state, account: a } = ctx;
    const monthWord = fmt.monthLong(state.currentMonth).split(' ')[0];
    const copy = {
      pagado: ['Estás al día', fmt.money(0), 'No tenés pagos pendientes. Gracias.'],
      revision: ['Recibimos tu comprobante', fmt.money(a.balance, true), 'La administración lo está verificando con el banco. Te avisamos cuando quede registrado.'],
      pendiente: ['Tenés para pagar', fmt.money(a.balance, true), 'Liquidación de ' + fmt.monthLong(state.currentMonth) + '. Vencimiento: ' + state.dueDay + ' de ' + monthWord + '.'],
      moroso: ['Tenés ' + a.unpaid.length + (a.unpaid.length === 1 ? ' mes' : ' meses') + ' sin pagar', fmt.money(a.balance, true), 'Adeudás ' + a.unpaid.map((m) => fmt.monthLong(m.month)).join(', ') + '. Si ya pagaste, subí el comprobante.'],
      'sin-cargar': ['Todavía no hay liquidación', fmt.money(a.balance, true), 'La administración aún no publicó la liquidación de ' + fmt.monthLong(state.currentMonth) + '.'],
    }[a.status];

    const canPay = a.balance > 0 && a.status !== 'revision';
    const bank = [['Banco', 'Scotiabank'], ['Cuenta corriente (pesos)', ctx.b.bankAccount || '0012 3456 789'], ['Titular', state.company.name], ['Concepto', 'Apto ' + ctx.unit.n]];
    const bankBlock = canPay
      ? '<div class="bank"><p class="bh">Datos para transferir</p>' + bank.map(([label, value], i) =>
        '<div class="brw"><span><small>' + esc(label) + '</small><b>' + esc(value) + '</b></span><button type="button" class="cp" data-action="copy" data-i="' + i + '" data-value="' + esc(value) + '">' + (view.copied === i ? 'Copiado' : 'Copiar') + '</button></div>').join('') + '</div>'
      : '';

    let bottom = '';
    if (canPay) {
      bottom = '<div class="dbot"><label class="big">' + ICON.upload + 'Subir comprobante<input class="vh" type="file" accept="image/*,application/pdf" data-action="upload"></label>' +
        '<p class="uph">Después de transferir, subí la foto o el PDF del banco. Lo revisamos en el día.</p>' +
        (view.error ? '<p class="ferr" role="alert">' + esc(view.error) + '</p>' : '') + '</div>';
    } else if (a.status === 'revision') {
      bottom = '<div class="dbot card"><p class="ok"><span class="pill st-revision">En revisión</span><span>' + esc(a.review.file) + ' · subido el ' + esc(fmt.dateShort(a.review.uploadedAt)) + '</span></p>' +
        '<p class="sim"><button type="button" class="lk" data-action="simulate">Simular aprobación de la administración</button></p></div>';
    } else if (a.status === 'pagado') {
      bottom = '<div class="dbot card"><p class="ok"><span class="pill st-pagado">Al día</span><span>Gracias por pagar a tiempo.</span></p>' +
        (view.approved ? '<p class="sim"><button type="button" class="lk" data-action="reset-demo">Reiniciar la demo</button></p>' : '') + '</div>';
    }

    return '<section class="due' + (a.status === 'pagado' ? ' due-ok' : '') + '" aria-live="polite"><div class="pay"><div class="dtop"><span class="glass"></span>' +
      '<p class="dl">' + esc(copy[0]) + '</p><p class="da">' + copy[1] + '</p><p class="ds">' + esc(copy[2]) + '</p></div>' + bankBlock + '</div>' + bottom + '</section>';
  }

  function monthSelector(ctx, months, month) {
    const [dot] = monthDot(ctx, month);
    const curYear = Number(ctx.state.currentMonth.slice(0, 4));
    const year = view.year || Number(month.slice(0, 4));
    let list = '';
    if (view.monthOpen) {
      const cells = MONTHS_SHORT.map((label, i) => {
        const k = ymKey(year, i);
        const has = months.includes(k);
        const d = has ? monthDot(ctx, k)[0] : 'none';
        return '<button type="button" role="option" class="mcell' + (k === month ? ' on' : '') + (has ? '' : ' dis') + '" aria-selected="' + (k === month) + '" aria-disabled="' + !has + '"' +
          (has ? ' data-action="month" data-month="' + k + '"' : '') + '><span class="dot ' + d + '"></span>' + label + '</button>';
      }).join('');
      list = '<div class="mlist" role="listbox"><div class="ymh">' +
        '<button type="button" class="arw sm" aria-label="Año anterior" data-action="year" data-dir="-1"' + (year <= curYear - YEARS_BACK ? ' disabled' : '') + '>' + ICON.prevSm + '</button><b>' + year + '</b>' +
        '<button type="button" class="arw sm" aria-label="Año siguiente" data-action="year" data-dir="1"' + (year >= curYear ? ' disabled' : '') + '>' + ICON.nextSm + '</button></div>' +
        '<div class="ygrid">' + cells + '</div><p class="lgd"><span class="dot ok"></span>Pagado <span class="dot warn"></span>Pendiente <span class="dot bad"></span>Vencido</p></div>';
    }
    const i = months.indexOf(month);
    return '<div class="msel">' +
      '<button type="button" class="arw" aria-label="Mes anterior" data-action="month-step" data-dir="-1"' + (i >= months.length - 1 ? ' disabled' : '') + '>' + ICON.prev + '</button>' +
      '<div class="mdd"><button type="button" class="mcur" aria-haspopup="listbox" aria-expanded="' + view.monthOpen + '" data-action="month-toggle"><span class="dot ' + dot + '"></span><b>' + esc(fmt.monthTitle(month)) + '</b>' + ICON.down + '</button>' + list + '</div>' +
      '<button type="button" class="arw" aria-label="Mes siguiente" data-action="month-step" data-dir="1"' + (i <= 0 ? ' disabled' : '') + '>' + ICON.next + '</button></div>';
  }

  function liquidacion(ctx) {
    const { b, unit, role } = ctx;
    const months = L.issuedExpenses(b).map((e) => e.month).sort().reverse();
    if (!months.length) return '<div class="sec"><p class="empty">Todavía no hay liquidaciones publicadas.</p></div>';
    const month = view.month && months.includes(view.month) ? view.month : months[0];
    const exp = L.expenseFor(b, month);
    const lines = L.chargeLines(unit, role, exp);
    const total = L.charge(unit, role, exp);

    const rows = lines.map((l) => '<div class="ln"><span>' + esc(l.label) + '<small>' + esc(l.key === 'extraordinary' && exp.extraordinaryNote ? exp.extraordinaryNote : 'Total del edificio ' + fmt.money(l.total)) + '</small></span><span class="mono">' + fmt.money(l.amount, true) + '</span></div>').join('');

    const moves = view.movs
      ? '<div><h2 class="h2" style="margin-bottom:8px">Tus movimientos</h2>' + L.movements(b, unit, role).filter((m) => !m.note).slice(0, 6).map((m) =>
        '<div class="mv"><span class="mono" style="text-align:left;color:#596269">' + esc(fmt.dateShort(m.date)) + '</span><span>' + esc(m.concept) + '</span><span class="mono' + (m.credit ? ' cr' : '') + '">' + (m.debit ? fmt.money(m.debit) : '− ' + fmt.money(m.credit)) + '</span></div>').join('') + '</div>'
      : '';

    return '<div class="sec"><div><h2 class="h2">Liquidación de ' + esc(fmt.monthLong(month)) + '</h2><p class="sub">Tu coeficiente: ' + fmt.percent(unit.coef) + ' · ' + esc(GC.ROLE_LABEL[role]) + '</p></div>' +
      '<p class="print-only"><strong>' + esc(ctx.state.company.name) + '</strong> · ' + esc(b.name) + ', ' + esc(b.address) + '<br>' + esc(ctx.person.name) + ' · Apto ' + esc(unit.n) + ' · ' + esc(GC.ROLE_LABEL[role]) + '</p>' +
      monthSelector(ctx, months, month) +
      '<div>' + rows + '<div class="ln tot"><span>Total ' + esc(fmt.monthLong(month)) + '</span><span class="mono">' + fmt.money(total, true) + '</span></div></div>' +
      '<div class="acts"><button type="button" class="btn" data-action="print">Imprimir o guardar PDF</button><button type="button" class="btn" data-action="building-pdf">Descargar liquidación del edificio</button>' +
      '<button type="button" class="btn" data-action="movs">' + (view.movs ? 'Ocultar mis movimientos' : 'Ver mis movimientos') + '</button></div>' + moves + '</div>';
  }

  /** Comprobantes: pagos validados, el que está en revisión y los rechazados (eventos del ledger). */
  function receipts(ctx) {
    const { b, unit, role, acc } = ctx;
    const list = Object.keys(acc.paid).map((month) => ({ month, amount: L.charge(unit, role, L.expenseFor(b, month)), date: acc.paid[month].date, st: 'ok', file: acc.paid[month].receipt }))
      .filter((r) => r.amount > 0);
    if (acc.review) list.push({ month: (ctx.account.unpaid[0] || { month: ctx.state.currentMonth }).month, amount: ctx.account.balance, date: acc.review.uploadedAt, st: 'rev', file: acc.review.file });
    (acc.events || []).filter((ev) => ev.text.startsWith('Comprobante rechazado')).forEach((ev) => {
      const reason = (ev.text.match(/— ([^(]+)/) || [])[1];
      const file = (ev.text.match(/\(([^)]+)\)$/) || [])[1] || '';
      list.push({ month: ev.date.slice(0, 7), amount: ctx.account.balance, date: ev.date, st: 'bad', file, reason: reason ? reason.trim() : 'no pudimos verificar la transferencia.' });
    });
    return list.sort((x, y) => y.date.localeCompare(x.date));
  }

  function comprobantes(ctx) {
    const list = receipts(ctx);
    const rows = list.length ? list.map((r, i) => '<div class="rwb"><button type="button" class="rw" data-action="receipt" data-i="' + i + '"><span class="grow"><b>Pago de ' + esc(fmt.monthLong(r.month)) + '</b><small>' + fmt.money(r.amount, true) + ' · subido el ' + esc(fmt.dateShort(r.date)) + '</small></span>' +
      '<span class="pill ' + RECEIPT_STATUS[r.st][0] + '">' + RECEIPT_STATUS[r.st][1] + '</span>' + ICON.chev + '</button>' +
      (r.st === 'bad' ? '<p class="rej">Motivo: ' + esc(r.reason) + ' <button type="button" class="lk" data-action="tab" data-tab="liquidacion">Subir uno nuevo</button></p>' : '') + '</div>').join('')
      : '<p class="empty">Todavía no subiste comprobantes.</p>';
    return '<div class="sec"><div><h2 class="h2">Mis comprobantes</h2><p class="sub">Todo lo que subiste y cómo quedó.</p></div><div>' + rows + '</div></div>';
  }

  function receiptDialog(ctx) {
    const r = view.receipt;
    if (!r) return '';
    return '<div class="rvo"><button type="button" class="rvbk" aria-label="Cerrar" data-action="receipt-close"></button><div class="rvc" role="dialog" aria-label="Comprobante">' +
      '<div class="rvh"><b>Comprobante</b><button type="button" class="lk" data-action="receipt-close">Cerrar</button></div>' +
      '<div class="rvpaper"><p class="rvb1">Banco Demo</p><p class="rvt">Transferencia realizada</p><p class="rvm">' + fmt.money(r.amount, true) + '</p>' +
      '<div class="rvr"><span>Fecha</span><b>' + esc(fmt.date(r.date)) + '</b></div><div class="rvr"><span>Destino</span><b>' + esc(ctx.state.company.name) + '</b></div>' +
      '<div class="rvr"><span>Concepto</span><b>Apto ' + esc(ctx.unit.n) + '</b></div><div class="rvr"><span>Operación</span><b>' + (700000 + Math.round(r.amount) % 99999) + '</b></div></div>' +
      '<p class="sub" style="margin-top:10px">' + esc(r.file) + '</p></div></div>';
  }

  function avisos(ctx) {
    if (!ctx.b.notices.length) return '<p class="empty">No hay avisos.</p>';
    const recent = (iso) => (Date.parse(ctx.state.today) - Date.parse(iso)) / 86400000 <= 7;
    return '<div>' + ctx.b.notices.map((n) => '<article class="notice"><div class="nt"><span>' + esc(n.title) + (recent(n.date) ? '<span class="new">Nuevo</span>' : '') + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('') + '</div>';
  }

  function reclamos(ctx) {
    const mine = ctx.b.threads.filter((t) => t.unit === ctx.unit.n);
    const open = view.thread && mine.find((t) => t.id === view.thread);
    if (open) {
      const st = THREAD_STATUS[open.status];
      return '<div class="sec"><button type="button" class="lk back" data-action="thread-close">← Volver a mis reclamos</button>' +
        '<div class="thh"><div><h2 class="h2">' + esc(open.title) + '</h2><p class="sub">' + (open.kind === 'reclamo' ? 'Reclamo' : 'Reporte') + ' · ' + esc(fmt.date(open.date)) + '</p></div><span class="pill ' + st[0] + '">' + st[1] + '</span></div>' +
        '<div class="thread">' + open.messages.map((m) => '<div class="msg' + (m.from === 'resident' ? ' me' : '') + '"><small>' + esc(m.name) + ' · ' + esc(fmt.dateShort(m.date)) + '</small>' + esc(m.text) + '</div>').join('') + '</div>' +
        (open.status !== 'resuelto'
          ? '<form class="sec" style="gap:12px" data-form="reply" data-id="' + esc(open.id) + '"><div class="fld"><label for="c-reply">Tu respuesta</label><textarea class="inp ta" id="c-reply" name="text" rows="3" maxlength="1000" placeholder="Escribí un mensaje a la administración"></textarea></div>' +
            '<div class="racts"><button type="submit" class="big" style="margin:0">Enviar mensaje</button><button type="button" class="lk" data-action="sim-admin">Simular respuesta de la administración</button></div></form>'
          : '<p class="sub">Este reclamo está resuelto. Si el problema sigue, abrí uno nuevo.</p>') + '</div>';
    }

    const list = mine.length
      ? '<div><h2 class="h2" style="margin-bottom:6px">Tus reclamos</h2>' + mine.map((t) => {
        const st = THREAD_STATUS[t.status];
        return '<button type="button" class="rw" data-action="thread" data-id="' + esc(t.id) + '"><span class="grow"><b>' + esc(t.title) + '</b><small>' + (t.kind === 'reclamo' ? 'Reclamo' : 'Reporte') + ' · ' + esc(fmt.date(t.date)) + ' · ' + t.messages.length + ' mensajes</small></span><span class="pill ' + st[0] + '">' + st[1] + '</span>' + ICON.chev + '</button>';
      }).join('') + '</div>'
      : '';
    return '<form class="sec" data-form="claim" novalidate>' + list +
      '<div><h2 class="h2">Avisar un problema</h2><p class="sub">Te respondemos acá mismo y podés seguir la conversación.</p></div>' +
      '<div class="fld"><span id="k-l" style="font-size:14px;font-weight:500;color:#45515c">¿De qué se trata?</span><div class="kinds" role="group" aria-labelledby="k-l">' +
      '<button type="button" class="kd' + (view.kind === 'reporte' ? ' on' : '') + '" data-action="kind" data-kind="reporte" aria-pressed="' + (view.kind === 'reporte') + '">Algo se rompió o no funciona</button>' +
      '<button type="button" class="kd' + (view.kind === 'reclamo' ? ' on' : '') + '" data-action="kind" data-kind="reclamo" aria-pressed="' + (view.kind === 'reclamo') + '">Reclamo a la administración</button></div></div>' +
      '<div class="fld"><label for="c-t">¿Qué pasa?</label><input class="inp" id="c-t" name="title" type="text" maxlength="120" placeholder="Ej.: no anda el portero eléctrico"></div>' +
      '<div class="fld"><label for="c-b">Contanos más (opcional)</label><textarea class="inp ta" id="c-b" name="body" rows="3" maxlength="1000"></textarea></div>' +
      '<p class="rej" data-error hidden></p><div><button type="submit" class="big" style="margin-top:0">Enviar a la administración</button></div></form>';
  }

  function render() {
    const ctx = context();
    const first = ctx.person.name.split(' ')[0];
    const openThreads = ctx.b.threads.filter((t) => t.unit === ctx.unit.n && t.status !== 'resuelto').length;
    const tabs = [['liquidacion', 'Mi liquidación', 0], ['comprobantes', 'Mis comprobantes', 0], ['avisos', 'Avisos', ctx.b.notices.length], ['reclamos', 'Problemas y reclamos', openThreads]];
    const body = { liquidacion, comprobantes, avisos, reclamos }[view.tab](ctx);
    const note = ctx.unit.tenant ? (ctx.role === 'tenant' ? ' · pagás los gastos comunes' : ' · pagás fondo de reserva y extraordinarios') : '';

    document.title = 'Mi cuenta · ' + ctx.b.name;
    root.innerHTML = '<div class="pt" data-theme="' + esc(view.theme) + '" data-pago="bloques" data-tipo="jakarta"><div class="wrap">' +
      '<header class="top"><div class="brand"><span class="mark">' + ICON.building + '</span><span><b>' + esc(ctx.b.name) + '</b><small>Administra ' + esc(ctx.state.company.name) + '</small></span></div>' +
      '<div class="tr"><span class="tdate">' + esc(fmt.date(ctx.state.today)) + '</span><div class="thw"><button type="button" class="ibtn" aria-label="Elegir tema" aria-expanded="' + view.themeOpen + '" title="Tema" data-action="theme-toggle">' + ICON.palette + '</button>' + themeMenu() + '</div>' +
      '<a class="lnk" href="admin.html">Panel de administración</a></div></header>' +
      '<div class="cols"><div class="lc"><section class="hello"><h1>Hola, ' + esc(first) + (ctx.account.status === 'pagado' ? ', estás al día' : '') + '</h1><p>Apartamento ' + esc(ctx.unit.n) + ' · ' + esc(GC.ROLE_LABEL[ctx.role]) + note + '</p></section>' +
      dueCard(ctx) + '</div>' +
      '<div class="rc"><div><div class="tabs" role="tablist">' + tabs.map(([id, label, n]) => '<button type="button" role="tab" class="tab' + (view.tab === id ? ' on' : '') + '" aria-selected="' + (view.tab === id) + '" data-action="tab" data-tab="' + id + '">' + label + (n ? '<span class="cnt">' + n + '</span>' : '') + '</button>').join('') + '</div>' +
      '<div class="panel" style="margin-top:24px">' + body + '</div></div></div></div>' +
      receiptDialog(ctx) +
      '<p class="foot">¿Dudas? Escribinos a ' + esc(ctx.state.company.email) + '. También podés pedir la liquidación en papel.</p></div></div>';
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

  const actions = {
    tab: (el) => { view = { ...view, tab: el.dataset.tab, thread: null, error: '' }; },
    'theme-toggle': () => { view = { ...view, themeOpen: !view.themeOpen }; },
    theme: (el) => {
      const id = el.dataset.themeId;
      try { localStorage.setItem('gc-theme', id); } catch (err) { /* sin almacenamiento: el tema dura la sesión */ }
      view = { ...view, theme: id, themeOpen: false };
    },
    'month-toggle': () => { view = { ...view, monthOpen: !view.monthOpen, year: null }; },
    month: (el) => { view = { ...view, month: el.dataset.month, monthOpen: false, year: null }; },
    'month-step': (el) => {
      const months = L.issuedExpenses(context().b).map((e) => e.month).sort().reverse();
      const current = view.month && months.includes(view.month) ? view.month : months[0];
      const next = months[months.indexOf(current) - Number(el.dataset.dir)];
      if (next) view = { ...view, month: next, monthOpen: false };
    },
    year: (el) => {
      const ctx = context();
      const months = L.issuedExpenses(ctx.b).map((e) => e.month).sort().reverse();
      const current = view.month && months.includes(view.month) ? view.month : months[0];
      const curYear = Number(ctx.state.currentMonth.slice(0, 4));
      const year = (view.year || Number(current.slice(0, 4))) + Number(el.dataset.dir);
      if (year >= curYear - YEARS_BACK && year <= curYear) view = { ...view, year };
    },
    movs: () => { view = { ...view, movs: !view.movs }; },
    print: () => { window.print(); return false; },
    'building-pdf': () => { GC.toast('La liquidación del edificio se descarga como PDF (pendiente en el backend).'); return false; },
    copy: (el) => {
      try { navigator.clipboard.writeText(el.dataset.value); } catch (err) { /* sin portapapeles */ }
      const i = Number(el.dataset.i);
      view = { ...view, copied: i };
      setTimeout(() => { if (view.copied === i) { view = { ...view, copied: null }; render(); } }, 1500);
    },
    simulate: () => {
      store.update((s) => L.validatePayment(s, who.buildingId, who.key));
      view = { ...view, approved: true };
      return false;
    },
    'reset-demo': () => { view = { ...view, approved: false }; store.reset(); return false; },
    receipt: (el) => { view = { ...view, receipt: receipts(context())[Number(el.dataset.i)] }; },
    'receipt-close': () => { view = { ...view, receipt: null }; },
    kind: (el) => { view = { ...view, kind: el.dataset.kind }; },
    thread: (el) => { view = { ...view, thread: el.dataset.id }; },
    'thread-close': () => { view = { ...view, thread: null }; },
    'sim-admin': () => {
      const ctx = context();
      const msg = { from: 'admin', name: ctx.state.company.name, date: ctx.state.today, text: 'Recibimos tu mensaje. Lo estamos coordinando y te avisamos por acá apenas tengamos novedades.' };
      store.update((s) => L.setThreadStatus(L.reply(s, who.buildingId, view.thread, msg), who.buildingId, view.thread, 'en-proceso'));
      return false;
    },
  };

  const forms = {
    claim(form) {
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const body = String(data.get('body') || '').trim();
      const errorEl = form.querySelector('[data-error]');
      if (title.length < 4) {
        errorEl.textContent = 'Contanos en pocas palabras qué pasa.';
        errorEl.hidden = false;
        return;
      }
      const ctx = context();
      const thread = {
        id: GC.uid('t'), kind: view.kind, unit: ctx.unit.n, author: ctx.person.name, title, status: 'pendiente', date: ctx.state.today,
        messages: [{ from: 'resident', name: ctx.person.name, date: ctx.state.today, text: body || title }],
      };
      view = { ...view, thread: thread.id };
      store.update((s) => L.addThread(s, who.buildingId, thread));
      GC.toast('Enviado. La administración te va a responder acá.');
    },
    reply(form) {
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) return;
      const ctx = context();
      store.update((s) => L.reply(s, who.buildingId, form.dataset.id, { from: 'resident', name: ctx.person.name, date: ctx.state.today, text }));
    },
  };

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    // Cerrar desplegables al hacer clic afuera.
    if (!event.target.closest('.thw, .mdd') && (view.themeOpen || view.monthOpen)) {
      view = { ...view, themeOpen: false, monthOpen: false };
      if (!el) return render();
    }
    if (!el || el.tagName === 'INPUT') return;
    const action = actions[el.dataset.action];
    if (!action) return;
    event.preventDefault();
    if (action(el) !== false) render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !(view.themeOpen || view.monthOpen || view.receipt)) return;
    view = { ...view, themeOpen: false, monthOpen: false, receipt: null };
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

  // El tema se comparte con el panel de administración (otra pestaña).
  window.addEventListener('storage', (event) => {
    if (event.key === 'gc-theme') { view = { ...view, theme: event.newValue || 'lagoon' }; render(); }
  });

  store.subscribe(render);
  render();
})(window.GC);
