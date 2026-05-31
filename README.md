# ◊ fallflow · 14-day cash-runway early-warning

**prime 353 · v1.0 · sovereign single-file · MIT**

Paste a bank CSV. See the Friday you go red — two weeks before it happens.

Live: **https://sjgant80-hub.github.io/fallflow/**

---

## The pain (verified)

CPA Practice Advisor, 27 May 2026: small businesses are profitable but cash-poor. Existing apps surface the problem *after* you're already overdrawn. By then it's too late — the cheque has bounced, the payroll missed, the supplier called.

You don't need accountancy. You need to know which Friday goes red.

## What fallflow does

- **Paste a bank CSV** — Monzo, Starling, HSBC, Barclays, or any generic Date / Description / Amount export. Columns auto-detected. Separator auto-detected (comma, tab, semicolon). UK currency strings (£1,234.56) parsed correctly.
- **Categorises** transactions automatically by description (rent / payroll / tax / utilities / software / food / transport / standing-order / fees / transfer / other).
- **Projects 14 days forward** using three signals:
  - Repeating expenses auto-detected from history (rent, payroll, standing orders).
  - Upcoming invoices you add manually — with a late-payment uncertainty multiplier (0% / 50% / 100%).
  - Variable expense average from the trailing 30 days.
- **Friday-by-Friday wall** — each cell is a Friday between today and the horizon. **Red** below £0. **Amber** below your safety floor. **Green** above.
- **Cliff badge** — the first Friday you go red, with a countdown in days.
- **Export** — snapshot JSON, printable PDF of the wall, one-tap share link (data-URL encoded, copies to clipboard).

## How to use (the WhatsApp version)

1. Open https://sjgant80-hub.github.io/fallflow/
2. Tap **Load example** to see it working.
3. To use your own data: export your bank CSV (Monzo → Statements → Export, or your bank's equivalent), paste into the left box, hit **Parse**.
4. Set your current balance and safety floor.
5. Add upcoming invoices on the left.
6. The Friday wall on the right is the answer. If you see red — that's your warning.

## What it does NOT do

- It is not your accountant. It does not file VAT, do double-entry, or replace Xero.
- It does not phone your bank. You paste the CSV; nothing leaves your device.
- It does not predict the future. It projects the present forward — same shape, same pattern, plus what you tell it. Useful precisely because the present usually repeats.

---

## Architecture (for developers)

Single HTML file. Vanilla JavaScript. No build step. No framework. No CDN dependency outside Google Fonts. <60KB.

- **Persistence** · IndexedDB primary, localStorage fallback. Data never leaves the browser.
- **CSV parser** · ~30 lines vanilla, handles separator detection (`,` `\t` `;`), quoted fields with embedded commas, UK currency (`£1,234.56`), parens for negative (`(£50.00)`), date formats (`YYYY-MM-DD`, `DD/MM/YYYY`).
- **Repeating-expense detection** · groups by normalised description, looks for monthly cadence (25–35 day gaps for ≥60% of intervals), averages amount.
- **Projection** · day-by-day forward walk. Today's balance + daily variable burn + repeating expenses on their day-of-month + invoices on (due_date + late% × 14 days).
- **Friday filter** · pulls Fridays from the projected sequence.
- **fallmesh hook** · `BroadcastChannel('fall-signal')`, prime 353. Emits `cashflow_red_friday` events when projection crosses zero. Estate tools can listen.
- **PWA manifest** · baked via `data:` URL. Add-to-home-screen works from `file://` or HTTPS.
- **Works offline** · open the HTML from any drive, no server needed.

### Konomi licence shim

- **Free / trial** · 1 account · 14-day forward horizon · watermark. 30-day trial.
- **Paid** · multi-account · 60-day forward horizon · scenario simulator (what if Client X pays late?) · watermark removed.
- Device ID stored in `localStorage` (`fallflow_device_id`). Licence redemption: `KONOMI.redeem('<key>')`.
- The cap is honest: free tier is fully functional for one account. Paid is for businesses managing several entities.

### Palette / fonts (don't break these)

```
--ox     #8b1a1a  (oxblood, primary action)
--brass  #b8974a  (accent)
--gold   #d4a853  (highlight)
--cream  #c4bfb2  (body text)
--void   #0b0a0f  (background)
--red    #c8371a  (below zero)
--amber  #c87e3a  (below floor)
--green  #4a8a4a  (safe)
```

Fonts: Libre Baskerville (serif headings), Syne (sans accents), DM Mono (mono details).

### Estate hook

```javascript
new BroadcastChannel('fall-signal').onmessage = (e) => {
  if (e.data.type === 'cashflow_red_friday') {
    console.log('Projected red Friday:', e.data.payload);
    // → { date: '2026-06-13T00:00:00.000Z', balance: -342, days: 13 }
  }
};
```

Estate tools (fallaccount, fallforce, fallinvoice) can listen on prime 353 and trigger downstream — e.g. fallinvoice nudges late clients automatically when fallflow signals red.

---

## CSV format examples

### Monzo / Starling style (works out of the box)

```
Date,Description,Amount
2026-05-20,Tesco Stores Croydon,-43.21
2026-05-21,Acme Ltd invoice 001,4500.00
2026-05-22,Standing Order Rent,-1850.00
```

### HSBC / Barclays (separate debit/credit columns — also detected)

```
Date,Description,Debit,Credit
20/05/2026,Tesco Stores,43.21,
21/05/2026,Acme Ltd,,4500.00
```

### Generic (no header — content-inferred)

```
2026-05-20;Tesco Stores;-43.21
2026-05-21;Acme Ltd;2400.00
```

---

## Privacy

No telemetry. No tracking. No analytics. The CSV is parsed in your browser and stored in IndexedDB on your device. The only network calls are Google Fonts (Libre Baskerville / Syne / DM Mono) — and the tool runs without them, fonts just fall back to system defaults.

The share-link feature encodes a summary (not the raw transactions) into the URL fragment — fragments are never sent to servers. You control what gets shared.

---

## Build / development

It's one HTML file. Edit `index.html`. Open it in a browser. Done.

```bash
git clone https://github.com/sjgant80-hub/fallflow
cd fallflow
# Open index.html in your browser. That's the dev loop.
```

---

## License

MIT · © 2026 Simon Gant
