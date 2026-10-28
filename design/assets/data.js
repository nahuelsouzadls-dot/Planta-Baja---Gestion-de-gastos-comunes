/*
 * Datos de la demo. Mismo modelo que el backend Django: edificio → unidades con
 * coeficiente de copropiedad → gastos mensuales → cuentas por (unidad, rol).
 * Los montos NO están escritos a mano: se calculan en ledger.js a partir de los
 * gastos del mes y el coeficiente de cada unidad.
 */
window.GC = window.GC || {};

(function (GC) {
  'use strict';

  const TODAY = '2026-10-21';
  const CURRENT_MONTH = '2026-10';
  const PAST_MONTHS = ['2026-07', '2026-08', '2026-09'];

  function person(name, phone) {
    const email = name.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '.') + '@correo.com.uy';
    return { name, phone, email };
  }

  function expense(month, ose, ute, cleaning, fees, reserve, extraordinary, extraordinaryNote) {
    return {
      month,
      ose,
      ute,
      cleaning,
      fees,
      reserve,
      extraordinary: extraordinary || 0,
      extraordinaryNote: extraordinaryNote || '',
      status: 'emitido',
    };
  }

  /** Arma las cuentas: todo pagado salvo lo que indiquen las excepciones. */
  function buildAccounts(units, months, exceptions) {
    const accounts = {};
    units.forEach((unit) => {
      const roles = unit.tenant ? ['owner', 'tenant'] : ['owner'];
      roles.forEach((role) => {
        const key = unit.n + ':' + role;
        const rule = exceptions[key] || {};
        const unpaid = rule.unpaid || [];
        const paid = {};
        months.forEach((month, i) => {
          if (unpaid.includes(month)) return;
          const day = String(3 + ((i * 3 + Number(unit.n)) % 6)).padStart(2, '0');
          const [y, m] = month.split('-').map(Number);
          const payMonth = m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
          const date = month === CURRENT_MONTH ? '2026-10-' + day : payMonth + '-' + day;
          paid[month] = { date, receipt: 'transferencia_' + month + '.pdf' };
        });
        accounts[key] = { paid, review: rule.review || null, events: [] };
      });
    });
    return accounts;
  }

  function minas() {
    const units = [
      { n: '101', floor: 1, coef: '0.08600000', owner: person('Juan Pérez', '099 111 222'), tenant: null },
      { n: '102', floor: 1, coef: '0.08300000', owner: person('Carlos López', '099 234 567'), tenant: person('María García', '098 876 543') },
      { n: '103', floor: 1, coef: '0.08000000', owner: person('Beatriz Díaz', '099 345 678'), tenant: person('Carlos Rodríguez', '098 765 432') },
      { n: '104', floor: 1, coef: '0.08400000', owner: person('Luis Fernández', '099 456 789'), tenant: null },
      { n: '201', floor: 2, coef: '0.08600000', owner: person('Diego Herrera', '099 567 890'), tenant: person('Sofía López', '098 654 321') },
      { n: '202', floor: 2, coef: '0.08300000', owner: person('Pedro Martínez', '099 678 901'), tenant: null },
      { n: '203', floor: 2, coef: '0.08000000', owner: person('Miguel Torres', '099 789 012'), tenant: person('Laura Sánchez', '098 543 210') },
      { n: '204', floor: 2, coef: '0.08400000', owner: person('Elena Rosario', '099 890 123'), tenant: null },
      { n: '301', floor: 3, coef: '0.08700000', owner: person('Felipe Castillo', '099 901 234'), tenant: null },
      { n: '302', floor: 3, coef: '0.08300000', owner: person('Horacio Sosa', '099 012 345'), tenant: person('Natalia Vidal', '098 432 109') },
      { n: '303', floor: 3, coef: '0.08000000', owner: person('Andrea Morales', '099 123 456'), tenant: null },
      { n: '304', floor: 3, coef: '0.08400000', owner: person('Rosa Herrera', '099 234 678'), tenant: person('Ramón Herrera', '098 321 098') },
    ];
    const expenses = [
      expense('2026-07', 3800, 5900, 8500, 12000, 4800),
      expense('2026-08', 4100, 7200, 8500, 12000, 4800),
      expense('2026-09', 3950, 6420, 8500, 12000, 4800),
      expense('2026-10', 4200, 6800, 8500, 12000, 4800, 12000, 'Impermeabilización de azotea (cuota 1 de 3)'),
    ];
    const months = expenses.map((e) => e.month);
    const accounts = buildAccounts(units, months, {
      '101:owner': { unpaid: ['2026-10'] },
      '102:tenant': { unpaid: ['2026-10'], review: { file: 'comprobante_oct2026.jpg', uploadedAt: '2026-10-10' } },
      '103:tenant': { unpaid: ['2026-10'], review: { file: 'transferencia_103.pdf', uploadedAt: '2026-10-12' } },
      '201:tenant': { unpaid: ['2026-10'], review: { file: 'IMG_4471.jpg', uploadedAt: '2026-10-11' } },
      '201:owner': { unpaid: ['2026-10'] },
      '203:tenant': { unpaid: ['2026-08', '2026-09', '2026-10'] },
      '301:owner': { unpaid: ['2026-10'] },
      '302:owner': { unpaid: ['2026-10'] },
      '303:owner': { unpaid: ['2026-09', '2026-10'] },
    });
    return {
      id: 'minas',
      name: 'Edificio Minas',
      address: 'Av. Brasil 2234',
      barrio: 'Pocitos',
      bank: 'Banco Demo · Cuenta corriente en pesos a nombre de Administración Demo',
      reserveOpening: 38500,
      units,
      expenses,
      accounts,
      notices: [
        { id: 'n1', date: '2026-10-20', title: 'Corte de agua el jueves 24', body: 'OSE hará trabajos de mantenimiento el jueves 24/10 de 9:00 a 14:00. Recomendamos juntar agua la noche anterior.' },
        { id: 'n2', date: '2026-10-01', title: 'Liquidación de octubre disponible', body: 'Ya pueden ver y descargar la liquidación de octubre en el portal. Vence el 10 de octubre. Este mes incluye la primera cuota de la impermeabilización de la azotea (solo propietarios).' },
      ],
      threads: [
        {
          id: 't1', kind: 'reclamo', unit: '202', author: 'Pedro Martínez', title: 'Humedad en el pasillo del 2.º piso', status: 'en-proceso', date: '2026-10-18',
          messages: [
            { from: 'resident', name: 'Pedro Martínez', date: '2026-10-18', text: 'Hay una mancha de humedad que crece en la pared del pasillo, al lado del ascensor.' },
            { from: 'admin', name: 'Administración Demo', date: '2026-10-19', text: 'Gracias, Pedro. El lunes va un técnico a evaluar si viene de la azotea.' },
          ],
        },
        {
          id: 't2', kind: 'reporte', unit: '101', author: 'Juan Pérez', title: 'Luz quemada en la escalera', status: 'pendiente', date: '2026-10-20',
          messages: [
            { from: 'resident', name: 'Juan Pérez', date: '2026-10-20', text: 'La lámpara del primer tramo de la escalera está quemada hace varios días.' },
          ],
        },
        {
          id: 't3', kind: 'reclamo', unit: '201', author: 'Sofía López', title: 'La puerta principal no cierra', status: 'resuelto', date: '2026-10-15',
          messages: [
            { from: 'resident', name: 'Sofía López', date: '2026-10-15', text: 'La puerta de entrada queda sin trabar si no se empuja fuerte.' },
            { from: 'admin', name: 'Administración Demo', date: '2026-10-16', text: 'El cerrajero ajustó el pestillo hoy. Avisanos si vuelve a pasar.' },
          ],
        },
      ],
    };
  }

  const NAMES = ['Graciela Silva', 'Martín Rodríguez', 'Valentina Núñez', 'Gonzalo Pereira', 'Lucía Fernández',
    'Rodrigo Cabrera', 'Florencia Méndez', 'Sebastián Olivera', 'Camila Suárez', 'Andrés Ferreira',
    'Paula Romero', 'Joaquín Acosta', 'Mercedes Ramos', 'Ignacio Benítez', 'Carolina Píriz',
    'Federico Techera', 'Inés Viera', 'Matías Gularte', 'Victoria Correa', 'Nicolás Sena',
    'Mónica Rivero', 'Alejandro Castro', 'Daniela Ocampo', 'Pablo Bentancur'];

  function generatedUnits(floors, perFloor, rentedEvery, nameOffset) {
    const units = [];
    const total = floors * perFloor;
    let nameIndex = nameOffset;
    for (let f = 1; f <= floors; f++) {
      for (let u = 1; u <= perFloor; u++) {
        const i = units.length;
        const coef = i === total - 1
          ? (1 - units.reduce((s, x) => s + Number(x.coef), 0)).toFixed(8)
          : (1 / total).toFixed(8);
        const owner = person(NAMES[nameIndex++ % NAMES.length], '099 ' + (300 + i) + ' ' + (410 + i));
        const tenant = i % rentedEvery === 1
          ? person(NAMES[nameIndex++ % NAMES.length], '098 ' + (520 + i) + ' ' + (630 + i))
          : null;
        units.push({ n: String(f * 100 + u), floor: f, coef, owner, tenant });
      }
    }
    return units;
  }

  function centro() {
    const units = generatedUnits(4, 2, 3, 0);
    const expenses = PAST_MONTHS.concat(CURRENT_MONTH).map((m, i) =>
      expense(m, 2600 + i * 90, 4100 + i * 120, 6000, 9000, 3200));
    return {
      id: 'centro',
      name: 'Edificio Centro',
      address: '18 de Julio 1120',
      barrio: 'Centro',
      bank: 'Banco Demo · Cuenta corriente en pesos a nombre de Administración Demo',
      reserveOpening: 21000,
      units,
      expenses,
      accounts: buildAccounts(units, expenses.map((e) => e.month), {
        '201:owner': { unpaid: ['2026-10'], review: { file: 'comp_201.pdf', uploadedAt: '2026-10-09' } },
        '302:owner': { unpaid: ['2026-10'] },
      }),
      notices: [],
      threads: [],
    };
  }

  function pocitos() {
    const units = generatedUnits(4, 4, 4, 8);
    const expenses = PAST_MONTHS.map((m, i) => expense(m, 5200 + i * 150, 9100 + i * 200, 14000, 21000, 7200));
    return {
      id: 'pocitos',
      name: 'Edificio Pocitos',
      address: 'Bulevar España 2780',
      barrio: 'Pocitos',
      bank: 'Banco Demo · Cuenta corriente en pesos a nombre de Administración Demo',
      reserveOpening: 64000,
      units,
      expenses,
      accounts: buildAccounts(units, expenses.map((e) => e.month), {
        '203:owner': { unpaid: ['2026-08', '2026-09'] },
        '402:tenant': { unpaid: ['2026-09'] },
      }),
      notices: [],
      threads: [],
    };
  }

  GC.createSeed = function () {
    return {
      today: TODAY,
      currentMonth: CURRENT_MONTH,
      dueDay: 10,
      company: { name: 'Administración Demo', email: 'contacto@administracion.demo' },
      buildings: [minas(), centro(), pocitos()],
    };
  };
})(window.GC);
