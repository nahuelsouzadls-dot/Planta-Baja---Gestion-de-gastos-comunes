/* Helpers compartidos: formato, escape de HTML, íconos, toasts y persistencia. */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const STORAGE_KEY = 'administracion-gc:demo:v2';

  const moneyFmt = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
  const moneyFmtCents = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  GC.fmt = {
    /** Solo para mostrar: acepta el texto que devuelve la API ("4153.80") o un número. */
    money(value, withCents) {
      const abs = Math.abs(Number(value) || 0);
      const body = withCents ? moneyFmtCents.format(abs) : moneyFmt.format(Math.round(abs));
      return (Number(value) < 0 && body !== '0' && body !== '0,00' ? '− ' : '') + '$ ' + body;
    },
    monthLong(key) {
      const [y, m] = key.split('-').map(Number);
      return MONTHS[m - 1] + ' ' + y;
    },
    monthTitle(key) {
      const s = GC.fmt.monthLong(key);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    monthShort(key) {
      const [y, m] = key.split('-').map(Number);
      return MONTHS[m - 1].slice(0, 3) + ' ' + String(y).slice(2);
    },
    date(iso) {
      const [y, m, d] = iso.split('-').map(Number);
      return d + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y;
    },
    dateShort(iso) {
      const [, m, d] = iso.split('-').map(Number);
      return d + ' ' + MONTHS[m - 1].slice(0, 3);
    },
    percent(coef) {
      return (Number(coef) * 100).toFixed(2).replace('.', ',') + ' %';
    },
  };

  /** Escapa texto antes de interpolarlo en HTML. Todo dato dinámico pasa por acá. */
  GC.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const ICON_PATHS = {
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16"/>',
    upload: '<path d="M12 20V9m0 0 4.5 4.5M12 9l-4.5 4.5M4 5h16"/>',
    printer: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>',
    back: '<path d="M19 12H5m0 0 5-5m-5 5 5 5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>',
  };

  GC.icon = function (name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON_PATHS[name] + '</svg>';
  };

  GC.toast = function (message, tone) {
    let region = document.querySelector('.toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (tone === 'warn' ? ' toast--warn' : '');
    el.textContent = message;
    region.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  };

  /** Nombre a mostrar de un archivo: las keys del almacenamiento (receipts/<org>/<uuid>) no dicen nada. */
  GC.fileLabel = function (key) {
    return String(key || '').startsWith('receipts/') ? 'Comprobante' : String(key || '');
  };

  /** Monto escrito por una persona → texto para la API: "4.153,80" o "4153.80" → "4153.80".
   * Devuelve null si no es un monto válido (positivo, hasta 2 decimales). Nunca pasa por Number. */
  GC.amountText = function (raw) {
    const text = String(raw || '').trim();
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    return /^\d{1,9}(\.\d{1,2})?$/.test(normalized) && /[1-9]/.test(normalized) ? normalized : null;
  };

  /** Abre una URL firmada que se pide a la API, sin que el navegador bloquee la ventana. */
  GC.openSigned = function (request) {
    const win = window.open('', '_blank');
    return request.then((data) => {
      if (win) win.location = data.url;
      else location.href = data.url;
    }, (err) => {
      if (win) win.close();
      throw err;
    });
  };

  GC.ROLE_LABEL = { owner: 'Propietario', tenant: 'Inquilino' };
  GC.STATUS_LABEL = {
    pagado: 'Al día',
    revision: 'En revisión',
    pendiente: 'Pendiente',
    moroso: 'Moroso',
    'sin-cargar': 'Sin liquidación',
  };

  GC.views = GC.views || {};

  /** Pastilla de estado de cuenta. `label` opcional reemplaza el texto por defecto. */
  GC.views.status = function (key, label) {
    return '<span class="status status--' + key + '">' + GC.esc(label || GC.STATUS_LABEL[key]) + '</span>';
  };

  GC.uid = function (prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  };

  /**
   * RETIRADO (C4): el panel y el portal leen y escriben por la API (`GC.api`, api.js).
   * Este store de localStorage ya no se carga en ninguna pantalla; queda solo como
   * referencia del prototipo y se borra junto con data.js y ledger.js.
   *
   * Estado de la demo. Se guarda en localStorage para que lo que hace un residente
   * en el portal (p. ej. subir un comprobante) aparezca en el panel de la
   * administración. Si el storage no está disponible, la demo funciona en memoria.
   */
  GC.store = (function () {
    let state = null;
    const listeners = [];

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[GC] No se pudo leer el estado guardado; se usa el inicial.', err);
      }
      return GC.createSeed();
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('[GC] No se pudo guardar el estado de la demo.', err);
      }
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        state = JSON.parse(event.newValue);
        listeners.forEach((fn) => fn(state));
      } catch (err) {
        console.warn('[GC] Estado externo inválido, se ignora.', err);
      }
    });

    return {
      get() {
        if (!state) state = load();
        return state;
      },
      /** `updater` recibe el estado y devuelve uno nuevo (no muta). */
      update(updater) {
        state = updater(this.get());
        persist();
        listeners.forEach((fn) => fn(state));
      },
      reset() {
        state = GC.createSeed();
        persist();
        listeners.forEach((fn) => fn(state));
      },
      subscribe(fn) {
        listeners.push(fn);
      },
    };
  })();
})(window.GC);
