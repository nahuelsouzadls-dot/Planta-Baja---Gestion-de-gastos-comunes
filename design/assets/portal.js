/* Portal de residentes: estado de cuenta, liquidación, comprobantes, avisos y reclamos.
 * El markup sigue el prototipo de design/ref (gc-portal.html): mismas clases y estructura.
 * Los datos vienen de la API (/api/v1/portal/…); los montos los calcula el backend. */
(function (GC) {
  'use strict';

  const api = GC.api;
  const esc = GC.esc;
  const fmt = GC.fmt;

  const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
  const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
  const OCC_KEY = 'gc-occupancy';
  const YEARS_BACK = 5;
  const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const THEMES = [['lagoon', 'Lagoon', '#0e4a5e', '#12909f'], ['noche', 'Azul noche', '#14233d', '#2a86bd'], ['berenjena', 'Berenjena', '#3b1f45', '#1f9e80'], ['bosque', 'Bosque', '#1d3b2f', '#b88a3a'], ['grafito', 'Grafito', '#25282e', '#d9604f']];
  const THREAD_STATUS = { pending: ['st-pendiente', 'Recibido'], in_progress: ['st-revision', 'En proceso'], resolved: ['st-pagado', 'Resuelto'] };
  const RECEIPT_STATUS = { approved: ['st-pagado', 'Aprobado'], pending: ['st-revision', 'En revisión'], rejected: ['st-moroso', 'Rechazado'] };

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

  function storedTheme() {
    try { return localStorage.getItem('gc-theme') || 'lagoon'; } catch (err) { return 'lagoon'; }
  }

  function localToday() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }

  let view = {
    tab: 'liquidacion', month: null, monthOpen: false, year: null, themeOpen: false, theme: storedTheme(),
    movs: false, kind: 'reporte', thread: null, receipt: null, copied: null, error: '',
    upload: null,
  };
  /** Archivo elegido para subir (no va en `view` porque no se serializa). */
  let pendingFile = null;

  /** Lo que devolvió la API para la ocupación elegida. */
  const state = {
    ready: false,
    error: '',
    today: localToday(),
    currentMonth: localToday().slice(0, 7),
    occupancies: [],
    occupancyId: null,
    account: null,
    months: [],
    movements: [],
    receipts: [],
    notices: [],
    claims: [],
    settlements: {},
    threads: {},
  };

  // ── Datos ──────────────────────────────────────────────────────────────
  const occ = (path) => 'portal/occupancies/' + state.occupancyId + '/' + path;

  async function loadOccupancy() {
    const [account, months, movements, receipts, notices, claims] = await Promise.all([
      api.get(occ('account')), api.get(occ('months')), api.get(occ('movements')),
      api.get(occ('receipts')), api.get(occ('notices')), api.get(occ('claims')),
    ]);
    state.account = account;
    state.months = months.months;
    state.movements = movements.movements;
    state.receipts = receipts.receipts;
    state.notices = notices.notices;
    state.claims = claims.claims;
    state.settlements = {};
    state.threads = {};
  }

  async function loadClaims() {
    state.claims = (await api.get(occ('claims'))).claims;
  }

  async function loadThread(id) {
    state.threads[id] = await api.get('portal/claims/' + id);
  }

  async function loadSettlement(month) {
    state.settlements[month] = await api.get(occ('settlements/' + month));
  }

  // Carga perezosa de lo que la pestaña actual necesita.
  const inflight = new Set();
  const failed = new Set();
  function ensure(key, loader) {
    if (inflight.has(key) || failed.has(key)) return;
    inflight.add(key);
    loader()
      .then(() => render())
      .catch((err) => {
        failed.add(key);
        GC.toast(err.message, 'warn');
      })
      .finally(() => inflight.delete(key));
  }

  function needs() {
    if (view.tab === 'liquidacion') {
      const month = selectedMonth();
      if (month && !state.settlements[month]) ensure('s:' + month, () => loadSettlement(month));
    }
    if (view.tab === 'reclamos' && view.thread && !state.threads[view.thread]) {
      const id = view.thread;
      ensure('t:' + id, () => loadThread(id));
    }
  }

  async function attempt(fn) {
    try {
      await fn();
    } catch (err) {
      GC.toast(err.message, 'warn');
    }
  }

  const ymKey = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
  const DOT = { ok: ['ok', 'Pagado'], warn: ['warn', 'Sin pagar'], bad: ['bad', 'Vencido'] };

  /** Meses con liquidación, del más reciente al más antiguo. */
  function monthKeys() {
    return state.months.map((m) => m.month).sort().reverse();
  }

  function selectedMonth() {
    const months = monthKeys();
    return view.month && months.includes(view.month) ? view.month : months[0];
  }

  function monthDot(month) {
    const item = state.months.find((m) => m.month === month);
    return DOT[item ? item.status : 'ok'] || DOT.ok;
  }

  // ── Vistas ─────────────────────────────────────────────────────────────
  function themeMenu() {
    if (!view.themeOpen) return '';
    return '<div class="thmp" role="menu"><div class="thmh">Tema de color</div>' +
      THEMES.map(([id, label, c1, c2]) => '<button type="button" class="thmo' + (view.theme === id ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (view.theme === id) + '" data-action="theme" data-theme-id="' + id + '">' +
        '<span class="thmv"><i style="background:' + c1 + '"></i><i class="l"><b style="background:' + c2 + '"></b></i></span><span>' + label + '</span></button>').join('') + '</div>';
  }

  function dueCard() {
    const a = state.account;
    const monthWord = fmt.monthLong(state.currentMonth).split(' ')[0];
    const unpaid = a.unpaid_months;
    const copy = {
      pagado: ['Estás al día', fmt.money(0), 'No tenés pagos pendientes. Gracias.'],
      revision: ['Recibimos tu comprobante', fmt.money(a.balance, true), 'La administración lo está verificando con el banco. Te avisamos cuando quede registrado.'],
      pendiente: ['Tenés para pagar', fmt.money(a.balance, true), 'Liquidación de ' + fmt.monthLong(state.currentMonth) + '. Vencimiento: ' + a.due_day + ' de ' + monthWord + '.'],
      moroso: ['Tenés ' + unpaid.length + (unpaid.length === 1 ? ' mes' : ' meses') + ' sin pagar', fmt.money(a.balance, true), 'Adeudás ' + unpaid.map((m) => fmt.monthLong(m)).join(', ') + '. Si ya pagaste, subí el comprobante.'],
      'sin-cargar': ['Todavía no hay liquidación', fmt.money(a.balance, true), 'La administración aún no publicó la liquidación de ' + fmt.monthLong(state.currentMonth) + '.'],
    }[a.status];

    const canPay = Number(a.balance) > 0 && a.status !== 'revision';
    const bank = [['Banco', a.bank.bank_name], ['Cuenta corriente (pesos)', a.bank.account], ['Titular', a.bank.holder], ['Concepto', a.bank.concept]].filter(([, value]) => value);
    const bankBlock = canPay
      ? '<div class="bank"><p class="bh">Datos para transferir</p>' + bank.map(([label, value], i) =>
        '<div class="brw"><span><small>' + esc(label) + '</small><b>' + esc(value) + '</b></span><button type="button" class="cp" data-action="copy" data-i="' + i + '" data-value="' + esc(value) + '">' + (view.copied === i ? 'Copiado' : 'Copiar') + '</button></div>').join('') + '</div>'
      : '';

    let bottom = '';
    if (canPay && view.upload) {
      bottom = uploadForm();
    } else if (canPay) {
      bottom = '<div class="dbot"><label class="big">' + ICON.upload + 'Subir comprobante<input class="vh" type="file" accept="image/*,application/pdf" data-action="upload"></label>' +
        '<p class="uph">Después de transferir, subí la foto o el PDF del banco. Lo revisamos en el día.</p>' +
        (view.error ? '<p class="ferr" role="alert">' + esc(view.error) + '</p>' : '') + '</div>';
    } else if (a.status === 'revision' && a.pending_receipt) {
      bottom = '<div class="dbot card"><p class="ok"><span class="pill st-revision">En revisión</span><span>' + esc(GC.fileLabel(a.pending_receipt.file)) + ' · transferido el ' + esc(fmt.dateShort(a.pending_receipt.date)) + '</span></p></div>';
    } else if (a.status === 'pagado') {
      bottom = '<div class="dbot card"><p class="ok"><span class="pill st-pagado">Al día</span><span>Gracias por pagar a tiempo.</span></p></div>';
    }

    return '<section class="due' + (a.status === 'pagado' ? ' due-ok' : '') + '" aria-live="polite"><div class="pay"><div class="dtop"><span class="glass"></span>' +
      '<p class="dl">' + esc(copy[0]) + '</p><p class="da">' + copy[1] + '</p><p class="ds">' + esc(copy[2]) + '</p></div>' + bankBlock + '</div>' + bottom + '</section>';
  }

  /** Paso de confirmación antes de enviar: monto, fecha y, si debe en varias unidades, el reparto (N12). */
  function uploadForm() {
    const u = view.upload;
    const split = u.accounts.length > 1
      ? '<p class="uph" style="text-align:left;margin-top:4px">Tenés saldo en más de una unidad. Indicá cuánto va a cada una:</p>' + u.accounts.map((x) =>
        '<div class="fld"><label for="u-' + esc(x.id) + '">Apto ' + esc(x.unit) + ' · ' + esc(x.building) + ' (debe ' + fmt.money(x.balance, true) + ')</label>' +
        '<input class="inp mono" id="u-' + esc(x.id) + '" name="alloc:' + esc(x.id) + '" inputmode="decimal" autocomplete="off" value="' + esc(u.typed ? u.typed[x.id] : x.typedDefault) + '"></div>').join('') +
        '<div class="fld"><label for="u-note">Aclaración</label><input class="inp" id="u-note" name="note" type="text" maxlength="200" placeholder="Ej.: pago de las dos unidades de octubre" value="' + esc(u.note || '') + '"></div>'
      : '';
    return '<form class="dbot card sec" style="gap:12px;text-align:left" data-form="upload" novalidate>' +
      '<p class="ok"><span class="pill st-revision">Archivo</span><span>' + esc(u.name) + '</span></p>' +
      '<div class="fld"><label for="u-amount">Monto que transferiste</label><input class="inp mono" id="u-amount" name="amount" inputmode="decimal" autocomplete="off" value="' + esc(u.total) + '"></div>' +
      '<div class="fld"><label for="u-date">Fecha de la transferencia</label><input class="inp" id="u-date" name="date" type="date" max="' + esc(state.today) + '" value="' + esc(u.date || state.today) + '"></div>' +
      split +
      (view.error ? '<p class="ferr" role="alert">' + esc(view.error) + '</p>' : '') +
      '<div class="racts"><button type="submit" class="big" style="margin:0">' + (u.sending ? 'Enviando…' : 'Enviar comprobante') + '</button><button type="button" class="lk" data-action="upload-cancel">Cancelar</button></div></form>';
  }

  function monthSelector(months, month) {
    const [dot] = monthDot(month);
    const curYear = Number(state.currentMonth.slice(0, 4));
    const year = view.year || Number(month.slice(0, 4));
    let list = '';
    if (view.monthOpen) {
      const cells = MONTHS_SHORT.map((label, i) => {
        const k = ymKey(year, i);
        const has = months.includes(k);
        const d = has ? monthDot(k)[0] : 'none';
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

  function liquidacion() {
    const a = state.account;
    const months = monthKeys();
    if (!months.length) return '<div class="sec"><p class="empty">Todavía no hay liquidaciones publicadas.</p></div>';
    const month = selectedMonth();
    const detail = state.settlements[month];

    const rows = detail
      ? detail.lines.map((l) => '<div class="ln"><span>' + esc(l.concept) + '<small>' + esc(l.detail || 'Total del edificio ' + fmt.money(l.building_total)) + '</small></span><span class="mono">' + fmt.money(l.amount, true) + '</span></div>').join('') +
        '<div class="ln tot"><span>Total ' + esc(fmt.monthLong(month)) + '</span><span class="mono">' + fmt.money(detail.total, true) + '</span></div>'
      : '<p class="empty">Cargando…</p>';

    const moves = view.movs
      ? '<div><h2 class="h2" style="margin-bottom:8px">Tus movimientos</h2>' + (state.movements.length ? state.movements.slice(0, 6).map((m) =>
        '<div class="mv"><span class="mono" style="text-align:left;color:#596269">' + esc(fmt.dateShort(m.date)) + '</span><span>' + esc(m.concept) + '</span><span class="mono' + (Number(m.credit) ? ' cr' : '') + '">' + (Number(m.debit) ? fmt.money(m.debit) : '− ' + fmt.money(m.credit)) + '</span></div>').join('')
        : '<p class="empty">Sin movimientos.</p>') +
        '<p class="sub" style="margin-top:8px"><a class="lk" href="/api/v1/' + occ('exports/movements') + '" download>Descargar todos mis movimientos en Excel</a></p></div>'
      : '';

    return '<div class="sec"><div><h2 class="h2">Liquidación de ' + esc(fmt.monthLong(month)) + '</h2><p class="sub">' + (detail ? 'Tu coeficiente: ' + fmt.percent(detail.coefficient) + ' · ' : '') + esc(GC.ROLE_LABEL[a.role]) + '</p></div>' +
      '<p class="print-only"><strong>' + esc(a.organization) + '</strong> · ' + esc(a.building) + '<br>' + esc(a.name) + ' · Apto ' + esc(a.unit) + ' · ' + esc(GC.ROLE_LABEL[a.role]) + '</p>' +
      monthSelector(months, month) +
      '<div>' + rows + '</div>' +
      '<div class="acts"><button type="button" class="btn" data-action="print">Imprimir o guardar PDF</button><button type="button" class="btn" data-action="building-pdf">Descargar liquidación del edificio</button>' +
      '<button type="button" class="btn" data-action="movs">' + (view.movs ? 'Ocultar mis movimientos' : 'Ver mis movimientos') + '</button></div>' + moves + '</div>';
  }

  function comprobantes() {
    const list = state.receipts;
    const rows = list.length ? list.map((r, i) => '<div class="rwb"><button type="button" class="rw" data-action="receipt" data-i="' + i + '"><span class="grow"><b>Pago de ' + esc(fmt.monthLong(r.month)) + '</b><small>' + fmt.money(r.amount, true) + ' · transferido el ' + esc(fmt.dateShort(r.date)) + '</small></span>' +
      '<span class="pill ' + RECEIPT_STATUS[r.status][0] + '">' + RECEIPT_STATUS[r.status][1] + '</span>' + ICON.chev + '</button>' +
      (r.status === 'rejected' ? '<p class="rej">Motivo: ' + esc(r.reason || 'no pudimos verificar la transferencia.') + ' <button type="button" class="lk" data-action="tab" data-tab="liquidacion">Subir uno nuevo</button></p>' : '') + '</div>').join('')
      : '<p class="empty">Todavía no subiste comprobantes.</p>';
    return '<div class="sec"><div><h2 class="h2">Mis comprobantes</h2><p class="sub">Todo lo que subiste y cómo quedó.</p></div><div>' + rows + '</div></div>';
  }

  function receiptDialog() {
    const r = view.receipt;
    if (!r) return '';
    const a = state.account;
    return '<div class="rvo"><button type="button" class="rvbk" aria-label="Cerrar" data-action="receipt-close"></button><div class="rvc" role="dialog" aria-label="Comprobante">' +
      '<div class="rvh"><b>Comprobante</b><button type="button" class="lk" data-action="receipt-close">Cerrar</button></div>' +
      '<div class="rvpaper"><p class="rvb1">Datos que declaraste</p><p class="rvt">Transferencia</p><p class="rvm">' + fmt.money(r.declared_amount, true) + '</p>' +
      '<div class="rvr"><span>Fecha</span><b>' + esc(fmt.date(r.date)) + '</b></div><div class="rvr"><span>Destino</span><b>' + esc(a.organization) + '</b></div>' +
      '<div class="rvr"><span>Concepto</span><b>' + esc(a.concept) + '</b></div><div class="rvr"><span>Nota</span><b>' + esc(r.note || '—') + '</b></div></div>' +
      fileBlock(r) + '</div></div>';
  }

  function fileBlock(r) {
    const f = view.receiptFile;
    if (f === undefined) return '<p class="sub" style="margin-top:10px">Cargando el archivo…</p>';
    if (!f) return '<p class="sub" style="margin-top:10px">' + esc(GC.fileLabel(r.file)) + ' · el archivo no está disponible.</p>';
    return f.content_type.startsWith('image/')
      ? '<img src="' + esc(f.url) + '" alt="Comprobante subido" style="display:block;max-width:100%;max-height:60vh;margin-top:12px;border-radius:8px">'
      : '<p class="sub" style="margin-top:10px"><a class="lk" href="' + esc(f.url) + '" target="_blank" rel="noopener">Abrir el PDF del comprobante</a></p>';
  }

  function avisos() {
    if (!state.notices.length) return '<p class="empty">No hay avisos.</p>';
    const recent = (iso) => (Date.parse(state.today) - Date.parse(iso)) / 86400000 <= 7;
    return '<div>' + state.notices.map((n) => '<article class="notice"><div class="nt"><span>' + esc(n.title) + (recent(n.date) ? '<span class="new">Nuevo</span>' : '') + '</span><time datetime="' + esc(n.date) + '">' + esc(fmt.date(n.date)) + '</time></div><p>' + esc(n.body) + '</p></article>').join('') + '</div>';
  }

  const kindLabel = (kind) => (kind === 'complaint' ? 'Reclamo' : 'Reporte');

  function reclamos() {
    if (view.thread) {
      const open = state.threads[view.thread];
      if (!open) return '<div class="sec"><button type="button" class="lk back" data-action="thread-close">← Volver a mis reclamos</button><p class="empty">Cargando…</p></div>';
      const st = THREAD_STATUS[open.status];
      return '<div class="sec"><button type="button" class="lk back" data-action="thread-close">← Volver a mis reclamos</button>' +
        '<div class="thh"><div><h2 class="h2">' + esc(open.title) + '</h2><p class="sub">' + kindLabel(open.kind) + ' · ' + esc(fmt.date(open.date)) + '</p></div><span class="pill ' + st[0] + '">' + st[1] + '</span></div>' +
        '<div class="thread">' + open.messages.map((m) => '<div class="msg' + (m.from_admin ? '' : ' me') + '"><small>' + esc(m.author) + ' · ' + esc(fmt.dateShort(m.date.slice(0, 10))) + '</small>' + esc(m.text) + '</div>').join('') + '</div>' +
        (open.status !== 'resolved'
          ? '<form class="sec" style="gap:12px" data-form="reply" data-id="' + esc(open.id) + '"><div class="fld"><label for="c-reply">Tu respuesta</label><textarea class="inp ta" id="c-reply" name="text" rows="3" maxlength="1000" placeholder="Escribí un mensaje a la administración"></textarea></div>' +
            '<div class="racts"><button type="submit" class="big" style="margin:0">Enviar mensaje</button></div></form>'
          : '<p class="sub">Este reclamo está resuelto. Si el problema sigue, abrí uno nuevo.</p>') + '</div>';
    }

    const mine = state.claims;
    const list = mine.length
      ? '<div><h2 class="h2" style="margin-bottom:6px">Tus reclamos</h2>' + mine.map((t) => {
        const st = THREAD_STATUS[t.status];
        return '<button type="button" class="rw" data-action="thread" data-id="' + esc(t.id) + '"><span class="grow"><b>' + esc(t.title) + '</b><small>' + kindLabel(t.kind) + ' · ' + esc(fmt.date(t.date)) + ' · ' + t.message_count + (t.message_count === 1 ? ' mensaje' : ' mensajes') + '</small></span><span class="pill ' + st[0] + '">' + st[1] + '</span>' + ICON.chev + '</button>';
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

  /** Selector de unidad (N4): solo si la persona tiene más de una. */
  function occupancySelector() {
    if (state.occupancies.length < 2) return '';
    return '<label style="display:block;margin-bottom:16px"><span class="vh">Unidad</span><select class="inp" data-action="occupancy">' + state.occupancies.map((o) =>
      '<option value="' + esc(o.id) + '"' + (o.id === state.occupancyId ? ' selected' : '') + '>Apto ' + esc(o.unit_number) + ' · ' + esc(o.building_name) + ' · ' + esc(GC.ROLE_LABEL[o.role]) + (o.end_date ? ' (cerrada)' : '') + '</option>').join('') + '</select></label>';
  }

  function render() {
    if (!state.ready) {
      root.innerHTML = '<div class="pt" data-theme="' + esc(view.theme) + '" data-pago="bloques" data-tipo="jakarta"><div class="wrap"><p class="empty" style="padding:48px 0">' +
        (state.error ? esc(state.error) + ' <button type="button" class="lk" data-action="retry">Reintentar</button>' : 'Cargando…') + '</p></div></div>';
      return;
    }
    const a = state.account;
    const openThreads = state.claims.filter((t) => t.status !== 'resolved').length;
    const tabs = [['liquidacion', 'Mi liquidación', 0], ['comprobantes', 'Mis comprobantes', 0], ['avisos', 'Avisos', state.notices.length], ['reclamos', 'Problemas y reclamos', openThreads]];
    const body = { liquidacion, comprobantes, avisos, reclamos }[view.tab]();
    const note = a.role_note ? ' · ' + a.role_note : '';
    const closed = a.closed
      ? '<p class="ferr" role="note" style="margin-top:10px">Esta unidad ya no está a tu nombre. ' + (Number(a.balance) > 0 ? 'Te queda por pagar ' + fmt.money(a.balance, true) + '.' : 'No tenés saldo pendiente.') + '</p>'
      : '';

    document.title = 'Mi cuenta · ' + a.building;
    root.innerHTML = '<div class="pt" data-theme="' + esc(view.theme) + '" data-pago="bloques" data-tipo="jakarta"><div class="wrap">' +
      '<header class="top"><div class="brand"><span class="mark">' + ICON.building + '</span><span><b>' + esc(a.building) + '</b><small>Administra ' + esc(a.organization) + '</small></span></div>' +
      '<div class="tr"><span class="tdate">' + esc(fmt.date(state.today)) + '</span><div class="thw"><button type="button" class="ibtn" aria-label="Elegir tema" aria-expanded="' + view.themeOpen + '" title="Tema" data-action="theme-toggle">' + ICON.palette + '</button>' + themeMenu() + '</div>' +
      '<a class="lnk" href="/ingresar" data-action="logout">Cerrar sesión</a></div></header>' +
      '<div class="cols"><div class="lc">' + occupancySelector() + '<section class="hello"><h1>Hola, ' + esc(a.first_name) + (a.status === 'pagado' ? ', estás al día' : '') + '</h1><p>Apartamento ' + esc(a.unit) + ' · ' + esc(GC.ROLE_LABEL[a.role]) + esc(note) + '</p>' + closed + '</section>' +
      dueCard() + '</div>' +
      '<div class="rc"><div><div class="tabs" role="tablist">' + tabs.map(([id, label, n]) => '<button type="button" role="tab" class="tab' + (view.tab === id ? ' on' : '') + '" aria-selected="' + (view.tab === id) + '" data-action="tab" data-tab="' + id + '">' + label + (n ? '<span class="cnt">' + n + '</span>' : '') + '</button>').join('') + '</div>' +
      '<div class="panel" style="margin-top:24px">' + body + '</div></div></div></div>' +
      receiptDialog() +
      '<p class="foot">¿Dudas? Escribile a ' + esc(a.organization.replace(/\.$/, '')) + '. También podés pedir la liquidación en papel.</p>' +
      // En el celular el diseño oculta el enlace de la barra superior; acá queda siempre a mano.
      '<p class="foot" style="margin-top:8px"><a class="lk" href="/ingresar" data-action="logout">Cerrar sesión</a></p></div></div>';
    needs();
  }

  // ── Acciones ───────────────────────────────────────────────────────────
  async function handleUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    if (!RECEIPT_TYPES.includes(file.type) && !/\.(jpe?g|png|heic|webp|pdf)$/i.test(file.name)) {
      view = { ...view, error: 'Ese archivo no es una foto ni un PDF. Probá de nuevo.' };
      return render();
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      view = { ...view, error: 'El archivo pesa más de 10 MB. Probá con una foto más chica.' };
      return render();
    }
    if (!file.size) {
      view = { ...view, error: 'El archivo está vacío. Probá de nuevo.' };
      return render();
    }
    pendingFile = file;
    // Otras unidades de la misma persona con saldo: el pago se puede repartir entre ellas.
    const current = state.occupancies.find((o) => o.id === state.occupancyId);
    const siblings = state.occupancies.filter((o) => o.id !== state.occupancyId && o.person_id === current.person_id);
    const others = await Promise.all(siblings.map((o) => api.get('portal/occupancies/' + o.id + '/account').catch(() => null)));
    const accounts = [state.account].concat(others.filter((x) => x && Number(x.balance) > 0 && x.status !== 'revision'))
      .map((x) => ({ id: x.id, unit: x.unit, building: x.building, balance: x.balance, typedDefault: comma(x.balance) }));
    const total = accounts.length === 1 ? comma(accounts[0].balance) : '';
    view = { ...view, error: '', upload: { name: file.name.slice(0, 80), accounts, total, sending: false } };
    render();
  }

  /** "4153.80" → "4153,80" para mostrar en un campo editable. */
  const comma = (amount) => String(amount).replace('.', ',');

  /** Tipo MIME a declarar: el del navegador o, si no lo trae (HEIC en algunos), por extensión. */
  function mimeOf(file) {
    if (RECEIPT_TYPES.includes(file.type)) return file.type;
    const ext = (file.name.match(/\.(\w+)$/) || [])[1] || '';
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp', pdf: 'application/pdf' }[ext.toLowerCase()] || file.type;
  }


  function uploadError(message) {
    view = { ...view, error: message };
    render();
  }

  async function sendReceipt(form) {
    const data = new FormData(form);
    const amount = GC.amountText(data.get('amount'));
    const date = String(data.get('date') || '');
    // Lo escrito sobrevive a un nuevo render (por ejemplo, al mostrar un error).
    const typed = Object.fromEntries(view.upload.accounts.map((x) => [x.id, String(data.get('alloc:' + x.id) || '')]));
    view = { ...view, upload: { ...view.upload, total: String(data.get('amount') || ''), date, note: String(data.get('note') || ''), typed } };
    if (!amount) return uploadError('Escribí el monto que transferiste (por ejemplo 4153,80).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return uploadError('Elegí la fecha de la transferencia.');
    let allocations;
    if (view.upload.accounts.length > 1) {
      const raw = view.upload.accounts.map((x) => [x.id, String(data.get('alloc:' + x.id) || '').trim()]).filter(([, v]) => v && v !== '0');
      allocations = raw.map(([id, v]) => ({ occupancy_id: id, amount: GC.amountText(v) }));
      if (!allocations.length || allocations.some((x) => !x.amount)) return uploadError('Revisá los montos de cada unidad.');
    }
    const file = pendingFile;
    view = { ...view, error: '', upload: { ...view.upload, sending: true } };
    render();
    try {
      const contentType = mimeOf(file);
      const intent = await api.post(occ('receipts/upload'), { content_type: contentType, size_bytes: file.size, filename: file.name.slice(0, 120) });
      const body = new FormData();
      Object.entries(intent.fields).forEach(([k, v]) => body.append(k, v));
      body.append('file', file);
      let sent;
      try {
        sent = await fetch(intent.url, { method: 'POST', body });
      } catch (err) {
        throw new Error('No se pudo subir el archivo. Revisá tu conexión y probá de nuevo.');
      }
      if (!sent.ok) throw new Error('El almacenamiento rechazó el archivo. Probá de nuevo.');
      await api.post('portal/receipts', {
        file_key: intent.file_key, declared_amount: amount, transfer_date: date,
        ...(allocations ? { allocations, note: String(data.get('note') || '').trim() } : {}),
      });
      pendingFile = null;
      view = { ...view, upload: null, error: '' };
      await loadOccupancy();
      render();
      GC.toast('Comprobante enviado. Te avisamos cuando esté validado.');
    } catch (err) {
      view = { ...view, error: err.message, upload: { ...view.upload, sending: false } };
      render();
    }
  }

  const actions = {
    retry: () => { start(); return false; },
    logout: () => { api.logout(); return false; },
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
      const months = monthKeys();
      const next = months[months.indexOf(selectedMonth()) - Number(el.dataset.dir)];
      if (next) view = { ...view, month: next, monthOpen: false };
    },
    year: (el) => {
      const curYear = Number(state.currentMonth.slice(0, 4));
      const year = (view.year || Number(selectedMonth().slice(0, 4))) + Number(el.dataset.dir);
      if (year >= curYear - YEARS_BACK && year <= curYear) view = { ...view, year };
    },
    movs: () => { view = { ...view, movs: !view.movs }; },
    // PDF de la liquidación (D4); si no se puede generar, queda la impresión del navegador.
    print: () => {
      GC.openSigned(api.get(occ('settlements/' + selectedMonth() + '/pdf'))).catch(() => window.print());
      return false;
    },
    'building-pdf': () => {
      GC.openSigned(api.get(occ('settlements/' + selectedMonth() + '/building-pdf'))).catch((err) => GC.toast(err.message, 'warn'));
      return false;
    },
    copy: (el) => {
      try { navigator.clipboard.writeText(el.dataset.value); } catch (err) { /* sin portapapeles */ }
      const i = Number(el.dataset.i);
      view = { ...view, copied: i };
      setTimeout(() => { if (view.copied === i) { view = { ...view, copied: null }; render(); } }, 1500);
    },
    receipt: (el) => {
      const r = state.receipts[Number(el.dataset.i)];
      view = { ...view, receipt: r, receiptFile: undefined };
      api.get('portal/receipts/' + r.id + '/file', { noRedirect: true })
        .then((f) => f, () => null)
        .then((f) => { if (view.receipt === r) { view = { ...view, receiptFile: f }; render(); } });
    },
    'receipt-close': () => { view = { ...view, receipt: null }; },
    'upload-cancel': () => { pendingFile = null; view = { ...view, upload: null, error: '' }; },
    kind: (el) => { view = { ...view, kind: el.dataset.kind }; },
    thread: (el) => { view = { ...view, thread: el.dataset.id }; },
    'thread-close': () => { view = { ...view, thread: null }; },
  };

  function formError(form, message) {
    const errorEl = form.querySelector('[data-error]');
    if (!errorEl) return GC.toast(message, 'warn');
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  async function submitting(form, fn) {
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (err) {
      if (document.contains(form)) formError(form, err.message);
      else GC.toast(err.message, 'warn');
    } finally {
      if (button) button.disabled = false;
    }
  }

  const forms = {
    upload: sendReceipt,
    claim(form) {
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const body = String(data.get('body') || '').trim();
      if (title.length < 4) return formError(form, 'Contanos en pocas palabras qué pasa.');
      return submitting(form, async () => {
        const claim = await api.post(occ('claims'), { kind: view.kind, title, body: body || title });
        state.threads[claim.id] = claim;
        await loadClaims();
        view = { ...view, thread: claim.id };
        render();
        GC.toast('Enviado. La administración te va a responder acá.');
      });
    },
    reply(form) {
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) return;
      const id = form.dataset.id;
      return submitting(form, async () => {
        await api.post('portal/claims/' + id + '/replies', { text });
        await Promise.all([loadThread(id), loadClaims()]);
        render();
      });
    },
  };

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    // Cerrar desplegables al hacer clic afuera.
    if (!event.target.closest('.thw, .mdd') && (view.themeOpen || view.monthOpen)) {
      view = { ...view, themeOpen: false, monthOpen: false };
      if (!el) return render();
    }
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
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
    if (event.target.matches('[data-action="occupancy"]')) {
      state.occupancyId = event.target.value;
      try { localStorage.setItem(OCC_KEY, state.occupancyId); } catch (err) { /* dura la sesión */ }
      view = { ...view, tab: 'liquidacion', month: null, thread: null, receipt: null, error: '' };
      failed.clear();
      attempt(async () => {
        await loadOccupancy();
        render();
      });
      return;
    }
    if (!event.target.matches('[data-action="upload"]')) return;
    event.target.blur();
    handleUpload(event.target);
  });

  // Al cerrar el selector de archivos sin elegir, el input quedaba enfocado y con contorno.
  document.addEventListener('cancel', (event) => {
    if (event.target.matches && event.target.matches('[data-action="upload"]')) event.target.blur();
  }, true);

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

  async function start() {
    state.error = '';
    state.ready = false;
    render();
    try {
      const me = await api.get('auth/me');
      // Primero las ocupaciones vigentes; las cerradas con saldo (ex inquilino, N17) al final.
      state.occupancies = me.persons.flatMap((p) => p.occupancies.map((o) => ({ ...o, person_id: p.id })))
        .sort((x, y) => Number(Boolean(x.end_date)) - Number(Boolean(y.end_date)));
      if (!state.occupancies.length) throw new Error('No encontramos una unidad asociada a tu usuario. Escribile a la administración.');
      let saved = null;
      try { saved = localStorage.getItem(OCC_KEY); } catch (err) { saved = null; }
      state.occupancyId = (state.occupancies.find((o) => o.id === saved) || state.occupancies[0]).id;
      await loadOccupancy();
      state.ready = true;
    } catch (err) {
      state.error = err.message;
    }
    render();
  }

  start();
})(window.GC);
