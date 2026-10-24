import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(ROOT, 'design/assets');

const toDec = (n) => Number(n || 0).toFixed(2);

// Entorno mínimo de navegador para evaluar los IIFE del front sin modificarlos.
const localStorage = {
  _data: Object.create(null),
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
};

const window = {
  GC: {},
  localStorage,
  addEventListener() {},
};
window.window = window;

const context = vm.createContext({
  window,
  localStorage,
  console,
  setTimeout,
  clearTimeout,
});

for (const file of ['core.js', 'data.js', 'ledger.js']) {
  const filePath = path.join(ASSETS_DIR, file);
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, context, { filename: filePath });
}

const { GC } = window;
const L = GC.ledger;
const state = GC.createSeed();

const commit = execSync('git rev-parse --short HEAD', {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();

const allSummaries = state.buildings.map((b) => ({
  b,
  s: L.buildingSummary(state, b),
}));

// Misma fórmula que GC.views.home en design/assets/admin-views.js
const rawPortfolio = allSummaries.reduce(
  (t, { s }) => ({
    expected: t.expected + s.expected,
    collected: t.collected + s.collected,
    inReview: t.inReview + s.inReview,
    debt: t.debt + s.debt,
    threads: t.threads + s.openThreads,
    accounts: t.accounts + s.total,
    moro: t.moro + s.counts.moroso,
  }),
  { expected: 0, collected: 0, inReview: 0, debt: 0, threads: 0, accounts: 0, moro: 0 }
);

const buildings = state.buildings.map((b) => {
  const s = L.buildingSummary(state, b);
  const issued = L.issuedExpenses(b);

  const units = b.units.map((u) => ({
    n: u.n,
    floor: u.floor,
    coef: String(u.coef),
    owner: u.owner,
    tenant: u.tenant,
  }));

  const expenses = b.expenses.map((e) => ({
    month: e.month,
    status: e.status,
    ose: toDec(e.ose),
    ute: toDec(e.ute),
    cleaning: toDec(e.cleaning),
    fees: toDec(e.fees),
    reserve: toDec(e.reserve),
    extraordinary: toDec(e.extraordinary),
    extraordinaryNote: e.extraordinaryNote || '',
    total: toDec(L.expenseTotal(e)),
  }));

  const chargesByMonth = {};
  for (const exp of issued) {
    const monthCharges = {};
    for (const u of b.units) {
      for (const role of L.rolesOf(u)) {
        const key = `${u.n}:${role}`;
        const lines = L.chargeLines(u, role, exp).map((line) => ({
          key: line.key,
          label: line.label,
          total: toDec(line.total),
          amount: toDec(line.amount),
        }));
        monthCharges[key] = {
          charge: toDec(L.charge(u, role, exp)),
          lines,
        };
      }
    }
    chargesByMonth[exp.month] = monthCharges;
  }

  const accounts = {};
  for (const u of b.units) {
    for (const role of L.rolesOf(u)) {
      const acc = L.account(state, b, u, role);
      const movements = L.movements(b, u, role).map((mv) => {
        const item = {
          date: mv.date,
          concept: mv.concept,
          debit: toDec(mv.debit),
          credit: toDec(mv.credit),
          balance: toDec(mv.balance),
        };
        if (mv.note) item.note = true;
        return item;
      });
      accounts[acc.key] = {
        key: acc.key,
        unit: u.n,
        role: acc.role,
        person: acc.person,
        status: acc.status,
        balance: toDec(acc.balance),
        unpaid: acc.unpaid.map((m) => ({
          month: m.month,
          amount: toDec(m.amount),
        })),
        overdueMonths: acc.overdueMonths.map((m) => ({
          month: m.month,
          amount: toDec(m.amount),
        })),
        currentCharge: toDec(acc.currentCharge),
        review: acc.review,
        movements,
      };
    }
  }

  const summary = {
    counts: s.counts,
    total: s.total,
    draft: s.draft,
    expenseTotal: toDec(s.expenseTotal),
    expected: toDec(s.expected),
    collected: toDec(s.collected),
    inReview: toDec(s.inReview),
    debt: toDec(s.debt),
    reserveFund: toDec(s.reserveFund),
    openThreads: s.openThreads,
  };

  return {
    id: b.id,
    name: b.name,
    address: b.address,
    barrio: b.barrio,
    bank: b.bank,
    reserveOpening: toDec(b.reserveOpening),
    units,
    expenses,
    chargesByMonth,
    accounts,
    notices: b.notices,
    threads: b.threads,
    summary,
  };
});

const golden = {
  meta: {
    today: state.today,
    currentMonth: state.currentMonth,
    dueDay: state.dueDay,
    commit,
  },
  company: state.company,
  portfolio: {
    expected: toDec(rawPortfolio.expected),
    collected: toDec(rawPortfolio.collected),
    inReview: toDec(rawPortfolio.inReview),
    debt: toDec(rawPortfolio.debt),
    threads: rawPortfolio.threads,
    accounts: rawPortfolio.accounts,
    moro: rawPortfolio.moro,
  },
  buildings,
};

const outPath = path.join(__dirname, 'demo.json');
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + '\n', 'utf8');
console.log(`Generado ${path.relative(ROOT, outPath)} (${commit})`);
