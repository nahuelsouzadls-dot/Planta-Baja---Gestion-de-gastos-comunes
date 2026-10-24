/* Pantallas de acceso: ingresar, recuperar contraseña y activar una invitación. */
(function (GC) {
  'use strict';

  const params = new URLSearchParams(location.search);

  try {
    const theme = localStorage.getItem('gc-theme');
    if (theme) document.querySelector('.lg').dataset.theme = theme;
  } catch (err) { /* sin almacenamiento: tema por defecto */ }

  function say(form, text, ok) {
    const el = form.querySelector('[data-msg]');
    el.textContent = text;
    el.classList.toggle('ok', Boolean(ok));
    el.hidden = !text;
  }

  function busy(form, on) {
    form.querySelector('[type="submit"]').disabled = on;
  }

  /** Después de entrar: empleados al panel, residentes al portal. */
  async function goHome(fallback) {
    const me = await GC.api.get('auth/me', { noRedirect: true });
    if (me.organizations.length) location.href = '/panel';
    else if (me.persons.some((p) => p.occupancies.length)) location.href = '/portal';
    else location.href = fallback;
  }

  function samePasswords(form) {
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    if (password.length < 10) return say(form, 'La contraseña necesita al menos 10 caracteres.'), null;
    if (password !== String(data.get('repeat') || '')) return say(form, 'Las dos contraseñas no coinciden.'), null;
    return password;
  }

  const handlers = {
    async login(form) {
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      if (!email || !password) return say(form, 'Completá tu correo y tu contraseña.');
      await GC.api.post('auth/login', { email, password }, { noRedirect: true });
      await goHome(form.dataset.home);
    },
    async 'reset-request'(form) {
      const email = String(new FormData(form).get('email') || '').trim();
      if (!email) return say(form, 'Escribí tu correo.');
      await GC.api.post('auth/password-reset', { email }, { noRedirect: true });
      form.reset();
      say(form, 'Si el correo está registrado, te llega un link en unos minutos. Revisá también el correo no deseado.', true);
    },
    async 'reset-confirm'(form) {
      const password = samePasswords(form);
      if (!password) return;
      await GC.api.post('auth/password-reset/confirm', {
        uid: params.get('uid') || '', token: params.get('token') || '', password,
      }, { noRedirect: true });
      form.reset();
      form.querySelector('[type="submit"]').hidden = true;
      say(form, 'Listo, ya podés ingresar con tu nueva contraseña.', true);
    },
    async accept(form) {
      const password = samePasswords(form);
      if (!password) return;
      await GC.api.post('invitations/accept', { token: params.get('token') || '', password }, { noRedirect: true });
      await goHome('/ingresar');
    },
  };

  // La misma página sirve para pedir el link y para elegir la contraseña nueva.
  document.querySelectorAll('[data-mode]').forEach((form) => {
    form.hidden = form.dataset.mode !== location.pathname;
  });

  if (params.get('vencida')) {
    const form = document.querySelector('[data-form="login"]');
    if (form) say(form, 'Tu sesión venció. Volvé a ingresar.');
  }

  document.addEventListener('click', (event) => {
    const eye = event.target.closest('[data-eye]');
    if (!eye) return;
    const input = document.getElementById(eye.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? 'Ocultar' : 'Mostrar';
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form]');
    if (!form || !handlers[form.dataset.form]) return;
    event.preventDefault();
    say(form, '');
    busy(form, true);
    try {
      await handlers[form.dataset.form](form);
    } catch (err) {
      say(form, err.message);
    } finally {
      busy(form, false);
    }
  });
})(window.GC);
