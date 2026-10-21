/* Controlador del panel de administración: ruteo por hash, eventos y acciones. */
(function (GC) {
  'use strict';

  const L = GC.ledger;
  const store = GC.store;
  const TABS = ['cobros', 'resumen', 'gastos', 'comunicaciones'];

  const app = document.querySelector('.app');
  const side = document.querySelector('.side');
  const sheet = document.querySelector('.sheet');
  const overlay = document.querySelector('[data-overlay]');

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
  };
  let lastFocus = null;

  // ── Ruteo ──────────────────────────────────────────────────────────────
  function readHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const state = store.get();
    if (parts[0] === 'edificio' && state.buildings.some((b) => b.id === parts[1])) {
      const tab = TABS.includes(parts[2]) ? parts[2] : 'cobros';
      const changed = view.buildingId !== parts[1];
      view = { ...view, route: 'building', buildingId: parts[1], tab, ...(changed ? { filter: 'todos', query: '', threadId: null } : {}) };
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
    side.innerHTML = GC.views.side(state, view);
    sheet.innerHTML = view.route === 'home' ? GC.views.home(state) : GC.views.building(state, view);
    document.title = (view.route === 'home' ? 'Cartera' : state.buildings.find((b) => b.id === view.buildingId).name) + ' · Administración GC';
    renderOverlay();
  }

  function renderOverlay() {
    const state = store.get();
    if (view.drawer) overlay.innerHTML = GC.views.drawer(state, view);
    else if (view.dialog) overlay.innerHTML = GC.views.expenseDialog(state, view);
    else overlay.innerHTML = '';
    document.body.style.overflow = view.drawer || view.dialog ? 'hidden' : '';
    if (view.dialog) refreshPreview();
  }

  function openOverlay(patch) {
    const wasOpen = Boolean(view.drawer || view.dialog);
    if (!wasOpen) lastFocus = document.activeElement;
    view = { ...view, ...patch };
    renderOverlay();
    if (!wasOpen) {
      const target = overlay.querySelector('[role="dialog"] input, [role="dialog"] .icon-btn');
      if (target) target.focus();
    }
  }

  function closeOverlay() {
    view = { ...view, drawer: null, dialog: null };
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

  const actions = {
    'go-home': () => go('#/'),
    'open-building': (el) => go('#/edificio/' + el.dataset.id + '/cobros'),
    tab: (el) => go('#/edificio/' + view.buildingId + '/' + el.dataset.tab),
    filter: (el) => {
      view = { ...view, filter: el.dataset.filter };
      render();
    },
    'open-unit': (el) => openOverlay({ drawer: el.dataset.key }),
    'drawer-role': (el) => openOverlay({ drawer: el.dataset.key }),
    'close-overlay': closeOverlay,
    validate: (el) => {
      const buildingId = buildingIdFor(el);
      const { b, unit, person } = personFor(buildingId, el.dataset.key);
      store.update((s) => L.validatePayment(s, buildingId, el.dataset.key));
      GC.toast('Pago validado: ' + person.name + ', apto ' + unit.n + ' (' + b.name + ')');
    },
    reject: (el) => {
      const buildingId = buildingIdFor(el);
      const { unit, person } = personFor(buildingId, el.dataset.key);
      store.update((s) => L.rejectPayment(s, buildingId, el.dataset.key, 'no coincide con la cuenta'));
      GC.toast('Comprobante rechazado. Se avisa a ' + person.name + ' (apto ' + unit.n + ')', 'warn');
    },
    'open-expense': (el) => {
      const b = store.get().buildings.find((x) => x.id === view.buildingId);
      openOverlay({ dialog: { month: el.dataset.month || GC.views.defaultExpenseMonth(store.get(), b) } });
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
    'toggle-menu': () => {
      app.dataset.menu = app.dataset.menu === 'open' ? '' : 'open';
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
      store.update((s) => L.reply(s, view.buildingId, form.dataset.id, { from: 'admin', name: state.company.name, date: state.today, text }));
      view = { ...view, threadId: form.dataset.id };
      render();
      const input = sheet.querySelector('#reply');
      if (input) input.focus();
    },
    expense(form) {
      const state = store.get();
      const building = state.buildings.find((b) => b.id === view.buildingId);
      const result = GC.views.readExpenseForm(form, state, building);
      if (result.error) return showError(form, result.error);
      store.update((s) => L.saveExpense(s, view.buildingId, result.expense));
      closeOverlay();
      GC.toast('Borrador de ' + GC.fmt.monthLong(result.expense.month) + ' guardado. Emitilo cuando esté listo.');
    },
  };

  // ── Eventos ────────────────────────────────────────────────────────────
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const action = actions[el.dataset.action];
    if (!action) return;
    if (el.closest('.row-actions, .queue-item__actions, .receipt')) event.stopPropagation();
    event.preventDefault();
    if (el.closest('.side') && window.matchMedia('(max-width: 860px)').matches) app.dataset.menu = '';
    action(el);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (view.drawer || view.dialog)) closeOverlay();
    const row = event.target.closest && event.target.closest('tr[data-action="open-unit"]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      actions['open-unit'](row);
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
      const pos = event.target.selectionStart;
      render();
      const input = sheet.querySelector('[data-action="search"]');
      input.focus();
      input.setSelectionRange(pos, pos);
    } else if (event.target.closest('[data-form="expense"]')) {
      refreshPreview();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-action="thread-status"]')) {
      store.update((s) => L.setThreadStatus(s, view.buildingId, event.target.dataset.id, event.target.value));
      view = { ...view, threadId: event.target.dataset.id };
      GC.toast('Estado actualizado');
    }
  });

  window.addEventListener('hashchange', () => {
    readHash();
    view = { ...view, drawer: null, dialog: null };
    render();
    window.scrollTo(0, 0);
  });

  store.subscribe(render);
  readHash();
  render();
})(window.GC);
