/* Cliente de la API (/api/v1/). Mismo origen: cookie de sesión + token CSRF (ADR-0005).
 * Los montos viajan siempre como texto: este módulo nunca los convierte a número. */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const BASE = '/api/v1/';
  const PANEL_LOGIN = '/ingresar/administracion';
  const PORTAL_LOGIN = '/ingresar';

  function cookie(name) {
    const match = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
  }

  /** Error con el mensaje que devuelve la API (`detail`) y la lista completa (`errors`). */
  class ApiError extends Error {
    constructor(status, message, errors) {
      super(message);
      this.status = status;
      this.errors = errors || [];
    }
  }

  function loginUrl() {
    return location.pathname.startsWith('/panel') ? PANEL_LOGIN : PORTAL_LOGIN;
  }

  let redirecting = false;

  /** 401/403: si /auth/me también falla, la sesión venció y se vuelve al login. */
  async function sessionExpired() {
    try {
      const res = await fetch(BASE + 'auth/me', { credentials: 'same-origin' });
      return res.status === 401 || res.status === 403;
    } catch (err) {
      return false;
    }
  }

  async function request(method, path, body, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    const init = { method, credentials: 'same-origin', headers };
    if (method !== 'GET') headers['X-CSRFToken'] = cookie('csrftoken');
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(BASE + path.replace(/^\//, ''), init);
    } catch (err) {
      throw new ApiError(0, 'No hay conexión con el servidor. Revisá tu internet y probá de nuevo.');
    }

    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (res.ok) return data;

    if (res.status === 429) throw new ApiError(429, 'Demasiados intentos, probá en unos minutos.');
    if ((res.status === 401 || res.status === 403) && !opts.noRedirect && await sessionExpired()) {
      if (!redirecting) {
        redirecting = true;
        location.href = loginUrl() + '?vencida=1';
      }
      throw new ApiError(res.status, 'Tu sesión venció. Volvé a ingresar.');
    }
    const message = (data && data.detail) || (res.status === 404 ? 'No encontramos lo que buscabas.' : 'Algo salió mal. Probá de nuevo.');
    throw new ApiError(res.status, message, data && data.errors);
  }

  GC.ApiError = ApiError;
  GC.api = {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    patch: (path, body, options) => request('PATCH', path, body, options),
    delete: (path, options) => request('DELETE', path, undefined, options),

    async logout() {
      const target = location.pathname.startsWith('/panel') ? PANEL_LOGIN : PORTAL_LOGIN;
      try { await request('POST', 'auth/logout', undefined, { noRedirect: true }); } catch (err) { /* igual se sale */ }
      location.href = target;
    },
  };
})(window.GC);
