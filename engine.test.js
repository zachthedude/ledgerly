// node engine.test.js
const assert = require("assert");
const fs = require("fs");
const E = require("./engine.js");
const o = E.parseCsv(fs.readFileSync(__dirname + "/examples/orders_nov_week1.csv", "utf8"));
const p = E.parseCsv(fs.readFileSync(__dirname + "/examples/steadfast_statement_2026-11-08.csv", "utf8"));
const mapping = { orders: E.guessMapping("orders", o.keys), payouts: E.guessMapping("payouts", p.keys) };
assert.equal(mapping.orders.cod_amount, "total_tk");
assert.equal(mapping.payouts.order_id, "invoice");
const rules = E.reconcile(o, p, mapping);
assert.deepEqual([rules.totals.expected, rules.totals.received, rules.totals.owed], [10920, 5240, 5680]);
assert.equal(rules.totals.exceptions, 5);
assert.deepEqual(rules.unmatched.map(u => u.line), [4, 6, 8]);
const fixed = E.reconcile(o, p, mapping, { "MH-10323": [4], "MH-10325": [6], "MH-10327": [8] });
assert.deepEqual([fixed.totals.owed, fixed.totals.exceptions, fixed.unmatched.length], [530, 2, 0]);
assert.equal(E.parseAmount("৳১,২০০"), 1200);
assert.equal(E.reconcile(o, p, { orders: {}, payouts: mapping.payouts }).ok, false);
console.log("engine ok");
