/* Controlador del panel de administración: ruteo por hash, datos de la API, eventos y acciones. */
(function (GC) {
  'use strict';

  const api = GC.api;
  const TABS = ['cobros', 'resumen', 'gastos', 'comunicaciones'];
  const ORG_KEY = 'gc-org';

  const app = document.querySelector('.app');
  const side = document.querySelector('.side');
  const main = document.querySelector('.main');
  const overlay = document.querySelector('[data-overlay]');

  function storedTheme() {
    try { return localStorage.getItem('gc-theme') || 'lagoon'; } catch (err) { return 'lagoon'; }
  }

  function localToday() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
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
    manage: null,
  };

  /** Lo que devolvió la API. Las vistas lo leen tal cual; nada se calcula acá. */
  const state = {
    ready: false,
    error: '',
    orgs: [],
    orgId: null,
    company: { name: '' },
    userName: '',
    month: localToday().slice(0, 7),
    today: localToday(),
    totals: null,
    buildings: [],
    queue: [],
    tasks: [],
    history: null,
    detail: {},
    claims: {},
    occupancies: {},
    receipts: {},
    receiptFiles: {},
  };

  let lastFocus = null;
  let lastScreen = null;

  // ── Datos ──────────────────────────────────────────────────────────────
  const org = (path) => 'organizations/' + state.orgId + '/' + path;

  async function loadPortfolio() {
    const data = await api.get(org('portfolio'));
    state.month = data.month;
    state.totals = data.portfolio_totals;
    state.buildings = data.buildings;
    state.queue = data.receipt_queue;
  }

  async function loadTasks() {
    state.tasks = (await api.get(org('tasks'))).tasks;
  }

  async function loadHistory() {
    state.history = (await api.get(org('collection-history'))).months;
  }

  async function loadBuilding(id) {
    const base = 'buildings/' + id;
    const [detail, accounts, summary, settlements, notices, claims] = await Promise.all([
      api.get(base), api.get(base + '/accounts'), api.get(base + '/summary'),
      api.get(base + '/settlements'), api.get(base + '/notices'), api.get(base + '/claims'),
    ]);
    state.detail[id] = {
      units: detail.units,
      accounts: accounts.accounts,
      summary,
      settlements: settlements.settlements,
      concepts: settlements.concepts,
      notices: notices.notices,
      claims: claims.claims,
    };
    return state.detail[id];
  }

  async function loadClaim(id) {
    state.claims[id] = await api.get('claims/' + id);
  }

  async function loadOccupancy(id) {
    state.occupancies[id] = await api.get('occupancies/' + id);
    return state.occupancies[id];
  }

  async function loadReceipt(id) {
    const receipt = await api.get('receipts/' + id);
    const first = receipt.allocations[0];
    const [file] = await Promise.all([
      api.get('receipts/' + id + '/file', { noRedirect: true }).catch(() => null),
      first && !state.occupancies[first.occupancy] ? loadOccupancy(first.occupancy) : null,
    ]);
    state.receiptFiles[id] = file;
    state.receipts[id] = receipt;
  }

  /** Después de escribir: se vuelve a pedir lo que se ve en pantalla. */
  async function refresh() {
    state.occupancies = {};
    state.receipts = {};
    state.receiptFiles = {};
    state.claims = {};
    state.history = null;
    const jobs = [loadPortfolio(), loadTasks()];
    if (view.buildingId) jobs.push(loadBuilding(view.buildingId));
    await Promise.all(jobs);
    if (view.drawer) await loadOccupancy(view.drawer);
  }

  // Carga perezosa de lo que la pantalla actual necesita y todavía no está.
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
    if (view.route === 'building' && !state.detail[view.buildingId]) {
      const id = view.buildingId;
      ensure('b:' + id, () => loadBuilding(id));
    }
    const d = state.detail[view.buildingId];
    if (view.route === 'building' && view.tab === 'comunicaciones' && view.commSub === 'hilos' && d && d.claims.length) {
      const id = view.threadId && d.claims.some((c) => c.id === view.threadId) ? view.threadId : d.claims[0].id;
      if (!state.claims[id]) ensure('c:' + id, () => loadClaim(id));
    }
    if (view.drawer && !state.occupancies[view.drawer]) {
      const id = view.drawer;
      ensure('o:' + id, () => loadOccupancy(id));
    }
    if (view.receipt && !state.receipts[view.receipt]) {
      const id = view.receipt;
      ensure('r:' + id, () => loadReceipt(id));
    }
    if (view.panel === 'ch' && !state.history) ensure('history', loadHistory);
  }

  /** Ejecuta una acción contra la API; si falla, muestra el mensaje del backend. */
  async function attempt(fn) {
    try {
      await fn();
    } catch (err) {
      GC.toast(err.message, 'warn');
    }
  }

  // ── Ruteo ──────────────────────────────────────────────────────────────
  function readHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
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
    app.dataset.theme = view.theme;
    if (!state.ready) {
      side.innerHTML = '<span class="glass" aria-hidden="true"></span>';
      main.innerHTML = '<div class="cols"><div class="col">' + (state.error
        ? '<p class="empty">' + GC.esc(state.error) + '</p><button type="button" class="btn pri" data-action="retry">Reintentar</button>'
        : GC.views.loading()) + '</div></div>';
      return;
    }
    const searching = document.activeElement && document.activeElement.matches('[data-action="search"]');
    const caret = searching ? document.activeElement.selectionStart : 0;

    side.className = 'side' + (view.nav ? ' open' : '');
    side.innerHTML = GC.views.side(state, view);
    main.innerHTML = GC.views.topbar(state, view) + '<div class="cols"><div class="col">' +
      (view.route === 'home' ? GC.views.home(state, view) : GC.views.building(state, view)) + '</div>' +
      GC.views.fabs(state, view) + '</div>';
    const building = state.buildings.find((b) => b.id === view.buildingId);
    document.title = (view.route === 'home' ? 'Cartera' : building.name) + ' · Administración GC';

    // Animar la entrada solo al cambiar de pantalla, no en cada actualización de datos.
    const screen = view.route + ':' + view.buildingId + ':' + view.tab;
    if (screen !== lastScreen) main.querySelector('.col').classList.add('enter');
    lastScreen = screen;

    if (searching) {
      const input = main.querySelector('[data-action="search"]');
      input.focus();
      input.setSelectionRange(caret, caret);
    }
    renderOverlay();
    needs();
  }

  function renderOverlay() {
    let html = '';
    if (view.drawer) html = GC.views.drawer(state, view);
    else if (view.dialog) html = GC.views.expenseDialog(state, view);
    if (view.receipt) html += GC.views.receiptDialog(state, view);
    // Si solo cambiaron los datos, no se pisa lo que la persona está escribiendo en el formulario.
    const typing = overlay.querySelector('[data-form="expense"]') && view.dialog && !view.receipt;
    if (!typing || !html.includes('data-form="expense"')) overlay.innerHTML = html;
    document.body.style.overflow = html ? 'hidden' : '';
    if (view.dialog) refreshPreview();
  }

  function openOverlay(patch) {
    const wasOpen = Boolean(view.drawer || view.dialog || view.receipt);
    if (!wasOpen) lastFocus = document.activeElement;
    view = { ...view, ...patch };
    overlay.innerHTML = '';
    renderOverlay();
    needs();
    const dialogs = overlay.querySelectorAll('[role="dialog"]');
    const top = dialogs[dialogs.length - 1];
    const target = top && top.querySelector('input:not([type="checkbox"]), .x');
    if (target) target.focus();
  }

  function closeOverlay() {
    view = { ...view, drawer: null, dialog: null, receipt: null };
    overlay.innerHTML = '';
    renderOverlay();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function refreshPreview() {
    const form = overlay.querySelector('[data-form="expense"]');
    if (!form) return;
    form.querySelector('[data-preview]').innerHTML = GC.views.expensePreview(state, state.detail[view.buildingId], form);
  }

  // ── Acciones ───────────────────────────────────────────────────────────
  function receiptLabel(id) {
    const r = state.receipts[id];
    return r ? r.person + ', apto ' + r.unit + ' (' + r.building + ')' : '';
  }

  async function openExpense(month) {
    const d = state.detail[view.buildingId] || await loadBuilding(view.buildingId);
    openOverlay({ drawer: null, dialog: { month: month || GC.views.defaultExpenseMonth(state, d) } });
  }

  const actions = {
    retry: () => start(),
    logout: () => api.logout(),
    'go-home': () => go('#/'),
    'open-building': (el) => go('#/edificio/' + el.dataset.id + '/cobros'),
    tab: (el) => go('#/edificio/' + view.buildingId + '/' + el.dataset.tab),
    filter: (el) => {
      view = { ...view, filter: el.dataset.filter };
      render();
    },
    'open-unit': (el) => {
      if (el.dataset.occ) openOverlay({ drawer: el.dataset.occ, dialog: null, manage: null });
    },
    manage: (el) => {
      view = { ...view, manage: view.manage === el.dataset.manage ? null : el.dataset.manage };
      renderOverlay();
    },
    'unit-pdf': (el) => attempt(() => GC.openSigned(api.get('occupancies/' + el.dataset.occ + '/settlements/' + state.month + '/pdf'))),
    'settlement-pdf': (el) => attempt(() => GC.openSigned(api.get('buildings/' + view.buildingId + '/settlements/' + el.dataset.month + '/pdf'))),
    'close-overlay': closeOverlay,
    'open-receipt': (el) => attempt(async () => {
      let id = el.dataset.receipt;
      if (!id) {
        const o = state.occupancies[el.dataset.occ] || await loadOccupancy(el.dataset.occ);
        if (!o.pending_receipt) return GC.toast('Esta cuenta ya no tiene comprobantes en revisión.');
        id = o.pending_receipt.id;
      }
      openOverlay({ receipt: id });
    }),
    'close-receipt': () => {
      view = { ...view, receipt: null };
      renderOverlay();
    },
    validate: (el) => attempt(async () => {
      const who = receiptLabel(el.dataset.receipt);
      await api.post('receipts/' + el.dataset.receipt + '/approve', {});
      view = { ...view, receipt: null };
      await refresh();
      render();
      GC.toast('Pago validado: ' + who);
    }),
    reject: (el) => attempt(async () => {
      const r = state.receipts[el.dataset.receipt];
      const input = overlay.querySelector('#rv-reason');
      const reason = input ? input.value.trim() : '';
      if (!reason) {
        if (input) input.focus();
        return GC.toast('Escribí el motivo del rechazo: el residente lo ve en su portal.', 'warn');
      }
      await api.post('receipts/' + el.dataset.receipt + '/reject', { reason });
      view = { ...view, receipt: null };
      await refresh();
      render();
      GC.toast('Comprobante rechazado. Se avisa a ' + (r ? r.person + ' (apto ' + r.unit + ')' : 'la persona'), 'warn');
    }),
    'open-expense': (el) => attempt(() => openExpense(el.dataset.month)),
    'issue-expense': (el) => attempt(async () => {
      const month = el.dataset.month;
      await api.post('buildings/' + view.buildingId + '/settlements/' + month + '/issue', {});
      await refresh();
      render();
      GC.toast('Liquidación de ' + GC.fmt.monthLong(month) + ' emitida a los residentes');
    }),
    'comm-sub': (el) => {
      view = { ...view, commSub: el.dataset.sub };
      render();
    },
    'open-thread': (el) => {
      view = { ...view, threadId: el.dataset.id };
      render();
    },
    'export-csv': () => {
      // Excel generado en el backend (D5); el navegador lo descarga con la cookie de sesión.
      location.href = '/api/v1/buildings/' + view.buildingId + '/exports/accounts?month=' + state.month;
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
      const first = state.queue[0];
      view = { ...view, panel: null };
      if (!first) return go('#/');
      openOverlay({ receipt: first.id });
    },
    'shortcut-load': (el) => attempt(async () => {
      // pushState no dispara hashchange, que cerraría el diálogo recién abierto.
      history.pushState(null, '', '#/edificio/' + el.dataset.id + '/cobros');
      readHash();
      view = { ...view, panel: null };
      render();
      await openExpense();
    }),
    'shortcut-moro': (el) => {
      view = { ...view, panel: null };
      go('#/edificio/' + el.dataset.id + '/resumen');
    },
    'task-toggle': (el) => attempt(async () => {
      const updated = await api.post('tasks/' + el.dataset.id + '/toggle', {});
      state.tasks = state.tasks.map((t) => (t.id === updated.id ? updated : t));
      render();
    }),
    'task-filter': (el) => {
      view = { ...view, taskFilter: el.dataset.id };
      render();
    },
  };

  // ── Formularios ────────────────────────────────────────────────────────
  function showError(form, message) {
    const el = form.querySelector('[data-error]');
    el.textContent = message;
    el.hidden = !message;
  }

  /** Igual que attempt, pero el error va al formulario. */
  async function submitting(form, fn) {
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (err) {
      if (form.querySelector('[data-error]') && document.contains(form)) showError(form, err.message);
      else GC.toast(err.message, 'warn');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** Formularios de la ficha de unidad: después de escribir se vuelve a pedir todo lo visible. */
  function drawerForm(form, fn, message) {
    return submitting(form, async () => {
      await fn(new FormData(form));
      view = { ...view, manage: null };
      await refresh();
      render();
      GC.toast(message);
    });
  }

  function personPayload(data) {
    return {
      first_name: String(data.get('first_name') || '').trim(),
      last_name: String(data.get('last_name') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
    };
  }

  const forms = {
    payment(form) {
      const data = new FormData(form);
      const amount = GC.amountText(data.get('amount'));
      if (!amount) return showError(form, 'Escribí el monto (por ejemplo 4153,80).');
      return drawerForm(form, (d) => api.post('occupancies/' + view.drawer + '/payments', {
        amount, date: String(d.get('date') || ''), source: String(d.get('source') || '').trim(),
      }), 'Pago registrado');
    },
    adjust(form) {
      const data = new FormData(form);
      const amount = GC.amountText(data.get('amount'));
      if (!amount) return showError(form, 'Escribí el monto del ajuste (por ejemplo 250).');
      const signed = data.get('direction') === 'credit' ? '-' + amount : amount;
      return drawerForm(form, (d) => api.post('occupancies/' + view.drawer + '/adjustments', {
        entry_id: String(d.get('entry_id')), amount: signed, description: String(d.get('description') || '').trim(),
      }), 'Ajuste registrado');
    },
    'move-out'(form) {
      return drawerForm(form, (d) => api.post('occupancies/' + form.dataset.occ + '/move-out', {
        end_date: String(d.get('end_date') || ''),
      }), 'Fin del alquiler registrado');
    },
    tenant(form) {
      const person = personPayload(new FormData(form));
      if (!person.first_name || !person.last_name) return showError(form, 'Completá nombre y apellido.');
      return drawerForm(form, async (d) => {
        const created = await api.post(org('people'), person);
        const start = String(d.get('start_date') || '');
        if (form.dataset.replace) await api.post('units/' + form.dataset.unit + '/replace-tenant', { person_id: created.id, change_date: start });
        else await api.post('units/' + form.dataset.unit + '/move-in', { person_id: created.id, role: 'tenant', start_date: start });
      }, 'Inquilino registrado');
    },
    sale(form) {
      const person = personPayload(new FormData(form));
      if (!person.first_name || !person.last_name) return showError(form, 'Completá nombre y apellido de quien compra.');
      return drawerForm(form, async (d) => {
        const created = await api.post(org('people'), person);
        await api.post('units/' + form.dataset.unit + '/sell', { buyer_id: created.id, sale_date: String(d.get('sale_date') || '') });
      }, 'Venta registrada');
    },
    notice(form) {
      const data = new FormData(form);
      const title = String(data.get('title') || '').trim();
      const body = String(data.get('body') || '').trim();
      if (title.length < 3) return showError(form, 'El asunto necesita al menos 3 caracteres.');
      if (body.length < 10) return showError(form, 'El mensaje es muy corto.');
      return submitting(form, async () => {
        await api.post('buildings/' + view.buildingId + '/notices', { title, body });
        await loadBuilding(view.buildingId);
        render();
        GC.toast('Aviso publicado');
      });
    },
    reply(form) {
      const text = String(new FormData(form).get('text') || '').trim();
      if (!text) return;
      const id = form.dataset.id;
      view = { ...view, threadId: id };
      return submitting(form, async () => {
        await api.post('claims/' + id + '/replies', { text });
        await loadClaim(id);
        render();
        const input = main.querySelector('#reply');
        if (input) input.focus();
      });
    },
    expense(form) {
      const d = state.detail[view.buildingId];
      const result = GC.views.readExpenseForm(form, state, d);
      if (result.error) return showError(form, result.error);
      return submitting(form, async () => {
        await api.put('buildings/' + view.buildingId + '/settlements/' + result.month, { items: result.items });
        view = { ...view, dialog: null };
        await refresh();
        render();
        GC.toast('Borrador de ' + GC.fmt.monthLong(result.month) + ' guardado. Emitilo cuando esté listo.');
      });
    },
    task(form) {
      const data = new FormData(form);
      const text = String(data.get('text') || '').trim().slice(0, 90);
      if (!text) return;
      const buildingId = view.route === 'building' ? view.buildingId : String(data.get('bid'));
      return submitting(form, async () => {
        const task = await api.post(org('tasks'), { building_id: buildingId, text });
        state.tasks = state.tasks.concat(task);
        render();
      });
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
      const id = event.target.dataset.id;
      const status = event.target.value;
      view = { ...view, threadId: id };
      attempt(async () => {
        state.claims[id] = await api.patch('claims/' + id, { status });
        await loadBuilding(view.buildingId);
        render();
        GC.toast('Estado actualizado');
      });
    } else if (event.target.matches('[data-action="org"]')) {
      try { localStorage.setItem(ORG_KEY, event.target.value); } catch (err) { /* dura la sesión */ }
      state.orgId = event.target.value;
      state.detail = {};
      history.replaceState(null, '', '#/');
      attempt(load);
    }
  });

  window.addEventListener('hashchange', () => {
    readHash();
    view = { ...view, drawer: null, dialog: null, receipt: null };
    overlay.innerHTML = '';
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

  async function load() {
    state.ready = false;
    render();
    await Promise.all([loadPortfolio(), loadTasks()]);
    state.company = state.orgs.find((o) => o.id === state.orgId) || { name: '' };
    state.ready = true;
    readHash();
    render();
  }

  async function start() {
    state.error = '';
    try {
      const [me, orgs] = await Promise.all([api.get('auth/me'), api.get('organizations')]);
      state.userName = [me.first_name, me.last_name].filter(Boolean).join(' ');
      state.orgs = orgs;
      let saved = null;
      try { saved = localStorage.getItem(ORG_KEY); } catch (err) { saved = null; }
      state.orgId = (orgs.find((o) => o.id === saved) || orgs[0] || {}).id || null;
      if (!state.orgId) throw new Error('Tu usuario no pertenece a ninguna administración.');
      await load();
    } catch (err) {
      state.error = err.message;
      state.ready = false;
      render();
    }
  }

  start();
})(window.GC);
