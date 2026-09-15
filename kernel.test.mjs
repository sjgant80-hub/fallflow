import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ONE_DAY, isFriday, domOf, parseMoney, parseDate, parseCSV, detectColumns,
  autoCategorise, parseBankCSV, normalisedDesc, detectRepeating, variableDailyAvg,
  classify, project, projectFridays, runway, sealRunway, verifyRunway, canon, sha256,
} from './kernel.mjs';

// ── day helpers ───────────────────────────────────────────────────────────
test('day-number helpers are deterministic', () => {
  assert.equal(isFriday(20000), true);   // day 20000 % 7 === 1
  assert.equal(isFriday(20001), false);
  assert.equal(isFriday(19999), false);
  assert.equal(domOf(0), 1);             // 1970-01-01
});

// ── parseMoney ──────────────────────────────────────────────────────────
test('parseMoney handles signs, symbols, parens, garbage', () => {
  assert.equal(parseMoney('-43.21'), -43.21);
  assert.equal(parseMoney('£1,200.00'), 1200);
  assert.equal(parseMoney('(500)'), -500);
  assert.equal(parseMoney('2400.00'), 2400);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney(undefined), null);
});

// ── parseDate → integer day-number (UTC) ──────────────────────────────────
test('parseDate returns a UTC day-number; ISO and DD/MM agree', () => {
  const iso = parseDate('2026-05-20');
  assert.equal(typeof iso, 'number');
  assert.equal(domOf(iso), 20);
  assert.equal(parseDate('20/05/2026'), iso);      // DD/MM/YYYY == ISO
  assert.equal(parseDate('20-05-2026'), iso);
  assert.equal(parseDate('garbage'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
});

// ── CSV parse + column detection ──────────────────────────────────────────
const SAMPLE_CSV = `Date,Description,Amount
2026-05-20,Tesco Stores Croydon,-43.21
2026-05-21,Client Acme Ltd,2400.00
2026-05-22,Standing Order Rent,-1200.00`;

test('parseCSV splits rows and cells; empty/garbage never throws', () => {
  const rows = parseCSV(SAMPLE_CSV);
  assert.equal(rows.length, 4);              // header + 3
  assert.deepEqual(rows[1], ['2026-05-20', 'Tesco Stores Croydon', '-43.21']);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV(null), []);
});

test('detectColumns finds header columns; null on empty', () => {
  const cols = detectColumns(parseCSV(SAMPLE_CSV));
  assert.equal(cols.hasHeader, true);
  assert.equal(cols.dateIdx, 0);
  assert.equal(cols.descIdx, 1);
  assert.equal(cols.amtIdx, 2);
  assert.equal(detectColumns(null), null);
  assert.equal(detectColumns([]), null);
});

// ── categorise ────────────────────────────────────────────────────────────
test('autoCategorise: income for positive, rules for expenses', () => {
  assert.equal(autoCategorise('Client Acme Ltd', 2400), 'income');
  assert.equal(autoCategorise('Tesco Stores', -43), 'food');
  assert.equal(autoCategorise('Standing Order Rent', -1200), 'rent');   // rent rule wins over standing-order
  assert.equal(autoCategorise('AWS Web Services', -247), 'software');
  assert.equal(autoCategorise('Zzz Widgets Ltd', -10), 'other');
});

// ── parseBankCSV ──────────────────────────────────────────────────────────
test('parseBankCSV: sorted transactions with day/amount/category', () => {
  const r = parseBankCSV(SAMPLE_CSV);
  assert.equal(r.ok, true);
  assert.equal(r.transactions.length, 3);
  assert.deepEqual(r.transactions.map(t => t.amount), [-43.21, 2400, -1200]);
  assert.deepEqual(r.transactions.map(t => t.category), ['food', 'income', 'rent']);
  assert.equal(r.transactions[0].day < r.transactions[2].day, true); // sorted ascending
  assert.equal(parseBankCSV('').ok, false);
  assert.equal(parseBankCSV(null).ok, false);
});

// ── repeating detection ───────────────────────────────────────────────────
test('detectRepeating: monthly cadence, ≥2 occurrences, expenses only', () => {
  const D = 20000;
  const txs = [
    { day: D, desc: 'Standing Order Rent', amount: -1850, category: 'rent' },
    { day: D + 30, desc: 'Standing Order Rent', amount: -1850, category: 'rent' },
    { day: D + 60, desc: 'Standing Order Rent', amount: -1850, category: 'rent' },
    { day: D + 5, desc: 'One-off consultant', amount: -900, category: 'other' }, // single → not repeating
    { day: D, desc: 'Acme Ltd', amount: 4500, category: 'income' },              // income → excluded
  ];
  const reps = detectRepeating(txs);
  assert.equal(reps.length, 1);
  assert.equal(reps[0].amount, -1850);
  assert.equal(reps[0].signature, 'standing order rent');
  assert.equal(reps[0].dayOfMonth, domOf(D + 60));
  assert.deepEqual(detectRepeating(null), []);
});

// ── variable daily burn ───────────────────────────────────────────────────
test('variableDailyAvg: trailing 30d expenses ÷ 30, excludes old/income/repeating', () => {
  const nowDay = 20000;
  const txs = [
    { day: nowDay - 5, desc: 'Ad-hoc spend', amount: -3000 },  // in window
    { day: nowDay - 40, desc: 'Old spend', amount: -9999 },    // outside 30d → excluded
    { day: nowDay - 2, desc: 'Client', amount: 5000 },         // income → excluded
  ];
  assert.equal(variableDailyAvg(txs, [], nowDay), -100); // -3000 / 30
  assert.equal(variableDailyAvg(null, [], nowDay), 0);
});

// ── classify boundaries (kills band mutants) ──────────────────────────────
test('classify: exact red/amber/green boundaries', () => {
  assert.equal(classify(-0.01, 500), 'red');
  assert.equal(classify(0, 500), 'amber');      // 0 is not < 0 → not red; 0 < 500 → amber
  assert.equal(classify(499.99, 500), 'amber');
  assert.equal(classify(500, 500), 'green');    // not < floor → green
  assert.equal(classify(0, 0), 'green');        // floor 0: 0 not < 0 → green
});

// ── projection + runway end-to-end (deterministic cliff) ──────────────────
test('runway: projects a cliff with exact balances, statuses, deltas, receipt', () => {
  const nowDay = 20000; // a Friday
  const input = {
    nowDay,
    currentBalance: 1000,
    floor: 500,
    horizonDays: 14,
    transactions: [{ day: nowDay - 5, desc: 'Ad-hoc burn', amount: -3000 }], // → -100/day
    invoices: [],
    repeating: [],
  };
  const r = runway(input);
  assert.equal(r.ok, true);
  const m = r.model;
  assert.equal(m.todayBalance, 1000);
  assert.equal(m.endBalance, -400);            // 1000 - 100*14
  assert.equal(m.fridays.length, 3);           // days 20000, 20007, 20014
  assert.deepEqual(m.fridays.map(f => f.status), ['green', 'amber', 'red']);
  assert.equal(m.fridays[0].balance, 1000);
  assert.equal(m.fridays[1].balance, 300);     // 1000 - 700
  assert.equal(m.fridays[2].balance, -400);    // 1000 - 1400
  assert.equal(m.fridays[0].delta, 0);
  assert.equal(m.fridays[1].delta, -700);
  assert.equal(m.fridays[2].delta, -700);
  assert.ok(m.cliff);
  assert.equal(m.cliff.day, 20014);
  assert.equal(m.cliff.daysOut, 14);
  assert.equal(m.cliff.balance, -400);
  assert.equal(m.summary.txCount, 1);
  assert.equal(m.summary.totalExpenses, -3000);
  assert.equal(m.summary.dailyBurn, -100);
  assert.equal(m.summary.invoiceCount, 0);
  // receipt is valid and tamper-evident
  assert.equal(verifyRunway(r.receipt).ok, true);
});

test('runway: no cliff when balance stays above zero', () => {
  const r = runway({ nowDay: 20000, currentBalance: 5000, floor: 500, horizonDays: 14, transactions: [], invoices: [], repeating: [] });
  assert.equal(r.ok, true);
  assert.equal(r.model.cliff, null);
  assert.deepEqual(r.model.fridays.map(f => f.status), ['green', 'green', 'green']);
  assert.equal(verifyRunway(r.receipt).ok, true);
});

test('runway: an invoice lifts the balance on its expected (slipped) day', () => {
  // latePct 50 → slip = round(0.5*14) = 7 days. due at nowDay+3 → paid nowDay+10.
  const nowDay = 20000;
  const r = runway({
    nowDay, currentBalance: 0, floor: 500, horizonDays: 14,
    transactions: [], repeating: [],
    invoices: [{ dueDay: nowDay + 3, amount: 2400, desc: 'Acme', latePct: 50 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.model.endBalance, 2400);  // invoice lands within horizon, no burn
});

// ── receipt: seal + verify + tamper ───────────────────────────────────────
test('sealRunway/verifyRunway: honest seal passes, any tamper fails', () => {
  const sealed = sealRunway({ kind: 'fallflow-runway', nowDay: 20000, a: 1, b: 2 });
  assert.equal(typeof sealed.seal, 'string');
  assert.equal(verifyRunway(sealed).ok, true);
  const tampered = { ...sealed, a: 999 };
  assert.equal(verifyRunway(tampered).ok, false);
  assert.equal(verifyRunway(tampered).reason, 'seal mismatch');
  assert.deepEqual(verifyRunway(null), { ok: false, reason: 'not an object' });
  assert.deepEqual(verifyRunway({}), { ok: false, reason: 'wrong kind' });
  assert.deepEqual(verifyRunway({ kind: 'fallflow-runway' }), { ok: false, reason: 'no seal' });
});

// ── canon + sha256 (known vectors) ────────────────────────────────────────
test('canon: sorted keys, arrays, null/undefined', () => {
  assert.equal(canon({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canon([1, 2, 3]), '[1,2,3]');
  assert.equal(canon(null), 'null');
  assert.equal(canon(undefined), 'null');
  assert.equal(canon('x'), '"x"');
});

test('sha256: known vectors', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc').length, 64);
});

// ── fuzz: garbage never throws, always a defined result ───────────────────
test('fuzz: total functions never throw on garbage', () => {
  const junk = [null, undefined, '', 'x', 0, -1, NaN, Infinity, {}, [], { nowDay: 'x' },
    { nowDay: 20000, transactions: 'nope', invoices: 5, repeating: {} },
    [1, 2], { a: { b: {} } }];
  for (const j of junk) {
    assert.doesNotThrow(() => runway(j));
    assert.doesNotThrow(() => parseBankCSV(j));
    assert.doesNotThrow(() => detectRepeating(j));
    assert.doesNotThrow(() => variableDailyAvg(j, j, 20000));
    assert.doesNotThrow(() => parseMoney(j));
    assert.doesNotThrow(() => parseDate(j));
    assert.doesNotThrow(() => canon(j));
    assert.doesNotThrow(() => sha256(j));
    assert.doesNotThrow(() => verifyRunway(j));
  }
  assert.equal(runway(null).ok, false);
  assert.equal(runway({}).ok, false);          // no nowDay
  assert.equal(runway({ nowDay: 20000 }).ok, true); // empty but valid
});

// ══════════════════════════════════════════════════════════════════════════
// KILL-CRAFT — exact-boundary probes + forged inputs + a crypto oracle
// ══════════════════════════════════════════════════════════════════════════

// sha256 vs node:crypto across block boundaries + valid unicode (kills UTF-8
// encoding-boundary + padding mutants that short vectors leave alive)
test('sha256 matches node:crypto across lengths and valid unicode', () => {
  const inputs = [
    '', 'a', 'abc',
    'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(120),
    '', '',      // 1-byte / 2-byte boundary
    '߿', 'ࠀ',      // 2-byte / 3-byte boundary
    '',                // the >= 0xe000 boundary (valid 3-byte)
    '𐀀',          // U+10000 — a valid pair starting at the 0xd800 boundary
    'café £5 — naïve',
    '😀🚀', 'a😀b',           // valid surrogate pairs (4-byte)
    JSON.stringify({ a: 1, b: [2, 3], c: 'runway' }),
  ];
  for (const s of inputs) {
    assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'), 'mismatch for ' + JSON.stringify(s));
  }
});

// parseDate year boundary: 2-digit → +2000, 3-digit → literal (kills y<100 → <=)
test('parseDate: 2-digit vs 3-digit year boundary', () => {
  assert.equal(parseDate('20/05/26'), parseDate('2026-05-20'));   // 26 → 2026
  assert.notEqual(parseDate('01/06/100'), parseDate('01/06/2100')); // 100 stays 100, not 2100
});

// parseCSV: quotes, escaped quotes, quoted delimiter in the header, edge rows
test('parseCSV: adversarial quoting and trailing rows', () => {
  // escaped quote + delimiter inside quotes
  assert.deepEqual(parseCSV('name;amount\n"Smith; Jones";100\n"He said ""hi""";200'),
    [['name', 'amount'], ['Smith; Jones', '100'], ['He said "hi"', '200']]);
  // FIRST line has a quoted delimiter — inQ must suppress it in separator detection
  assert.deepEqual(parseCSV('"a,b";c\n"d,e";f'), [['a,b', 'c'], ['d,e', 'f']]);
  // single cell, no separators, no trailing newline (kills trailing-row !== → ===)
  assert.deepEqual(parseCSV('hello'), [['hello']]);
  // last row with empty first cell, no trailing newline (kills trailing-row || → &&)
  assert.deepEqual(parseCSV('x,y\n,z'), [['x', 'y'], ['', 'z']]);
  // exact last row (kills while i <= length reading one char past the end)
  const r = parseCSV('a,b,c\n1,2,3');
  assert.deepEqual(r[r.length - 1], ['1', '2', '3']);
});

// detectColumns: first matching column wins for every role (kills idx<0 → <=, && → ||)
test('detectColumns: first match wins for each role', () => {
  const header = ['Date', 'Posted', 'Description', 'Narrative', 'Amount', 'Total', 'Debit', 'Money Out', 'Credit', 'Money In'];
  const cols = detectColumns([header, ['2026-05-20', '2026-05-20', 'x', 'y', '1', '2', '3', '4', '5', '6']]);
  assert.equal(cols.dateIdx, 0);
  assert.equal(cols.descIdx, 2);
  assert.equal(cols.amtIdx, 4);
  assert.equal(cols.debitIdx, 6);
  assert.equal(cols.creditIdx, 8);
});

// detectColumns: content inference when there is no usable header
test('detectColumns: inference path (no header)', () => {
  const rows = [
    ['2026-05-20', 'Shop A Ltd', '-40.00'],
    ['2026-05-21', 'Shop B Ltd', '-12.00'],
    ['2026-05-22', 'Client Payment', '500.00'],
  ];
  const cols = detectColumns(rows);
  assert.equal(cols.hasHeader, false);
  assert.equal(cols.dateIdx, 0);
  assert.equal(cols.amtIdx, 2);
  assert.equal(cols.descIdx, 1);
});

// autoCategorise: exactly-zero amount is NOT income (kills amount>0 → >=0)
test('autoCategorise: zero is an expense, runs the rules', () => {
  assert.equal(autoCategorise('Tesco Stores', 0), 'food');
  assert.equal(autoCategorise('Anything', 1), 'income');
});

// parseBankCSV: debit/credit columns, amount at column 0, undetectable date
test('parseBankCSV: debit/credit split columns', () => {
  const r = parseBankCSV('Date,Desc,Debit,Credit\n2026-05-20,Shop,40.00,\n2026-05-21,Client,,500.00');
  assert.equal(r.ok, true);
  assert.deepEqual(r.transactions.map(t => t.amount), [-40, 500]);
});
test('parseBankCSV: amount at column 0 (kills amtIdx>=0 → >0)', () => {
  const r = parseBankCSV('Amount,Date,Desc\n-5.00,2026-05-20,Shop\n99.00,2026-05-21,Client');
  assert.equal(r.ok, true);
  assert.deepEqual(r.transactions.map(t => t.amount), [-5, 99]);
});
test('parseBankCSV: debit at column 0 (kills debitIdx>=0 → >0)', () => {
  const r = parseBankCSV('Debit,Date,Desc\n40.00,2026-05-20,Shop');
  assert.equal(r.ok, true);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].amount, -40);
});
test('parseBankCSV: a zero debit is ignored, not a £0 row (kills d!==0 guard)', () => {
  const r = parseBankCSV('Date,Desc,Debit,Credit\n2026-05-20,Skip,0,\n2026-05-21,Keep,,500.00');
  assert.equal(r.ok, true);
  assert.deepEqual(r.transactions.map(t => t.amount), [500]); // the 0-debit row dropped
});
test('parseBankCSV: no detectable date column → error (kills !cols || dateIdx<0 → &&)', () => {
  const r = parseBankCSV('Name,Amount\nAlice Smith,-5.00\nBob Jones,-9.00');
  assert.equal(r.ok, false);
});

// detectRepeating: gap-boundary + occurrence-count + ratio boundaries
test('detectRepeating: exactly 2 monthly occurrences detected (kills length<2 → <=)', () => {
  const D = 20000;
  const reps = detectRepeating([
    { day: D, desc: 'Rent Payment', amount: -1850 },
    { day: D + 30, desc: 'Rent Payment', amount: -1850 },
  ]);
  assert.equal(reps.length, 1);
});
test('detectRepeating: gap of exactly 25 and 35 days counts as monthly; 100 does not', () => {
  assert.equal(detectRepeating([{ day: 20000, desc: 'Sub A', amount: -9 }, { day: 20025, desc: 'Sub A', amount: -9 }]).length, 1); // 25
  assert.equal(detectRepeating([{ day: 20000, desc: 'Sub B', amount: -9 }, { day: 20035, desc: 'Sub B', amount: -9 }]).length, 1); // 35
  assert.equal(detectRepeating([{ day: 20000, desc: 'Sub C', amount: -9 }, { day: 20100, desc: 'Sub C', amount: -9 }]).length, 0); // 100 → not monthly
});
test('detectRepeating: ratio boundary monthly=3 of 5 gaps (kills monthly<len*0.6 → <=)', () => {
  const D = 20000;
  const reps = detectRepeating([
    { day: D, desc: 'Svc', amount: -10 }, { day: D + 30, desc: 'Svc', amount: -10 },
    { day: D + 60, desc: 'Svc', amount: -10 }, { day: D + 90, desc: 'Svc', amount: -10 },
    { day: D + 200, desc: 'Svc', amount: -10 }, { day: D + 400, desc: 'Svc', amount: -10 },
  ]); // gaps [30,30,30,110,200] → 3 monthly of 5; 3 < 3.0 is false → detected
  assert.equal(reps.length, 1);
});
test('detectRepeating: a null in the array is skipped, not a throw (kills !t || … → &&)', () => {
  assert.doesNotThrow(() => detectRepeating([null, { day: 20000, desc: 'A', amount: -5 }, { day: 20030, desc: 'A', amount: -5 }]));
  assert.equal(detectRepeating([null, { day: 20000, desc: 'A', amount: -5 }, { day: 20030, desc: 'A', amount: -5 }]).length, 1);
});

// variableDailyAvg: cutoff boundary + null-in-array + income exclusion
test('variableDailyAvg: a tx exactly at the 30-day cutoff is still counted (kills day<cutoff → <=)', () => {
  assert.equal(variableDailyAvg([{ day: 20000 - 30, desc: 'X', amount: -3000 }], [], 20000), -100);
});
test('variableDailyAvg: a null in the array is skipped, not a throw', () => {
  assert.doesNotThrow(() => variableDailyAvg([null, { day: 20000, desc: 'X', amount: -30 }], [], 20000));
  assert.equal(variableDailyAvg([null, { day: 20000, desc: 'X', amount: -30 }], [], 20000), -1);
});

// project: currentBalance null → sum of tx; guards on locked/null repeating & invoices
test('project: null currentBalance defaults to the transaction sum (kills bal default guards)', () => {
  const days = project({ nowDay: 20000, horizonDays: 0, transactions: [{ day: 19999, amount: -250 }], invoices: [], repeating: [], currentBalance: null });
  assert.equal(days[0].balance, -250);
});
test('project: a repeating expense applies exactly once, only for i>0', () => {
  const nowDay = 20000, dom = domOf(20007);
  const days = project({ nowDay, horizonDays: 14, transactions: [], invoices: [], repeating: [{ dayOfMonth: dom, amount: -500 }], currentBalance: 10000 });
  assert.equal(days[0].balance, 10000);   // i=0 untouched
  assert.equal(days[14].balance, 9500);   // exactly one -500 applied
});
test('project: a same-day repeating does NOT hit today (kills i>0 → i>=0 for repeating)', () => {
  const nowDay = 20000, dom = domOf(nowDay);
  const days = project({ nowDay, horizonDays: 3, transactions: [], invoices: [], repeating: [{ dayOfMonth: dom, amount: -500 }], currentBalance: 10000 });
  assert.equal(days[0].balance, 10000);
});
test('project: a locked repeating is skipped (kills !r || r.locked → &&)', () => {
  const nowDay = 20000, dom = domOf(20007);
  const days = project({ nowDay, horizonDays: 14, transactions: [], invoices: [], repeating: [{ dayOfMonth: dom, amount: -500, locked: true }], currentBalance: 10000 });
  assert.equal(days[14].balance, 10000); // locked → never applied
});
test('project: a null repeating/invoice is skipped, not a throw', () => {
  assert.doesNotThrow(() => project({ nowDay: 20000, horizonDays: 2, transactions: [], invoices: [null], repeating: [null], currentBalance: 0 }));
});
test('project: an invoice applies once, only for i>0 (kills i>0 → i>=0 for invoices)', () => {
  const nowDay = 20000;
  // due today, on-time → expected == nowDay → must NOT apply at i=0
  const d0 = project({ nowDay, horizonDays: 7, transactions: [], repeating: [], currentBalance: 0, invoices: [{ dueDay: nowDay, amount: 1000, latePct: 0 }] });
  assert.equal(d0[0].balance, 0);
  // due in 5 days → applies exactly once
  const d1 = project({ nowDay, horizonDays: 7, transactions: [], repeating: [], currentBalance: 0, invoices: [{ dueDay: nowDay + 5, amount: 1000, latePct: 0 }] });
  assert.equal(d1[7].balance, 1000);
});

// runway: NaN nowDay rejected; malformed items filtered out
test('runway: NaN nowDay is rejected (kills the nowDay guard || → &&)', () => {
  assert.equal(runway({ nowDay: NaN }).ok, false);
});
test('runway: malformed transactions/invoices/repeating are filtered', () => {
  const r = runway({
    nowDay: 20000, currentBalance: 1000, horizonDays: 7,
    transactions: [{ day: 'x', amount: 5 }, { day: 5, amount: 'y' }, { day: 19990, amount: -30 }, null],
    invoices: [{ dueDay: 'x', amount: 5 }, { amount: 5 }, { dueDay: 20003, amount: 100, latePct: 0 }],
    repeating: [{ dayOfMonth: 'x', amount: 5 }, { amount: 5 }, { dayOfMonth: 15, amount: -50 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.model.summary.txCount, 1);
  assert.equal(r.model.summary.invoiceCount, 1);
  assert.equal(r.model.summary.fixedMonthly, -50); // only the valid repeating counted (kills loosened repeating filter)
});

// ── detectColumns: first match wins per role when the role is at column 0 ──
test('detectColumns: role at column 0 is not overwritten by a later match', () => {
  assert.equal(detectColumns([['Description', 'Narrative', 'Date', 'Amount'], ['x', 'y', '2026-05-20', '1']]).descIdx, 0);
  assert.equal(detectColumns([['Amount', 'Total', 'Date', 'Desc'], ['1', '2', '2026-05-20', 'x']]).amtIdx, 0);
  assert.equal(detectColumns([['Debit', 'Money Out', 'Date', 'Desc'], ['1', '2', '2026-05-20', 'x']]).debitIdx, 0);
  assert.equal(detectColumns([['Credit', 'Money In', 'Date', 'Desc'], ['1', '2', '2026-05-20', 'x']]).creditIdx, 0);
});

// ── detectColumns: when header gives date+amount, inference is skipped entirely ──
// (pins the inference gate — an unlabelled desc column is NOT found; kills the four idx<0 → <=0)
test('detectColumns: inference gate skipped when header already has date+amount', () => {
  assert.equal(detectColumns([['Date', 'Amount', 'Xyz'], ['2026-05-20', '-5', 'Shop']]).descIdx, -1);
  assert.equal(detectColumns([['Amount', 'Date', 'Xyz'], ['-5', '2026-05-20', 'Shop']]).descIdx, -1);
  assert.equal(detectColumns([['Debit', 'Date', 'Xyz'], ['5', '2026-05-20', 'Shop']]).descIdx, -1);
  assert.equal(detectColumns([['Credit', 'Date', 'Xyz'], ['5', '2026-05-20', 'Shop']]).descIdx, -1);
});

// ── detectColumns: inference DOES run when header lacks the amount (kills gate || → &&) ──
test('detectColumns: amount inferred when header has only a date-less label + amount label', () => {
  // 'Ref' is not a date header; amount header present; date must be inferred from column content
  const r = parseBankCSV('Ref,Amount\n2026-05-20,-40.00\n2026-05-21,-12.00');
  assert.equal(r.ok, true);
  assert.equal(r.transactions.length, 2);
});

// ── detectColumns: content-inference internals ──
test('detectColumns: first date column wins (kills dateIdx<0 → <=0 in inference)', () => {
  const cols = detectColumns([['2026-05-20', '2026-06-20', '-5'], ['2026-05-21', '2026-06-21', '-6'], ['2026-05-22', '2026-06-22', '-7']]);
  assert.equal(cols.dateIdx, 0);
});
test('detectColumns: exactly 2 of 3 dates still counts (kills dateHits >= → >)', () => {
  const cols = detectColumns([['2026-05-20', 'a', '-5'], ['2026-05-21', 'b', '-6'], ['zzz', 'c', '-7']]);
  assert.equal(cols.dateIdx, 0);
});
test('detectColumns: exactly 2 of 3 money values still counts (kills moneyHits >= → >)', () => {
  const cols = detectColumns([['2026-05-20', 'x', '-5'], ['2026-05-21', 'y', '-6'], ['2026-05-22', 'z', 'notmoney']]);
  assert.equal(cols.amtIdx, 2);
});
test('detectColumns: amount at col 0 not overwritten by a later money col (kills amtIdx<0 → <=0)', () => {
  // decimal money strings do not parse as dates, so col0 is inferred as amount (not date)
  const cols = detectColumns([['-12.34', 'Shop', '-9.99'], ['-5.00', 'Cafe', '-8.88'], ['-7.50', 'Bar', '-3.21']]);
  assert.equal(cols.amtIdx, 0);
});
test('detectColumns: amount not reassigned to a later money col (kills amtIdx<0 && … → ||)', () => {
  const cols = detectColumns([['2026-05-20', '-5', '-9'], ['2026-05-21', '-6', '-8'], ['2026-05-22', '-7', '-3']]);
  assert.equal(cols.amtIdx, 1);
});
test('detectColumns: a hyphen-in-text column is not money (kills parseMoney!==null && regex → ||)', () => {
  const cols = detectColumns([['2026-05-20', 'Shop-A', '-5.00'], ['2026-05-21', 'Cafe-B', '-6.00'], ['2026-05-22', 'Bar-C', '-7.00']]);
  assert.equal(cols.amtIdx, 2);
});
test('detectColumns: header desc at col0 is kept, not recomputed (kills descIdx<0 → <=0)', () => {
  // header provides descIdx=0; no date header → inference runs but must not overwrite descIdx
  const cols = detectColumns([['Description', 'Amount', 'Extra'], ['A', '-5', 'LongerText'], ['B', '-6', 'AnotherLong'], ['C', '-7', 'MoreTextHere']]);
  assert.equal(cols.descIdx, 0);
});
test('detectColumns: desc inference skips the date and amount columns (kills c===date || c===amt → &&)', () => {
  const cols = detectColumns([['2026-05-20', 'Sh', '-5'], ['2026-05-21', 'Ca', '-6'], ['2026-05-22', 'Ba', '-7']]);
  assert.equal(cols.descIdx, 1); // not 0 (the long date col)
});
test('detectColumns: equal-length text columns — first wins (kills avg > bestLen → >=)', () => {
  const cols = detectColumns([['2026-05-20', 'AB', '-5', 'CD'], ['2026-05-21', 'EF', '-6', 'GH'], ['2026-05-22', 'IJ', '-7', 'KL']]);
  assert.equal(cols.descIdx, 1); // col1, not the equal-length col3
});

// ── parseBankCSV: amount column wins over debit/credit (kills the overwrite guards) ──
test('parseBankCSV: an explicit amount is not overwritten by a debit/credit column', () => {
  assert.equal(parseBankCSV('Date,Amount,Debit\n2026-05-20,100,999').transactions[0].amount, 100);
  assert.equal(parseBankCSV('Date,Amount,Credit\n2026-05-20,-50,999').transactions[0].amount, -50);
});
test('parseBankCSV: credit at column 0 is used (kills creditIdx>=0 → >0)', () => {
  const r = parseBankCSV('Credit,Date,Desc\n500,2026-05-20,Shop');
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].amount, 500);
});
test('parseBankCSV: description at column 0 is used (kills descIdx>=0 → >0)', () => {
  assert.equal(parseBankCSV('Description,Date,Amount\nShop,2026-05-20,-5').transactions[0].desc, 'Shop');
});

// ── detectRepeating: income and £0 rows never form a repeating group ──
test('detectRepeating: monthly income is not a repeating expense (kills the >=0 clause → &&)', () => {
  assert.equal(detectRepeating([{ day: 20000, desc: 'Salary In', amount: 4500 }, { day: 20030, desc: 'Salary In', amount: 4500 }]).length, 0);
});
test('detectRepeating: monthly £0 rows are not a repeating expense (kills amount>=0 → >0)', () => {
  assert.equal(detectRepeating([{ day: 20000, desc: 'Zero Sub', amount: 0 }, { day: 20030, desc: 'Zero Sub', amount: 0 }]).length, 0);
});

// ── project: NaN currentBalance defaults to the transaction sum (kills the 2nd || → &&) ──
test('project: NaN currentBalance falls back to the transaction sum', () => {
  const days = project({ nowDay: 20000, horizonDays: 0, transactions: [{ day: 19999, amount: -100 }], invoices: [], repeating: [], currentBalance: NaN });
  assert.equal(days[0].balance, -100);
});

// ── runway: input/option validation boundaries ──
test('runway: a non-object input reports the object error (kills !input || … → &&)', () => {
  assert.equal(runway(5).error, 'input must be an object');
  assert.equal(runway('x').error, 'input must be an object');
});
test('runway: NaN floor defaults to 0 (kills floor guard && → ||)', () => {
  assert.equal(runway({ nowDay: 20000, floor: NaN }).model.floor, 0);
});
test('runway: horizonDays boundaries (kills >= → >, === → !==, && → ||)', () => {
  assert.equal(runway({ nowDay: 20000, horizonDays: 1 }).model.horizonDays, 1);   // >= 1
  assert.equal(runway({ nowDay: 20000, horizonDays: 7 }).model.horizonDays, 7);   // typeof === number
  assert.equal(runway({ nowDay: 20000, horizonDays: 0.5 }).model.horizonDays, 14); // < 1 → default
});
test('runway: a non-number currentBalance is treated as null (kills currentBalance guard && → ||)', () => {
  assert.equal(runway({ nowDay: 20000, currentBalance: '100', transactions: [] }).model.todayBalance, 0);
});
test('runway: invoice latePct pushes payment past the horizon (kills latePct === → !==)', () => {
  // due day +10, 50% late → +7 slip → paid day +17, outside a 14-day horizon → excluded
  const r = runway({ nowDay: 20000, horizonDays: 14, currentBalance: 0, transactions: [], repeating: [], invoices: [{ dueDay: 20010, amount: 2400, latePct: 50 }] });
  assert.equal(r.model.endBalance, 0);
});
test('runway: a Friday balance of exactly £0 is not the cliff (kills firstRed < → <=)', () => {
  // £700 start, -£100/day burn → Fri +7 lands on exactly £0, Fri +14 on -£700
  const r = runway({ nowDay: 20000, currentBalance: 700, floor: 0, horizonDays: 14, transactions: [{ day: 19995, amount: -3000 }], invoices: [], repeating: [] });
  assert.ok(r.model.cliff);
  assert.equal(r.model.cliff.day, 20014); // the -£700 Friday, not the £0 one at 20007
});

// ── the receipt binds the EXACT inputs+outputs (pins the seal; kills input-canon mutants) ──
test('runway: receipt inputHash and seal are pinned for a fixed input', () => {
  const r = runway({
    nowDay: 20000, currentBalance: 1000, floor: 500, horizonDays: 14,
    transactions: [{ day: 19995, desc: 'Burn', amount: -3000, category: 'other' }],
    invoices: [{ dueDay: 20009, amount: 2400, desc: 'Acme Ltd', latePct: 50 }],
    repeating: [],
  });
  assert.equal(r.receipt.inputHash, 'b2cb970719c7310180716f12e5778792bde2ed6c08e3427b59624ba8f9d294ab');
  assert.equal(r.receipt.seal, '96cd68fe98fe3a19e1df3b78098bf396eef1a3e42cfa4d7099db8805d32d47f1');
  assert.equal(verifyRunway(r.receipt).ok, true);
});
