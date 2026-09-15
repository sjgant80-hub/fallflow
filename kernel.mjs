// fallflow · pure cash-runway kernel — no DOM, no clock, no IO. Total: garbage → {ok:false}, never throws.
// Time is INTEGER DAY-NUMBERS (days since the Unix epoch, UTC) so a projection is deterministic
// and CI-reproducible — no local timezone, no Date.now() ambient state. The page adapts at the boundary.
// The provable payoff: sealRunway/verifyRunway — a content-addressed, tamper-evident receipt over the
// exact inputs+outputs of a projection. No model grades your cash flow; arithmetic does, and the seal proves it.

export const KERNEL_VERSION = '2.0.0';
export const ONE_DAY = 86400000;

// ── day-number helpers (UTC, deterministic) ──────────────────────────────
export function dayOf(ms) { return Math.floor(ms / ONE_DAY); }
export function isFriday(day) { return (((day % 7) + 7) % 7) === 1; } // epoch day 0 = Thu; Fri = day 1
export function domOf(day) { return new Date(day * ONE_DAY).getUTCDate(); } // day-of-month, 1..31

// ── money / date parsing (pure, total) ───────────────────────────────────
export function parseMoney(s) {
  s = String(s == null ? '' : s).trim();
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[£$€,\s]/g, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

// Returns an integer day-number (UTC) or null. ISO first, then DD/MM/YYYY, then native.
export function parseDate(s) {
  s = String(s == null ? '' : s).trim().replace(/['"]/g, '');
  if (s === '') return null;
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / ONE_DAY);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return Math.floor(Date.UTC(y, +m[2] - 1, +m[1]) / ONE_DAY);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / ONE_DAY);
}

// ── CSV parsing (pure, total) ─────────────────────────────────────────────
export function parseCSV(text) {
  if (text === null || text === undefined) return [];
  text = String(text).replace(/^﻿/, '').trim();
  if (!text) return [];
  const firstLine = text.split(/\r?\n/)[0];
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let cur = [''], qq = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (qq) {
      if (ch === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i += 2; continue; }
      if (ch === '"') { qq = false; i++; continue; }
      cur[cur.length - 1] += ch; i++;
    } else {
      if (ch === '"') { qq = true; i++; continue; }
      if (ch === sep) { cur.push(''); i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { rows.push(cur); cur = ['']; i++; continue; }
      cur[cur.length - 1] += ch; i++;
    }
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function detectColumns(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const first = rows[0].map(c => String(c).trim().toLowerCase());
  const hasHeader = first.some(c => /date|description|amount|debit|credit|memo|reference|narrative|details/.test(c));
  let dateIdx = -1, descIdx = -1, amtIdx = -1, debitIdx = -1, creditIdx = -1;
  if (hasHeader) {
    first.forEach((h, idx) => {
      if (dateIdx < 0 && /date|posted/.test(h)) dateIdx = idx;
      if (descIdx < 0 && /description|narrative|details|memo|reference|payee|merchant/.test(h)) descIdx = idx;
      if (amtIdx < 0 && /^amount|total|value/.test(h)) amtIdx = idx;
      if (debitIdx < 0 && /debit|out|paid out|money out/.test(h)) debitIdx = idx;
      if (creditIdx < 0 && /credit|in|paid in|money in/.test(h)) creditIdx = idx;
    });
  }
  if (dateIdx < 0 || (amtIdx < 0 && (debitIdx < 0 && creditIdx < 0))) {
    const sample = (hasHeader ? rows.slice(1, 6) : rows.slice(0, 6));
    const colCount = Math.max(...sample.map(r => r.length));
    for (let c = 0; c < colCount; c++) {
      const vals = sample.map(r => r[c] || '');
      const dateHits = vals.filter(v => parseDate(v) !== null).length;
      const moneyHits = vals.filter(v => parseMoney(v) !== null && /[\d.,()-]/.test(v)).length;
      if (dateIdx < 0 && dateHits >= Math.max(2, vals.length - 1)) dateIdx = c;
      else if (amtIdx < 0 && moneyHits >= Math.max(2, vals.length - 1)) amtIdx = c;
    }
    if (descIdx < 0) {
      let best = -1, bestLen = 0;
      for (let c = 0; c < colCount; c++) {
        if (c === dateIdx || c === amtIdx) continue;
        const avg = sample.reduce((s, r) => s + (r[c] || '').length, 0) / sample.length;
        if (avg > bestLen) { bestLen = avg; best = c; }
      }
      descIdx = best;
    }
  }
  return { hasHeader, dateIdx, descIdx, amtIdx, debitIdx, creditIdx };
}

// ── categorise (pure) ─────────────────────────────────────────────────────
export const CAT_RULES = [
  { cat: 'rent', re: /\brent\b|landlord|letting/i },
  { cat: 'payroll', re: /payroll|salary|wages|paye|hmrc paye/i },
  { cat: 'tax', re: /\bhmrc\b|tax|vat|corp tax/i },
  { cat: 'utilities', re: /electric|gas|water|edf|british gas|octopus|thames water|bt |sky |virgin media|three uk|vodafone|o2/i },
  { cat: 'software', re: /aws|google|microsoft|adobe|github|stripe fee|figma|notion|slack|zoom|atlassian/i },
  { cat: 'food', re: /tesco|sainsbury|asda|aldi|lidl|morrison|m&s food|waitrose|coop|spar|just eat|deliveroo|uber eats/i },
  { cat: 'transport', re: /tfl|trainline|uber|bolt|esso|shell|bp |petrol|fuel/i },
  { cat: 'standing-order', re: /standing order|s\/o\b|direct debit|d\/d\b/i },
  { cat: 'fees', re: /fee|charge|interest/i },
  { cat: 'transfer', re: /transfer|xfer|sent to|received from/i },
];
export function autoCategorise(desc, amount) {
  if (amount > 0) return 'income';
  const d = String(desc == null ? '' : desc);
  for (const r of CAT_RULES) if (r.re.test(d)) return r.cat;
  return 'other';
}

// ── bank CSV → transactions [{day, desc, amount, category}] ───────────────
export function parseBankCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { ok: false, error: 'No data found' };
  const cols = detectColumns(rows);
  if (!cols || cols.dateIdx < 0) return { ok: false, error: 'Could not detect Date column' };
  const dataRows = cols.hasHeader ? rows.slice(1) : rows;
  const txs = [];
  for (const r of dataRows) {
    const day = parseDate(r[cols.dateIdx]);
    if (day === null) continue;
    let amount = null;
    if (cols.amtIdx >= 0) amount = parseMoney(r[cols.amtIdx]);
    if (amount === null && cols.debitIdx >= 0) {
      const d = parseMoney(r[cols.debitIdx]);
      if (d !== null && d !== 0) amount = -Math.abs(d);
    }
    if (amount === null && cols.creditIdx >= 0) {
      const c = parseMoney(r[cols.creditIdx]);
      if (c !== null && c !== 0) amount = Math.abs(c);
    }
    if (amount === null) continue;
    const desc = (cols.descIdx >= 0 ? (r[cols.descIdx] || '') : '').trim() || '(no description)';
    txs.push({ day, desc, amount, category: autoCategorise(desc, amount) });
  }
  txs.sort((a, b) => a.day - b.day);
  return { ok: true, transactions: txs };
}

// ── repeating-expense detection (pure) ────────────────────────────────────
export function normalisedDesc(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').replace(/[^a-z ]/g, '').trim().slice(0, 30);
}
export function detectRepeating(txs) {
  if (!Array.isArray(txs)) return [];
  const groups = {};
  for (const t of txs) {
    if (!t || typeof t.amount !== 'number' || t.amount >= 0) continue;
    const key = normalisedDesc(t.desc);
    if (!key) continue;
    (groups[key] = groups[key] || []).push(t);
  }
  const reps = [];
  for (const key in groups) {
    const g = groups[key].sort((a, b) => a.day - b.day);
    if (g.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < g.length; i++) gaps.push(g[i].day - g[i - 1].day);
    const monthly = gaps.filter(d => d >= 25 && d <= 35).length;
    if (monthly < gaps.length * 0.6) continue;
    const avgAmt = g.reduce((s, t) => s + t.amount, 0) / g.length;
    const lastDay = g[g.length - 1].day;
    reps.push({
      desc: String(g[g.length - 1].desc).slice(0, 40),
      amount: Math.round(avgAmt * 100) / 100,
      dayOfMonth: domOf(lastDay),
      lastDay,
      signature: key,
    });
  }
  return reps.sort((a, b) => a.amount - b.amount);
}

// ── variable daily burn (trailing 30d, excluding repeating) ───────────────
export function variableDailyAvg(txs, repeating, nowDay) {
  if (!Array.isArray(txs)) return 0;
  const cutoff = nowDay - 30;
  const repSigs = new Set((Array.isArray(repeating) ? repeating : []).map(r => r && r.signature));
  let total = 0;
  for (const t of txs) {
    if (!t || typeof t.amount !== 'number' || t.amount >= 0) continue;
    if (t.day < cutoff) continue;
    if (repSigs.has(normalisedDesc(t.desc))) continue;
    total += t.amount;
  }
  return total / 30;
}

// ── classify a Friday balance ─────────────────────────────────────────────
export function classify(balance, floor) {
  if (balance < 0) return 'red';
  if (balance < floor) return 'amber';
  return 'green';
}

// ── projection · day-by-day balance walked forward ────────────────────────
// input: {transactions:[{day,amount}], invoices:[{dueDay,amount,latePct,locked?}],
//         repeating:[{dayOfMonth,amount,locked?}], currentBalance:number|null,
//         horizonDays:int, nowDay:int}
export function project(input) {
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const invoices = Array.isArray(input.invoices) ? input.invoices : [];
  const repeating = Array.isArray(input.repeating) ? input.repeating : [];
  const horizonDays = Math.max(0, Math.floor(input.horizonDays));
  const nowDay = Math.floor(input.nowDay);
  let bal = input.currentBalance;
  if (bal === null || bal === undefined || isNaN(bal)) {
    bal = transactions.reduce((s, t) => s + (typeof t.amount === 'number' ? t.amount : 0), 0);
  }
  const dailyVar = variableDailyAvg(transactions, repeating, nowDay);
  const days = [];
  for (let i = 0; i <= horizonDays; i++) {
    const day = nowDay + i;
    const events = [];
    if (i > 0 && dailyVar !== 0) {
      bal += dailyVar;
      events.push({ desc: 'Variable expenses (avg)', amount: dailyVar });
    }
    for (const r of repeating) {
      if (!r || r.locked) continue;
      if (i > 0 && domOf(day) === r.dayOfMonth) {
        bal += r.amount;
        events.push({ desc: r.desc, amount: r.amount });
      }
    }
    for (const inv of invoices) {
      if (!inv || typeof inv.dueDay !== 'number') continue;
      const slip = Math.round((inv.latePct / 100) * 14);
      const expected = inv.dueDay + slip;
      if (i > 0 && expected === day) {
        bal += inv.amount;
        events.push({ desc: inv.desc + ' (invoice)', amount: inv.amount });
      }
    }
    days.push({ day, balance: bal, events });
  }
  return days;
}

export function projectFridays(days) {
  const fris = [];
  for (const d of (Array.isArray(days) ? days : [])) if (isFriday(d.day)) fris.push(d);
  return fris;
}

// ── high-level: the whole runway model + a tamper-evident receipt ─────────
export function runway(input) {
  try {
    if (!input || typeof input !== 'object') return { ok: false, error: 'input must be an object' };
    if (typeof input.nowDay !== 'number' || !isFinite(input.nowDay)) return { ok: false, error: 'nowDay required' };
    const floor = (typeof input.floor === 'number' && isFinite(input.floor)) ? input.floor : 0;
    const horizonDays = (typeof input.horizonDays === 'number' && input.horizonDays >= 1) ? Math.floor(input.horizonDays) : 14;
    const nowDay = Math.floor(input.nowDay);
    const currentBalance = (typeof input.currentBalance === 'number' && isFinite(input.currentBalance)) ? input.currentBalance : null;

    const transactions = (Array.isArray(input.transactions) ? input.transactions : [])
      .filter(t => t && typeof t.day === 'number' && typeof t.amount === 'number');
    const invoices = (Array.isArray(input.invoices) ? input.invoices : [])
      .filter(v => v && typeof v.dueDay === 'number' && typeof v.amount === 'number')
      .map(v => ({ dueDay: v.dueDay, amount: v.amount, desc: String(v.desc == null ? 'invoice' : v.desc), latePct: (typeof v.latePct === 'number' ? v.latePct : 0), locked: !!v.locked }));
    const repeating = (Array.isArray(input.repeating) ? input.repeating : [])
      .filter(r => r && typeof r.dayOfMonth === 'number' && typeof r.amount === 'number');

    const days = project({ transactions, invoices, repeating, currentBalance, horizonDays, nowDay });
    const fris = projectFridays(days);
    const todayBalance = days.length ? days[0].balance : 0;
    const endBalance = days.length ? days[days.length - 1].balance : 0;
    const firstRed = fris.find(f => f.balance < 0) || null;

    let prev = todayBalance;
    const fridays = fris.map(f => {
      const status = classify(f.balance, floor);
      const row = { day: f.day, balance: round2(f.balance), status, delta: round2(f.balance - prev) };
      prev = f.balance;
      return row;
    });

    const totalIncome = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const dailyBurn = variableDailyAvg(transactions, repeating, nowDay);
    const fixedMonthly = repeating.reduce((s, r) => s + r.amount, 0);

    const model = {
      version: KERNEL_VERSION,
      nowDay,
      horizonDays,
      floor,
      todayBalance: round2(todayBalance),
      endBalance: round2(endBalance),
      cliff: firstRed ? { day: firstRed.day, daysOut: firstRed.day - nowDay, balance: round2(firstRed.balance) } : null,
      fridays,
      summary: {
        txCount: transactions.length,
        totalIncome: round2(totalIncome),
        totalExpenses: round2(totalExpenses),
        dailyBurn: round2(dailyBurn),
        fixedMonthly: round2(fixedMonthly),
        invoiceCount: invoices.length,
      },
    };

    const inputHash = sha256(canon({ transactions, invoices, repeating, currentBalance, floor, horizonDays, nowDay }));
    const receipt = sealRunway({ v: KERNEL_VERSION, kind: 'fallflow-runway', nowDay, inputHash, model });
    return { ok: true, model, receipt };
  } catch (e) {
    return { ok: false, error: 'runway failed' };
  }
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── content-addressed, tamper-evident receipt ─────────────────────────────
export function sealRunway(payload) {
  const body = { ...payload };
  delete body.seal;
  return { ...body, seal: sha256(canon(body)) };
}
export function verifyRunway(receipt) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'not an object' };
  if (receipt.kind !== 'fallflow-runway') return { ok: false, reason: 'wrong kind' };
  if (typeof receipt.seal !== 'string') return { ok: false, reason: 'no seal' };
  const body = { ...receipt };
  delete body.seal;
  const expected = sha256(canon(body));
  return expected === receipt.seal ? { ok: true } : { ok: false, reason: 'seal mismatch' };
}

// ── canonical JSON (sorted keys) ──────────────────────────────────────────
export function canon(x) {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  const keys = Object.keys(x).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

// ── sha256 (pure, explicit K256) ──────────────────────────────────────────
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
export function sha256(ascii) {
  ascii = String(ascii == null ? '' : ascii);
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) {
    let c = ascii.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else { i++; c = 0x10000 + (((c & 0x3ff) << 10) | (ascii.charCodeAt(i) & 0x3ff)); bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = (bytes[off + 4 * t] << 24) | (bytes[off + 4 * t + 1] << 16) | (bytes[off + 4 * t + 2] << 8) | (bytes[off + 4 * t + 3]);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

export default { KERNEL_VERSION, ONE_DAY, dayOf, isFriday, domOf, parseMoney, parseDate, parseCSV, detectColumns, CAT_RULES, autoCategorise, parseBankCSV, normalisedDesc, detectRepeating, variableDailyAvg, classify, project, projectFridays, runway, sealRunway, verifyRunway, canon, sha256 };
