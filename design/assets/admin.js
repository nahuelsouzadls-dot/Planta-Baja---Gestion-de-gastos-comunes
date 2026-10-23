/* Controlador del panel de administración: ruteo por hash, eventos y acciones. */
(function (GC) {
  'use strict';

  const L = GC.ledger;
  const store = GC.store;
  const TABS = ['cobros', 'resumen', 'gastos', 'comunicaciones'];
  const DEFAULT_TASKS = [
    { id: 'k1', bid: 'minas', text: 'Llamar al plomero por la humedad del 2.º piso', due: '2026-10-22', done: false },
    { id: 'k2', bid: 'centro', text: 'Confirmar la cuota extraordinaria con el consejo', due: '2026-10-28', done: false },
    { id: 'k3', bid: 'pocitos', text: 'Pedir presupuesto de pintura de fachada', due: '', done: false },
  ];

  const app = document.querySelector('.app');
  const side = document.querySelector('.side');
  const main = document.querySelector('.main');
  const overlay = document.querySelector('[data-overlay]');

  function storedTheme() {
    try { return localStorage.getItem('gc-theme') || 'lagoon'; } catch (err) { return 'lagoon'; }
  }

  let view = {
    route: 'home',
    buildingId: null,
    tab: 'cobros',
    filter: 'todos',
    query: '',
    commSub: 'avisos',
    threadId: null,
    drawer: null,
    dialog: null,
    receipt: null,
    theme: storedTheme(),
    themeOpen: false,
    nav: false,
    panel: null,
    taskFilter: 'all',
  };
  let lastFocus = null;

  const tasksOf = (state) => state.tasks || DEFAULT_TASKS;

  // ── Ruteo ──────────────────────────────────────────────────────────────
  function readHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const state = store.get();
    if (parts[0] === 'edificio' && state.buildings.some((b) => b.id === parts[1])) {
      const tab = TABS.includes(parts[2]) ? parts[2] : 'cobros';
      const changed = view.buildingId !== parts[1];
      view = { ...view, route: 'building', buildingId: parts[1], tab, ...(changed ? { filter: 'todos', threadId: null } : {}) };
    } else {
      view = { ...view, route: 'home', buildingId: null };
    }
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    const state = store.get();
    const searching = document.activeElement && document.activeElement.matches('[data-action="search"]');
    const caret = searching ? document.activeElement.selectionStart : 0;

    app.dataset.theme = view.theme;
    side.className = 'side' + (view.nav ? ' open' : '');
    side.innerHTML = GC.views.side(state, view);
    main.innerHTML = GC.views.topbar(state, view) + '<div class="cols"><div class="col">' +
      (view.route === 'home' ? GC.views.home(state, view) : GC.views.building(state, view)) + '</div>' +
      GC.views.fabs(state, view, tasksOf(state)) + '</div>';
    document.title = (view.route === 'home' ? 'Cartera' : state.buildings.find((b) => b.id === view.buildingId).name) + ' · Administración GC';

    if (searching) {
      const input = main.querySelector('[data-action="search"]');
      input.focus();
      input.setSelectionRange(caret, caret);
    }
    renderOverlay();
  }

  function renderOverlay() {
    const state = store.get();
    let html = '';
    if (view.drawer) html = GC.views.drawer(state, view);
    else if (view.dialog) html = GC.views.expenseDialog(state, view);
    if (view.receipt) html += GC.views.receiptDialog(state, view);
    overlay.innerHTML = html;
    document.body.style.overflow = html ? 'hidden' : '';
    if (view.dialog) refreshPreview();
  }

  function openOverlay(patch) {
    const wasOpen = Boolean(view.drawer || view.dialog || view.receipt);
    if (!wasOpen) lastFocus = document.activeElement;
    view = { ...view, ...patch };
    renderOverlay();
    const dialogs = overlay.querySelectorAll('[role="dialog"]');
    const top = dialogs[dialogs.length - 1];
    const target = top && top.querySelector('input:not([type="checkbox"]), .x');
    if (target) target.focus();
  }

  function closeOverlay() {
    view = { ...view, drawer: null, dialog: null, receipt: null };
    renderOverlay();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function refreshPreview() {
    const form = overlay.querySelector('[data-form="expense"]');
    if (!form) return;
    const building = store.get().buildings.find((b) => b.id === view.buildingId);
    const result = GC.views.readExpenseForm(form, store.get(), building);
    const preview = form.querySelector('[data-preview]');
    const fallback = { month: '', ose: 0, ute: 0, cleaning: 0, fees: 0, reserve: 0, extraordinary: 0 };
    const exp = result.expense || Object.fromEntries(Object.keys(fallback).map((k) => [k, Math.max(Number(new FormData(form).get(k)) || 0, 0)]));
    preview.innerHTML = GC.views.expensePreview(building, exp);
  }

  // ── Acciones ───────────────────────────────────────────────────────────
  function buildingIdFor(el) {
    return el.dataset.building || view.buildingId;
  }

  function personFor(buildingId, key) {
    const b = store.get().buildings.find((x) => x.id === buildingId);
    const [n, role] = key.split(':');
    const unit = L.unit(b, n);
    return { b, unit, person: role === 'tenant' ? unit.tenant : unit.owner };
  }

  function updateTasks(fn) {
    store.update((s) => ({ ...s, tasks: fn(tasksOf(s)) }));
  }

  const actions = {
    'go-home': () => go('#/'),
    'open-building': (el) => go('#/edificio/' + el.dataset.id + '/cobros'),
    tab: (el) => go('#/edificio/' + view.buildingId + '/' + el.dataset.tab),
    filter: (el) => {
      view = { ...view, filter: el.dataset.filter };
      render();
    },
    'open-unit': (el) => openOverlay({ drawer: el.dataset.key, dialog: null }),
    'close-overlay': closeOverlay,
    'open-receipt': (el) => openOverlay({ receipt: { buildingId: buildingIdFor(el), key: el.dataset.key } }),
    'close-receipt': () => {
      view = { ...view, receipt: null };
      renderOverlay();
    },
    validate: (el) => {
      const buildingId = buildingIdFor(el);
      const { b, unit, person } = personFor(buildingId, el.dataset.key);
      view = { ...view, receipt: null };
      store.update((s) => L.validatePayment(s, buildingId, el.dataset.key));
      GC.toast('Pago validado: ' + person.name + ', apto ' + unit.n + ' (' + b.name + ')');
    },
    reject: (el) => {
      const buildingId = buildingIdFor(el);
      const { unit, person } = personFor(buildingId, el.dataset.key);
      view = { ...view, receipt: null };
      store.update((s) => L.rejectPayment(s, buildingId, el.dataset.key, 'no coincide con la cuenta'));
      GC.toast('Comprobante rechazado. Se avisa a ' + person.name + ' (apto ' + unit.n + ')', 'warn');
    },
    'open-expense': (el) => {
      const b = store.get().buildings.find((x) => x.id === view.buildingId);
      openOverlay({ drawer: null, dialog: { month: el.dataset.month || GC.views.defaultExpenseMonth(store.get(), b) } });
    },
    'issue-expense': (el) => {
      store.update((s) => L.issueExpense(s, view.buildingId, el.dataset.month));
      GC.toast('Liquidación de ' + GC.fmt.monthLong(el.dataset.month) + ' emitida a los residentes');
    },
    'comm-sub': (el) => {
      view = { ...view, commSub: el.dataset.sub };
      render();
    },
    'open-thread': (el) => {
      view = { ...view, threadId: el.dataset.id };
      render();
    },
    'export-csv': exportCsv,
    'reset-demo': () => {
      store.reset();
      GC.toast('Datos de demo restablecidos');
    },
    'toggle-nav': () => {
      view = { ...view, nav: !view.nav };
      render();
    },
    'theme-toggle': () => {
      view = { ...view, themeOpen: !view.themeOpen };
      render();
    },
    theme: (el) => {
      try { localStorage.setItem('gc-theme', el.dataset.themeId); } catch (err) { /* sin almacenamiento: el tema dura la sesión */ }
      view = { ...view, theme: el.dataset.themeId, themeOpen: false };
      render();
    },
    panel: (el) => {
      view = { ...view, panel: view.panel === el.dataset.panel ? null : el.dataset.panel };
      render();
    },
    'go-review': () => {
      const first = GC.views.queueOf(store.get())[0];
      view = { ...view, panel: null };
      if (!first) return go('#/');
      openOverlay({ receipt: { buildingId: first.b.id, key: first.a.key } });
    },
    'shortcut-load': (el) => {
      // pushState no dispara hashchange, que cerraría el diálogo recién abierto.
      history.pushState(null, '', '#/edificio/' + el.dataset.id + '/cobros');
      readHash();
      view = { ...view, panel: null };
      render();
      const b = store.get().buildings.find((x) => x.id === el.dataset.id);
      openOverlay({ dialog: { month: GC.views.defaultExpenseMonth(store.get(), b) } });
    },
    'shortcut-moro': (el) => {
      view = { ...view, panel: null };
      go('#/edificio/' + el.dataset.id + '/resumen');
    },
    'task-toggle': (el) => updateTasks((list) => list.map((t) => (t.id === el.dataset.id ? { ...t, done: !t.done } : t))),
    'task-filter': (el) => {
      view = { ...view, taskFilter: el.dataset.id };
      render();
    },
  };

  function exportCsv() {
    const state = store.get();
    const b = state.buildings.find((x) => x.id === view.buildingId);
    const header = ['Unidad', 'Piso', 'Coeficiente', 'Rol', 'Responsable', 'Teléfono', 'Email', 'Cargo del mes', 'Saldo', 'Estado', 'Meses adeudados'];
    const rows = L.accounts(state, b).map((a) => [a.unit.n, a.unit.floor, a.unit.coef, GC.ROLE_LABEL[a.role], a.person.name, a.person.phone, a.person.email,
      a.currentCharge.toFixed(2).replace('.', ','), a.balance.toFixed(2).replace('.', ','), GC.STATUS_LABEL[a.status], a.unpaid.map((m) => m.month).join(' ')]);
    const csv = [header].concat(rows)
      .map((r) => r.map((v) => {
        const s = String(v);
        // Evita inyección de fórmulas al abrir en Excel.
        const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
        return '"' + safe.replace(/"/g, '""') + '"';
      }).join(';'))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'cobros-' + b.id + '-' + state.currentMonth + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    GC.toast('Planilla exportada: ' + link.download);
  }

  // ── Formularios ────────────────────────────────────────────────────────
  function showError(form, message) {
    const el = form.querySelector('[data-error]');
    el.textContent = message;
    el.hidden = !message;
  }

  const forms = {
    notice(form) {
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const body = String(data.get('body') || '').trim();
      if (title.length < 3) return showError(form, 'El asunto necesita al menos 3 caracteres.');
      if (body.length < 10) return showError(form, 'El mensaje es muy corto.');
      store.update((s) => L.addNotice(s, view.buildingId, title, body));
      GC.toast('Aviso publicado');
    },
    reply(form) {
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) return;
      const state = store.get();
      view = { ...view, threadId: form.dataset.id };
      store.update((s) => L.reply(s, view.buildingId, form.dataset.id, { from: 'admin', name: state.company.name, date: state.today, text }));
      const input = main.querySelector('#reply');
      if (input) input.focus();
    },
    expense(form) {
      const state = store.get();
      const building = state.buildings.find((b) => b.id === view.buildingId);
      const result = GC.views.readExpenseForm(form, state, building);
      if (result.error) return showError(form, result.error);
      view = { ...view, dialog: null };
      store.update((s) => L.saveExpense(s, view.buildingId, result.expense));
      GC.toast('Borrador de ' + GC.fmt.monthLong(result.expense.month) + ' guardado. Emitilo cuando esté listo.');
    },
    task(form) {
      const data = new FormData(form);
      const text = String(data.get('text') || '').trim().slice(0, 90);
      if (!text) return;
      const bid = view.route === 'building' ? view.buildingId : String(data.get('bid'));
      updateTasks((list) => list.concat({ id: GC.uid('k'), bid, text, due: '', done: false }));
    },
  };

  // ── Eventos ────────────────────────────────────────────────────────────
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (view.themeOpen && !event.target.closest('.thw')) {
      view = { ...view, themeOpen: false };
      if (!el) return render();
    }
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const action = actions[el.dataset.action];
    if (!action) return;
    event.preventDefault();
    action(el);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (view.receipt) actions['close-receipt']();
    else if (view.drawer || view.dialog) closeOverlay();
    else if (view.themeOpen || view.panel) {
      view = { ...view, themeOpen: false, panel: null };
      render();
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    forms[form.dataset.form](form);
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-action="search"]')) {
      view = { ...view, query: event.target.value.slice(0, 60) };
      render();
    } else if (event.target.closest('[data-form="expense"]')) {
      refreshPreview();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-action="thread-status"]')) {
      view = { ...view, threadId: event.target.dataset.id };
      store.update((s) => L.setThreadStatus(s, view.buildingId, event.target.dataset.id, event.target.value));
      GC.toast('Estado actualizado');
    }
  });

  window.addEventListener('hashchange', () => {
    readHash();
    view = { ...view, drawer: null, dialog: null };
    render();
    window.scrollTo(0, 0);
  });

  // El tema se comparte con el portal (otra pestaña).
  window.addEventListener('storage', (event) => {
    if (event.key === 'gc-theme') {
      view = { ...view, theme: event.newValue || 'lagoon' };
      render();
    }
  });

  store.subscribe(render);
  readHash();
  render();
})(window.GC);
