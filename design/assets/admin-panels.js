/* Paneles superpuestos del admin: detalle de unidad (drawer), carga de gastos y revisión de comprobante.
 * El markup sigue el prototipo de design/ref (gc-admin.html). Los datos vienen de la API. */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const esc = GC.esc;
  const fmt = GC.fmt;
  const ICON = GC.views.ICON;
  const loading = GC.views.loading;

  /** Monto escrito por la persona: texto con punto o coma decimal, hasta 2 decimales. */
  const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;

  function owedText(o) {
    if (o.overdue_months.length) return 'Vencido: ' + o.overdue_months.map((m) => fmt.monthLong(m)).join(', ');
    return Number(o.balance) > 0 ? 'Pendiente del mes en curso' : 'Sin deuda';
  }

  // ── Detalle de unidad ──────────────────────────────────────────────────
  GC.views.drawer = function (state, view) {
    const o = state.occupancies[view.drawer];
    const close = '<button type="button" class="x" aria-label="Cerrar" data-action="close-overlay">' + ICON.close + '</button>';
    const scrim = '<button type="button" class="scrim" aria-label="Cerrar detalle" data-action="close-overlay"></button>';
    if (!o) return scrim + '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Detalle de unidad"><div class="dh"><div>' + loading() + '</div>' + close + '</div></aside>';

    const d = state.detail[view.buildingId];
    const row = d && d.accounts.find((a) => a.id === o.id);
    const coef = fmt.percent(o.coefficient);
    const all = [{ id: o.id, role: o.role }].concat(o.other_occupancies).sort((x, y) => (x.role === 'owner' ? -1 : 1) - (y.role === 'owner' ? -1 : 1));
    const rented = all.some((x) => x.role === 'tenant');
    const roles = all.map((x) => '<button type="button" class="ch' + (x.id === o.id ? ' on' : '') + '" data-action="open-unit" data-occ="' + esc(x.id) + '">' +
      GC.ROLE_LABEL[x.role] + (rented ? (x.role === 'tenant' ? ' · gastos ordinarios' : ' · reserva y extraordinarios') : ' · todos los gastos') + '</button>').join('');

    const pending = o.pending_receipt;
    const review = pending
      ? '<button type="button" class="rcp" data-action="open-receipt" data-receipt="' + esc(pending.id) + '"><span><b>' + esc(GC.fileLabel(pending.file)) + '</b><small style="display:block;color:#5d6573">Transferido el ' + esc(fmt.date(pending.date)) + ' · cubre ' + fmt.money(pending.amount, true) + '</small></span>' +
        '<span class="rvt">Ver comprobante ' + ICON.arrow + '</span></button>'
      : '';
    const partial = (l) => (l.days != null && l.days_in_month && l.days !== l.days_in_month ? ' × ' + l.days + '/' + l.days_in_month + ' días' : '');

    return scrim +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Detalle de unidad">' +
      '<div class="dh"><div><div class="ut"><span class="mono">' + esc(o.unit) + '</span><span class="muted">' + esc(o.floor) + '.º piso · ' + esc(o.building) + '</span></div>' +
      '<div style="margin-top:10px;display:flex;gap:12px;align-items:center">' + GC.views.pill(o.status) + '<span class="muted" style="font-size:12px">Coeficiente ' + coef + '</span></div></div>' + close + '</div>' +
      '<div><div class="rl">' + roles + '</div><p style="margin-top:14px;font-weight:600;font-size:15px">' + esc(o.person.name) + '</p>' +
      '<p class="muted" style="font-size:12px">' + esc([o.person.phone, o.person.email].filter(Boolean).join(' · ')) + '</p></div>' +
      '<div><div class="fl">Saldo de ' + esc(o.person.name) + '</div><div class="big" style="margin-top:2px;color:' + (o.overdue_months.length ? '#98140b' : '#201f23') + '">' + fmt.money(o.balance, true) + '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:2px">' + esc(owedText(o)) + '</p></div>' +
      review +
      '<div><h3 class="sh" style="font-size:14px">Liquidación de ' + esc(fmt.monthLong(state.month)) + '</h3>' +
      (o.lines.length ? o.lines.map((l) => '<div class="ln"><span>' + esc(l.concept) + ' <small>· ' + fmt.money(l.total) + ' × ' + fmt.percent(l.coefficient) + partial(l) + '</small></span><span class="mono">' + fmt.money(l.amount, true) + '</span></div>').join('')
        : '<p class="muted">Sin gastos emitidos para este mes.</p>') +
      '<div class="ln" style="font-weight:600;border-top:1px solid rgba(0,0,80,.15);margin-top:4px"><span>Total ' + esc(fmt.monthLong(state.month)) + '</span><span class="mono">' + (row ? fmt.money(row.charge, true) : '—') + '</span></div></div>' +
      '<div><h3 class="sh" style="font-size:14px">Últimos movimientos</h3>' +
      (o.movements.length ? o.movements.map((m) => '<div class="mv"><span class="mono muted">' + esc(fmt.dateShort(m.date)) + '</span><span>' + esc(m.concept) + '</span>' +
        '<span class="mono r' + (Number(m.credit) ? ' cr' : '') + '">' + (Number(m.debit) ? fmt.money(m.debit) : Number(m.credit) ? '− ' + fmt.money(m.credit) : '') + '</span><span class="mono r">' + fmt.money(m.balance) + '</span></div>').join('')
        : '<p class="muted">Sin movimientos.</p>') +
      '<div class="acts" style="margin-top:12px;flex-wrap:wrap"><a class="btn sec sm" href="/api/v1/occupancies/' + encodeURIComponent(o.id) + '/exports/movements" download style="text-decoration:none">Cuenta corriente en Excel</a>' +
      (o.lines.length ? '<button type="button" class="btn sec sm" data-action="unit-pdf" data-occ="' + esc(o.id) + '">PDF de ' + esc(fmt.monthLong(state.month)) + '</button>' : '') + '</div></div>' +
      manage(state, view, o, rented) + '</aside>';
  };

  // ── Registrar en la cuenta: pago sin comprobante, ajuste y ocupantes ──
  const MANAGE = [['payment', 'Pago sin comprobante'], ['adjust', 'Ajuste'], ['occupants', 'Ocupantes']];
  const today = (state) => state.today;
  const field = (id, label, input) => '<div class="fld" style="grid-template-columns:1fr"><label for="' + id + '">' + label + '</label>' + input + '</div>';
  const text = (id, name, extra) => '<input class="inp" id="' + id + '" name="' + name + '" type="text" autocomplete="off"' + (extra || '') + '>';
  const date = (id, name, state) => '<input class="inp" id="' + id + '" name="' + name + '" type="date" value="' + esc(today(state)) + '" max="' + esc(today(state)) + '">';
  const submit = (label) => '<p class="ferr" data-error hidden></p><div class="pf" style="margin-top:8px"><button type="submit" class="btn pri sm">' + label + '</button></div>';

  function personFields(prefix) {
    return field(prefix + '-fn', 'Nombre', text(prefix + '-fn', 'first_name', ' maxlength="80" required')) +
      field(prefix + '-ln', 'Apellido', text(prefix + '-ln', 'last_name', ' maxlength="80" required')) +
      field(prefix + '-em', 'Correo (opcional)', '<input class="inp" id="' + prefix + '-em" name="email" type="email" maxlength="120">') +
      field(prefix + '-ph', 'Teléfono (opcional)', text(prefix + '-ph', 'phone', ' maxlength="40"'));
  }

  function manage(state, view, o, rented) {
    const tab = view.manage;
    const chips = '<div class="rl">' + MANAGE.map(([id, label]) => '<button type="button" class="ch' + (tab === id ? ' on' : '') + '" aria-pressed="' + (tab === id) + '" data-action="manage" data-manage="' + id + '">' + label + '</button>').join('') + '</div>';
    let form = '';
    if (tab === 'payment') {
      form = '<form data-form="payment" novalidate style="margin-top:12px"><p class="sub">Para pagos en efectivo o depósitos sin comprobante subido. Queda en el libro mayor con la fuente que indiques.</p>' +
        field('mp-a', 'Monto', '<input class="inp mono" id="mp-a" name="amount" inputmode="decimal" autocomplete="off" value="' + esc(Number(o.balance) > 0 ? String(o.balance).replace('.', ',') : '') + '">') +
        field('mp-d', 'Fecha del pago', date('mp-d', 'date', state)) +
        field('mp-s', 'Cómo se verificó', text('mp-s', 'source', ' maxlength="200" placeholder="Ej.: efectivo en la oficina, recibo 0231"')) +
        submit('Registrar pago') + '</form>';
    } else if (tab === 'adjust') {
      const targets = o.movements.filter((m) => ['charge', 'opening', 'surcharge'].includes(m.kind));
      form = targets.length
        ? '<form data-form="adjust" novalidate style="margin-top:12px"><p class="sub">Corrige un cargo sin tocar el original: se agrega un asiento de ajuste.</p>' +
          field('aj-e', 'Movimiento a corregir', '<select class="inp" id="aj-e" name="entry_id">' + targets.map((m) => '<option value="' + esc(m.id) + '">' + esc(fmt.dateShort(m.date) + ' · ' + m.concept + ' · ' + fmt.money(m.debit, true)) + '</option>').join('') + '</select>') +
          field('aj-k', 'Tipo', '<select class="inp" id="aj-k" name="direction"><option value="credit">A favor del residente (baja la deuda)</option><option value="debit">A cargo del residente (sube la deuda)</option></select>') +
          field('aj-a', 'Monto', '<input class="inp mono" id="aj-a" name="amount" inputmode="decimal" autocomplete="off">') +
          field('aj-t', 'Motivo', text('aj-t', 'description', ' maxlength="200" placeholder="Ej.: se cobró de más la U.T.E."')) +
          submit('Registrar ajuste') + '</form>'
        : '<p class="muted" style="margin-top:12px">No hay cargos recientes para ajustar.</p>';
    } else if (tab === 'occupants') {
      const tenant = rented ? (o.role === 'tenant' ? { id: o.id, person: o.person.name } : o.other_occupancies.find((x) => x.role === 'tenant')) : null;
      form = '<div style="margin-top:12px">' +
        (tenant ? '<form data-form="move-out" data-occ="' + esc(tenant.id) + '" novalidate><h4 class="fl">Fin del alquiler de ' + esc(tenant.person) + '</h4>' +
          field('mo-d', 'Último día', date('mo-d', 'end_date', state)) + submit('Registrar fin del alquiler') + '</form>' : '') +
        '<form data-form="tenant" data-unit="' + esc(o.unit_id) + '" data-replace="' + (tenant ? '1' : '') + '" novalidate style="margin-top:16px"><h4 class="fl">' + (tenant ? 'Cambio de inquilino' : 'Nuevo inquilino') + '</h4>' +
          personFields('nt') + field('nt-d', tenant ? 'Desde (el anterior termina el día antes)' : 'Desde', date('nt-d', 'start_date', state)) + submit('Registrar inquilino') + '</form>' +
        '<form data-form="sale" data-unit="' + esc(o.unit_id) + '" novalidate style="margin-top:16px"><h4 class="fl">Venta de la unidad</h4>' +
          personFields('sa') + field('sa-d', 'Fecha de la venta', date('sa-d', 'sale_date', state)) + submit('Registrar venta') + '</form></div>';
    }
    return '<div><h3 class="sh" style="font-size:14px">Registrar</h3>' + chips + form + '</div>';
  }

  // ── Revisión de comprobante ────────────────────────────────────────────
  /** El archivo real (D1): imagen arriba de los datos declarados, o un enlace si es PDF. */
  function filePreview(file) {
    if (!file || !file.content_type.startsWith('image/')) return '';
    return '<a href="' + esc(file.url) + '" target="_blank" rel="noopener" title="Abrir en tamaño completo"><img src="' + esc(file.url) + '" alt="Comprobante subido" style="display:block;width:100%;max-height:46vh;object-fit:contain;border-radius:10px;background:#f0f2f5;margin-bottom:12px"></a>';
  }

  function fileBlock(file) {
    if (file === undefined) return '<p class="muted" style="font-size:11px;margin-top:10px">Cargando el archivo…</p>';
    if (!file) return '<p class="muted" style="font-size:11px;margin-top:10px">El archivo no está en el almacenamiento (los comprobantes de la demo no tienen imagen).</p>';
    if (file.content_type === 'application/pdf') return '<p style="margin-top:10px"><a class="btn sec sm" href="' + esc(file.url) + '" target="_blank" rel="noopener" style="text-decoration:none">Abrir el PDF del comprobante</a></p>';
    return '<p class="muted" style="font-size:11px;margin-top:10px">Tocá la imagen para verla en tamaño completo. El enlace vence en 5 minutos.</p>';
  }

  GC.views.receiptDialog = function (state, view) {
    const r = state.receipts[view.receipt];
    const scrim = '<button type="button" class="scrim rvs" aria-label="Cerrar comprobante" data-action="close-receipt"></button>';
    const close = '<button type="button" class="x" aria-label="Cerrar" data-action="close-receipt">' + ICON.close + '</button>';
    const o = r && r.allocations.length ? state.occupancies[r.allocations[0].occupancy] : null;
    if (!r || !o) return scrim + '<div class="dlg rv" role="dialog" aria-modal="true" aria-label="Revisar comprobante"><div class="dh"><div>' + loading() + '</div>' + close + '</div></div>';

    const where = r.building + ', apto ' + r.unit + ' · ' + GC.ROLE_LABEL[r.role];
    const checks = ['El monto coincide con el saldo a cubrir', 'La cuenta de destino es la de la administración', 'La referencia aparece en el extracto bancario'];
    const data = ' data-receipt="' + esc(r.id) + '"';
    const split = r.allocations.length > 1
      ? '<p class="muted" style="font-size:12px;margin-top:8px">Reparto: ' + esc(r.allocations.map((a) => 'apto ' + a.unit + ' (' + GC.ROLE_LABEL[a.role] + ') ' + fmt.money(a.amount, true)).join(' · ')) + '</p>'
      : '';
    const pending = r.status === 'pending';
    return scrim +
      '<div class="dlg rv" role="dialog" aria-modal="true" aria-label="Revisar comprobante">' +
      '<div class="dh"><div><h2 class="title" style="font-size:22px">Comprobante de ' + esc(r.person) + '</h2><p class="muted" style="margin-top:4px;font-size:13px">' + esc(where) + ' · transferido el ' + esc(fmt.date(r.transfer_date)) + '</p></div>' + close + '</div>' +
      '<div class="rvg"><div>' + filePreview(state.receiptFiles[r.id]) + '<div class="rvdoc"><div class="rvtop"><span class="rvbank">Datos declarados</span><span class="rvok">Transferencia</span></div>' +
      '<div class="rvamt"><small>Monto transferido</small><span>' + fmt.money(r.declared_amount, true) + '</span></div>' +
      '<dl class="rvl"><div><dt>Fecha</dt><dd>' + esc(fmt.date(r.transfer_date)) + '</dd></div><div><dt>Origen</dt><dd>' + esc(r.person) + '</dd></div>' +
      '<div><dt>Destino</dt><dd>' + esc(state.company.name) + '</dd></div><div><dt>Nota</dt><dd>' + esc(r.note || '—') + '</dd></div></dl></div>' +
      fileBlock(state.receiptFiles[r.id]) + split + '</div>' +
      '<div class="rvr"><div><div class="fl">Debe cubrir</div><div class="big" style="margin-top:2px">' + fmt.money(o.balance, true) + '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:2px">' + esc(owedText(o)) + '</p></div>' +
      (pending
        ? '<fieldset class="chk"><legend class="fl">Antes de aprobar</legend>' + checks.map((c, i) => '<label class="ck"><input type="checkbox" id="k' + i + '"><span>' + c + '</span></label>').join('') + '</fieldset>' +
          '<div class="fld" style="grid-template-columns:1fr"><label for="rv-reason">Motivo, si lo rechazás (lo ve el residente)</label><input class="inp" id="rv-reason" name="reason" type="text" maxlength="200" placeholder="Ej.: el monto no coincide con la transferencia"></div>' +
          '<div class="pf" style="margin-top:auto"><button type="button" class="btn sec" data-action="reject"' + data + '>Rechazar</button><button type="button" class="btn pri" data-action="validate"' + data + '>Aprobar comprobante</button></div>'
        : '<p style="margin-top:auto">' + GC.views.pill(r.status === 'approved' ? 'pagado' : 'moroso', r.status === 'approved' ? 'Aprobado' : 'Rechazado') + '</p>') +
      '</div></div></div>';
  };

  // ── Diálogo de gastos ──────────────────────────────────────────────────
  function nextMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
  }

  GC.views.defaultExpenseMonth = function (state, d) {
    const months = d.settlements.map((s) => s.month).sort();
    if (!months.includes(state.month)) return state.month;
    const draft = d.settlements.find((s) => s.status !== 'issued');
    if (draft) return draft.month;
    return nextMonth(months[months.length - 1]);
  };

  /** El concepto que lleva la aclaración (cuota extraordinaria: solo propietario y no es fondo de reserva). */
  const detailConcept = (d) => d.concepts.find((c) => c.kind === 'owner_only' && !c.is_reserve_fund);
  /** Muestra "4200" en vez de "4200.00" en el campo. */
  const plain = (amount) => String(amount).replace(/\.00$/, '');

  GC.views.expenseDialog = function (state, view) {
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const d = state.detail[view.buildingId];
    const month = view.dialog.month;
    const existing = d.settlements.find((s) => s.month === month);
    const last = d.settlements.slice().sort((x, y) => y.month.localeCompare(x.month))[0];
    const base = existing || last;
    const amounts = base ? Object.fromEntries(base.items.map((it) => [it.concept_id, it])) : {};
    const extra = detailConcept(d);
    const fields = d.concepts.map((c) => {
      const isExtra = extra && c.id === extra.id;
      const value = amounts[c.id] && (existing || !isExtra) ? plain(amounts[c.id].amount) : '0';
      return '<div class="fld"><label for="f-' + esc(c.id) + '">' + esc(c.name) + '</label><input class="inp mono" id="f-' + esc(c.id) + '" name="' + esc(c.id) + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(value) + '"></div>';
    }).join('');
    const note = existing && extra && amounts[extra.id] ? amounts[extra.id].detail : '';

    return '<button type="button" class="scrim" aria-label="Cerrar" data-action="close-overlay"></button>' +
      '<form class="dlg" role="dialog" aria-modal="true" aria-label="Gastos del mes" data-form="expense" novalidate>' +
      '<div class="dh"><div><h2 class="title" style="font-size:22px">Gastos del mes</h2><p class="muted" style="margin-top:4px;font-size:13px">' + esc(b.name) + ' · ' +
      (existing ? 'editando el borrador con los montos guardados.' : 'se precargan los montos del último mes como referencia.') + '</p></div>' +
      '<button type="button" class="x" aria-label="Cerrar" data-action="close-overlay">' + ICON.close + '</button></div>' +
      '<div class="ef"><div><div class="fld" style="grid-template-columns:1fr"><label for="x-m">Mes</label><input class="inp" id="x-m" name="month" type="month" value="' + esc(month) + '" required></div>' + fields +
      (extra ? '<div class="fld" style="grid-template-columns:1fr;margin-top:14px"><label for="x-n">Detalle de la ' + esc(extra.name.toLowerCase()) + '</label><input class="inp" id="x-n" name="detail" type="text" maxlength="140" value="' + esc(note) + '" placeholder="Ej.: pintura de fachada"></div>' : '') +
      '<p class="ferr" data-error hidden></p></div>' +
      '<div><h3 class="sh" style="font-size:14px">Prorrateo por coeficiente</h3><p class="sub">Estimado de cómo queda cada unidad. El reparto exacto (con redondeo) lo hace el sistema al emitir.</p><div data-preview></div></div></div>' +
      '<div class="pf"><button type="button" class="btn sec" data-action="close-overlay">Cancelar</button><button type="submit" class="btn pri">Guardar borrador</button></div></form>';
  };

  /** Lee el formulario. Devuelve { month, items } listo para la API (montos como texto) o { error }. */
  GC.views.readExpenseForm = function (form, state, d) {
    const data = new FormData(form);
    const month = String(data.get('month') || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'Elegí el mes de la liquidación.' };
    const existing = d.settlements.find((s) => s.month === month);
    if (existing && existing.status === 'issued') {
      return { error: fmt.monthTitle(month) + ' ya fue emitido y no se puede modificar. Registrá un ajuste.' };
    }
    const extra = detailConcept(d);
    const items = {};
    for (const c of d.concepts) {
      const raw = String(data.get(c.id) || '').trim().replace(',', '.') || '0';
      if (!AMOUNT_RE.test(raw)) return { error: c.name + ': ingresá un monto válido (0 o más, hasta 2 decimales).' };
      items[c.id] = { amount: raw };
      if (extra && c.id === extra.id) items[c.id].detail = String(data.get('detail') || '').trim().slice(0, 140);
    }
    return { month, items };
  };

  /** Vista previa del reparto. Es solo visual: no se envía; el backend calcula los cargos al emitir. */
  GC.views.expensePreview = function (state, d, form) {
    const data = new FormData(form);
    const value = (id) => Math.max(Number(String(data.get(id) || '0').replace(',', '.')) || 0, 0);
    const ordinary = d.concepts.filter((c) => c.kind === 'ordinary').reduce((s, c) => s + value(c.id), 0);
    const ownerOnly = d.concepts.filter((c) => c.kind !== 'ordinary').reduce((s, c) => s + value(c.id), 0);
    let totalTenant = 0;
    let totalOwner = 0;
    const units = d.units.slice().sort((x, y) => x.number.localeCompare(y.number, 'es', { numeric: true }));
    const rows = units.map((u) => {
      const coef = Number(u.coefficient);
      const rented = GC.views.hasTenant(d.accounts, u.number);
      const tenant = rented ? ordinary * coef : 0;
      const owner = ownerOnly * coef + (rented ? 0 : ordinary * coef);
      totalTenant += tenant;
      totalOwner += owner;
      return '<div class="pv"><span class="mono">' + esc(u.number) + '</span><span class="mono r">' + (rented ? fmt.money(tenant) : '—') + '</span><span class="mono r">' + fmt.money(owner) + '</span><span class="mono r" style="font-weight:600">' + fmt.money(tenant + owner) + '</span></div>';
    }).join('');
    const total = ordinary + ownerOnly;
    const diff = Math.round(total - totalTenant - totalOwner);
    return '<div class="pv hd"><span>Unidad</span><span class="r">Inquilino</span><span class="r">Propietario</span><span class="r">Total</span></div>' + rows +
      '<div class="tot"><span>Total distribuido</span><span class="mono">' + fmt.money(totalTenant + totalOwner) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin-top:6px">' + (Math.abs(diff) <= 1 ? 'Coincide con el total cargado (' + fmt.money(total) + ').' : '<span style="color:#98140b">Diferencia de ' + fmt.money(diff) + ' contra el total: revisá los coeficientes.</span>') + '</p>';
  };
})(window.GC);
