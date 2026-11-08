// Deterministic money logic. The agent never computes amounts; it calls into this.
const Engine = (() => {
  const SYNONYMS = {
    orders: {
      order_id: ["order_id", "order_no", "order_number", "order", "merchant_order_id", "invoice", "invoice_no"],
      customer: ["customer", "customer_name", "recipient", "recipient_name", "buyer", "name"],
      courier: ["courier", "provider", "carrier", "delivery_partner"],
      delivered_at: ["delivered_at", "delivered_date", "delivery_date", "date"],
      cod_amount: ["cod_amount", "cod", "cash_collected", "collectable_amount", "total_tk", "total", "order_amount", "amount"],
      courier_fee: ["courier_fee", "delivery_charge", "delivery_fee", "shipping_fee", "charge", "fee"],
      expected_payout: ["expected_payout", "net_payout", "amount_due", "seller_amount"]
    },
    payouts: {
      order_id: ["order_id", "invoice", "invoice_no", "merchant_order_id", "order_no", "order", "reference"],
      payout_amount: ["remitted_amount", "payable_amount", "payout_amount", "paid_amount", "settlement_amount", "net_amount", "amount"],
      courier: ["courier", "provider", "carrier"],
      payout_date: ["payout_date", "payment_date", "settlement_date", "paid_at", "date"],
      payout_ref: ["payout_ref", "consignment_id", "tracking_id", "transaction_id", "reference"],
      note: ["note", "notes", "remarks", "comment"]
    }
  };
  const REQUIRED = { orders: ["order_id"], payouts: ["order_id", "payout_amount"] };

  const round2 = n => Math.round(n * 100) / 100;
  const normalizeKey = h => h.trim().toLowerCase().replace(/[\s\-/]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");

  function parseCsv(text, name = "file.csv") {
    const records = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field.trim()); field = ""; }
      else if (c === "\n") { row.push(field.trim()); records.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field.length || row.length) { row.push(field.trim()); records.push(row); }
    const keys = (records.shift() || []).map(h => normalizeKey(h.replace(/^﻿/, "")));
    const rows = records
      .map((cells, i) => ({ cells, line: i + 2 }))
      .filter(r => r.cells.some(c => c !== ""))
      .map(({ cells, line }) => ({ ...Object.fromEntries(keys.map((k, j) => [k, cells[j] ?? ""])), __row: line }));
    return { name, keys, rows };
  }

  function parseAmount(value) {
    if (value == null || String(value).trim() === "") return null;
    const latin = String(value).replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
    const n = Number(latin.replace(/[৳$\s,]|tk|bdt/gi, "").replace(/^\((.*)\)$/, "-$1"));
    return Number.isFinite(n) ? round2(n) : null;
  }

  const normalizeId = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  function dateLabel(value) {
    if (!value) return "No date";
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
  }

  function courierName(value) {
    const l = (value || "").toLowerCase();
    if (l.includes("pathao")) return "Pathao";
    if (l.includes("redx")) return "RedX";
    if (l.includes("steadfast")) return "Steadfast";
    return value || "Courier";
  }

  function guessMapping(kind, keys) {
    const out = {};
    const taken = new Set();
    for (const [field, names] of Object.entries(SYNONYMS[kind])) {
      const hit = names.find(n => keys.includes(n) && !taken.has(n));
      out[field] = hit || null;
      if (hit) taken.add(hit);
    }
    return out;
  }

  function mappingProblems(kind, keys, map) {
    const problems = [];
    for (const [field, key] of Object.entries(map || {})) if (key && !keys.includes(key)) problems.push(`${kind}.${field}: no column named "${key}"`);
    for (const field of REQUIRED[kind]) if (!map?.[field]) problems.push(`${kind}.${field} is required`);
    if (kind === "orders" && !map?.expected_payout && !map?.cod_amount) problems.push("orders needs expected_payout or cod_amount");
    return problems;
  }

  const classify = r => r.actual == null ? "missing" : round2(r.actual - r.expected) < 0 ? "short" : round2(r.actual - r.expected) > 0 ? "overpaid" : "matched";
  const gap = r => r.actual == null ? r.expected : round2(Math.abs(r.expected - r.actual));

  // links: { "MH-10323": [5, 9] } attaches payout file lines to an order, approved by the seller.
  function reconcile(orderFile, payoutFile, mapping, links = {}) {
    const problems = [...mappingProblems("orders", orderFile.keys, mapping.orders), ...mappingProblems("payouts", payoutFile.keys, mapping.payouts)];
    if (problems.length) return { ok: false, problems };
    const mo = mapping.orders, mp = mapping.payouts;
    const get = (row, key) => key ? String(row[key] ?? "").trim() : "";
    const linked = new Map();
    for (const [orderId, lines] of Object.entries(links)) for (const line of lines) linked.set(line, normalizeId(orderId));

    const paid = new Map();
    const payoutKeyOf = new Map();
    for (const p of payoutFile.rows) {
      const amount = parseAmount(get(p, mp.payout_amount));
      if (amount == null) continue;
      const key = linked.get(p.__row) ?? normalizeId(get(p, mp.order_id));
      payoutKeyOf.set(p.__row, key);
      if (!key) continue;
      const e = paid.get(key) || { amount: 0, lines: [], refs: [], date: "", courier: "" };
      e.amount = round2(e.amount + amount);
      e.lines.push(p.__row);
      const ref = get(p, mp.payout_ref);
      if (ref) e.refs.push(ref);
      e.date ||= get(p, mp.payout_date);
      e.courier ||= get(p, mp.courier);
      paid.set(key, e);
    }

    const orderKeys = new Set();
    const rows = [];
    for (const o of orderFile.rows) {
      const id = get(o, mo.order_id);
      const key = normalizeId(id);
      const direct = parseAmount(get(o, mo.expected_payout));
      const cod = parseAmount(get(o, mo.cod_amount));
      const fee = parseAmount(get(o, mo.courier_fee)) ?? 0;
      const expected = direct ?? (cod == null ? null : round2(cod - fee));
      if (!key || expected == null) continue;
      orderKeys.add(key);
      const p = paid.get(key);
      rows.push({
        id, key,
        customer: get(o, mo.customer) || "Customer",
        courier: courierName(get(o, mo.courier) || p?.courier),
        delivered: dateLabel(get(o, mo.delivered_at)),
        cod: cod ?? round2(expected + fee), fee, expected,
        expectedMethod: direct == null ? "calculated" : "provided",
        actual: p ? p.amount : null,
        payoutLines: p ? p.lines : [],
        payoutRefs: p ? p.refs : [],
        payoutDate: p?.date ? dateLabel(p.date) : null,
        orderLine: o.__row,
        linked: (links[id] || []).length > 0
      });
    }

    const unmatched = payoutFile.rows
      .filter(p => payoutKeyOf.has(p.__row) && !orderKeys.has(payoutKeyOf.get(p.__row)))
      .map(p => ({ line: p.__row, order_id: get(p, mp.order_id), amount: parseAmount(get(p, mp.payout_amount)), ref: get(p, mp.payout_ref), note: get(p, mp.note) }));

    const expected = round2(rows.reduce((s, r) => s + r.expected, 0));
    const received = round2(rows.reduce((s, r) => s + (r.actual ?? 0), 0));
    const exceptions = rows.filter(r => classify(r) !== "matched");
    const owed = round2(exceptions.filter(r => classify(r) !== "overpaid").reduce((s, r) => s + gap(r), 0));
    const over = round2(exceptions.filter(r => classify(r) === "overpaid").reduce((s, r) => s + gap(r), 0));
    return { ok: true, rows, unmatched, totals: { expected, received, owed, over, orders: rows.length, exceptions: exceptions.length } };
  }

  const fmt = n => `৳${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

  return { SYNONYMS, parseCsv, parseAmount, normalizeId, guessMapping, mappingProblems, reconcile, classify, gap, fmt, round2 };
})();

if (typeof module !== "undefined") module.exports = Engine;
