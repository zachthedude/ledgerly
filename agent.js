// The reconciliation agent: an OpenAI tool-calling loop. Tools run here in the browser against the
// seller's files; the model only decides which tool to call next. Money is always computed by Engine.
const Agent = (() => {
  const E = typeof Engine !== "undefined" ? Engine : require("./engine.js");

  const fieldProps = kind => Object.fromEntries(Object.keys(E.SYNONYMS[kind]).map(f => [f, { type: ["string", "null"], description: `Column key for ${f}, or null if absent` }]));

  const TOOLS = [
    { name: "inspect_files", description: "Read the column keys, row counts and first rows of the order export and the courier statement, plus the column mapping Ledgerly's rules guessed.", parameters: { type: "object", properties: {}, additionalProperties: false } },
    { name: "map_columns_and_reconcile", description: "Set which column holds each field, then run the deterministic reconciliation. Returns totals, every exception and every courier statement line that matched no order.", parameters: { type: "object", properties: { orders: { type: "object", properties: fieldProps("orders") }, payouts: { type: "object", properties: fieldProps("payouts") } }, required: ["orders", "payouts"] } },
    { name: "propose_match", description: "Propose attaching unmatched courier statement lines to an order (typo in the ID, ID only in a note, split payment). The seller must approve it; nothing changes until then. Returns the amounts Ledgerly computes for the match.", parameters: { type: "object", properties: { order_id: { type: "string" }, statement_lines: { type: "array", items: { type: "integer" }, description: "Line numbers from the courier statement" }, reason: { type: "string", description: "One sentence the seller can check against the file" }, confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["order_id", "statement_lines", "reason", "confidence"] } },
    { name: "draft_claim", description: "Draft a claim message to the courier for an order that is still short or missing after your proposed matches. Every taka amount you write is checked against the ledger.", parameters: { type: "object", properties: { order_id: { type: "string" }, subject: { type: "string" }, message: { type: "string" } }, required: ["order_id", "subject", "message"] } },
    { name: "finish", description: "End the run with a two-sentence summary for the seller.", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } }
  ].map(t => ({ type: "function", function: t }));

  function systemPrompt(language, shop) {
    return `You are Ledgerly's payout reconciliation agent for ${shop}, a small online seller in Bangladesh that gets cash-on-delivery money from couriers.
Goal: find out which flagged orders are really unpaid and prepare claims for those only.
Steps:
1. inspect_files.
2. map_columns_and_reconcile with the right column keys. If a key in the guessed mapping is wrong, fix it.
3. For each exception, look at the unmatched statement lines: IDs with typos (letter O for zero, missing dashes), order numbers that only appear in a note, or one payment split across several lines. Call propose_match only when the evidence is in the file, and say exactly what it is. Never propose a match whose amounts don't add up unless you say so.
4. For every exception your proposals do not explain, call draft_claim. Write it ${language === "bn" ? "in Bangla (বাংলা), polite and short, using ৳ for amounts" : "in plain, polite English, using ৳ for amounts"}. Cite the order ID, the statement reference if any, the expected and received amounts from the tool results. Sign it from ${shop}. If draft_claim reports an amount problem, fix it and draft again.
5. finish.
Rules: never do arithmetic yourself; use the amounts tools return. Never claim a claim was sent; the seller sends it. Be brief between tool calls.`;
  }

  const BN = "০১২৩৪৫৬৭৮৯";
  const AMOUNT_RE = /(?:৳|\btk\.?|\bbdt\b|\btaka\b)\s*([\d০-৯][\d০-৯,]*(?:\.\d+)?)|([\d০-৯][\d০-৯,]*(?:\.\d+)?)\s*(?:৳|\btk\b|\bbdt\b|\btaka\b|টাকা)/gi;
  function amountsIn(text) {
    const out = [];
    for (const m of text.matchAll(AMOUNT_RE)) out.push(Number((m[1] || m[2]).replace(/[০-৯]/g, d => BN.indexOf(d)).replace(/,/g, "")));
    return out;
  }

  // ws: { orderFile, payoutFile, mapping, links, result, suggestions, claims, shop }
  function makeTools(ws, onChange = () => {}) {
    const exceptionView = r => ({ order_id: r.id, status: E.classify(r), expected: r.expected, received: r.actual, difference: E.gap(r), statement_lines: r.payoutLines, statement_refs: r.payoutRefs, courier: r.courier, delivered: r.delivered });
    const rerun = () => { ws.result = E.reconcile(ws.orderFile, ws.payoutFile, ws.mapping, ws.links); onChange(); return ws.result; };
    const sample = f => ({ file: f.name, columns: f.keys, row_count: f.rows.length, first_rows: f.rows.slice(0, 4).map(({ __row, ...rest }) => ({ line: __row, ...rest })) });

    return {
      inspect_files() {
        return { orders: sample(ws.orderFile), payouts: sample(ws.payoutFile), guessed_mapping: { orders: E.guessMapping("orders", ws.orderFile.keys), payouts: E.guessMapping("payouts", ws.payoutFile.keys) } };
      },
      map_columns_and_reconcile({ orders, payouts }) {
        const next = { orders: orders || {}, payouts: payouts || {} };
        const test = E.reconcile(ws.orderFile, ws.payoutFile, next, ws.links);
        if (!test.ok) return { ok: false, problems: test.problems };
        ws.mapping = next;
        const r = rerun();
        return { ok: true, totals: r.totals, exceptions: r.rows.filter(x => E.classify(x) !== "matched").map(exceptionView), unmatched_statement_lines: r.unmatched };
      },
      propose_match({ order_id, statement_lines, reason, confidence }) {
        if (!ws.result?.ok) return { ok: false, problem: "Run map_columns_and_reconcile first." };
        const row = ws.result.rows.find(r => E.normalizeId(r.id) === E.normalizeId(order_id));
        if (!row) return { ok: false, problem: `No order ${order_id} in the order export.` };
        const lines = [...new Set(statement_lines || [])];
        const free = new Set(ws.result.unmatched.map(u => u.line));
        const bad = lines.filter(l => !free.has(l));
        if (!lines.length || bad.length) return { ok: false, problem: `Lines ${bad.join(", ") || "(none)"} are not unmatched statement lines.` };
        const trial = E.reconcile(ws.orderFile, ws.payoutFile, ws.mapping, { ...ws.links, [row.id]: [...(ws.links[row.id] || []), ...lines] });
        const after = trial.rows.find(r => r.id === row.id);
        ws.suggestions = ws.suggestions.filter(s => !(s.orderId === row.id && s.status === "pending"));
        const s = { id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`, orderId: row.id, lines, reason, confidence, before: row.actual, after: after.actual, expected: row.expected, resultStatus: E.classify(after), status: "pending" };
        ws.suggestions.push(s);
        onChange();
        return { ok: true, queued_for_seller_approval: true, expected: row.expected, received_if_approved: after.actual, status_if_approved: s.resultStatus, difference_if_approved: E.gap(after) };
      },
      draft_claim({ order_id, subject, message }) {
        if (!ws.result?.ok) return { ok: false, problem: "Run map_columns_and_reconcile first." };
        const row = ws.result.rows.find(r => E.normalizeId(r.id) === E.normalizeId(order_id));
        if (!row) return { ok: false, problem: `No order ${order_id}.` };
        const kind = E.classify(row);
        if (kind === "matched" || kind === "overpaid") return { ok: false, problem: `${row.id} is ${kind}; no claim needed.` };
        if (ws.suggestions.some(s => s.orderId === row.id && s.status === "pending" && s.resultStatus === "matched")) return { ok: false, problem: `${row.id} is explained by your pending match; no claim needed.` };
        const known = [row.expected, row.actual, E.gap(row), row.cod, row.fee].filter(n => n != null).map(E.round2);
        const unknown = amountsIn(`${subject}\n${message}`).filter(n => !known.includes(E.round2(n)));
        if (unknown.length) return { ok: false, problem: `These amounts are not in the ledger for ${row.id}: ${unknown.map(E.fmt).join(", ")}. Allowed: ${known.map(E.fmt).join(", ")}.` };
        ws.claims = ws.claims.filter(c => !(c.orderId === row.id && c.status === "draft"));
        ws.claims.push({ id: `c${Date.now()}`, orderId: row.id, courier: row.courier, amount: E.gap(row), kind, subject, message, status: "draft", checked: true, by: "agent", created: new Date().toISOString() });
        onChange();
        return { ok: true, saved_as_draft_for_seller: true, amounts_checked: true };
      },
      finish({ summary }) { return { ok: true, summary }; }
    };
  }

  async function run({ url, ws, language = "en", onStep = () => {}, onChange, fetchImpl = fetch, maxTurns = 14 }) {
    const tools = makeTools(ws, onChange);
    const messages = [
      { role: "system", content: systemPrompt(language, ws.shop) },
      { role: "user", content: `Check my payouts. Order export: ${ws.orderFile.name}. Courier statement: ${ws.payoutFile.name}.` }
    ];
    for (let turn = 0; turn < maxTurns; turn++) {
      onStep({ type: "thinking" });
      let res;
      try {
        res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, tools: TOOLS }) });
      } catch {
        throw new Error("Couldn't reach the agent service. Check your connection and try again.");
      }
      if (!res.ok) throw new Error(`The agent service returned an error (${res.status}). Try again in a minute.`);
      const msg = (await res.json()).choices?.[0]?.message;
      if (!msg) throw new Error("The agent service sent an empty reply.");
      messages.push(msg);
      if (msg.content) onStep({ type: "note", text: msg.content });
      if (!msg.tool_calls?.length) return { summary: msg.content || "" };
      for (const call of msg.tool_calls) {
        const name = call.function?.name;
        let args, result;
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = null; }
        if (!args) result = { ok: false, problem: "Arguments were not valid JSON." };
        else if (!tools[name]) result = { ok: false, problem: `Unknown tool ${name}.` };
        else result = await tools[name](args);
        onStep({ type: "tool", name, args: args || {}, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        if (name === "finish" && result.ok) return { summary: args.summary };
      }
    }
    throw new Error(`The agent stopped after ${maxTurns} steps without finishing. Your ledger is unchanged; try again.`);
  }

  return { TOOLS, run, makeTools, amountsIn, systemPrompt };
})();

if (typeof module !== "undefined") module.exports = Agent;
