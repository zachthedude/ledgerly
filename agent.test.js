// node agent.test.js : runs the agent loop against a scripted model, no network.
const assert = require("assert");
const fs = require("fs");
const E = require("./engine.js");
const Agent = require("./agent.js");
const read = f => E.parseCsv(fs.readFileSync(__dirname + "/examples/" + f, "utf8"), f);
const ws = { orderFile: read("orders_nov_week1.csv"), payoutFile: read("steadfast_statement_2026-11-08.csv"), mapping: null, links: {}, result: null, suggestions: [], claims: [], shop: "Test Shop" };

const call = (name, args) => ({ id: name + Math.random(), type: "function", function: { name, arguments: JSON.stringify(args) } });
const script = [
  [call("inspect_files", {})],
  [call("map_columns_and_reconcile", { orders: { order_id: "order_no", cod_amount: "total_tk", courier_fee: "delivery_charge", customer: "customer_name" }, payouts: { order_id: "invoice", payout_amount: "payable_amount", note: "note", payout_ref: "consignment_id" } })],
  [call("propose_match", { order_id: "MH-10323", statement_lines: [4], reason: "Line 4 reads MH-1O323 with a letter O.", confidence: "high" }),
   call("propose_match", { order_id: "MH-10325", statement_lines: [6], reason: "Line 6 note says Invoice 10325.", confidence: "high" }),
   call("propose_match", { order_id: "MH-10327", statement_lines: [8], reason: "Line 8 is the balance for MH 10327.", confidence: "high" }),
   call("propose_match", { order_id: "MH-10324", statement_lines: [2], reason: "bad line", confidence: "low" })],
  [call("draft_claim", { order_id: "MH-10324", subject: "Short payout", message: "We expected ৳710 but got ৳640." })],
  [call("draft_claim", { order_id: "MH-10324", subject: "Short payout", message: "We expected ৳710 but received ৳650, a ৳60 shortfall." }),
   call("draft_claim", { order_id: "MH-10326", subject: "Missing payout", message: "৪৭০ টাকা পাওয়া যায়নি।" }),
   call("draft_claim", { order_id: "MH-10323", subject: "x", message: "৳2080" })],
  [call("finish", { summary: "3 flags were statement errors. ৳530 is owed." })]
];
const results = [];
let turn = 0;
const fetchImpl = async (url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(body.tools.length, 5);
  const calls = script[turn++];
  return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }] }) };
};
(async () => {
  const out = await Agent.run({ url: "x", ws, fetchImpl, onStep: s => s.type === "tool" && results.push(s) });
  assert.match(out.summary, /530/);
  const r = n => results.filter(s => s.name === n).map(s => s.result);
  assert.equal(r("map_columns_and_reconcile")[0].totals.owed, 5680);
  const pm = r("propose_match");
  assert.deepEqual(pm.map(x => x.ok), [true, true, true, false]);
  assert.equal(pm[2].status_if_approved, "matched");
  const dc = r("draft_claim");
  assert.equal(dc[0].ok, false); assert.match(dc[0].problem, /640/);
  assert.deepEqual(dc.slice(1).map(x => x.ok), [true, true, false]);
  assert.equal(ws.claims.length, 2);
  assert.equal(ws.result.totals.owed, 5680, "nothing changes before approval");
  assert.equal(ws.suggestions.filter(s => s.status === "pending").length, 3);
  assert.deepEqual(Agent.amountsIn("Tk 1,200 and ৳৬০ and 470 taka and line 5"), [1200, 60, 470]);
  // a broken service surfaces a readable error
  await assert.rejects(Agent.run({ url: "x", ws, fetchImpl: async () => ({ ok: false, status: 502 }) }), /502/);
  console.log("agent ok");
})().catch(e => { console.error(e); process.exit(1); });
