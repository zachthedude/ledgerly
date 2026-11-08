const AGENT_URL = window.LEDGERLY_AGENT_URL || "https://ledgerly-agent.zachthedude.workers.dev";
const E = Engine;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = E.fmt;

let ws, filter = "review", query = "", run = { state: "idle", steps: [], error: "", summary: "" }, isSample = true;

function loadFiles(orderFile, payoutFile, sample) {
  isSample = sample;
  ws = { orderFile, payoutFile, links: {}, suggestions: [], claims: [], shop: "Mrittika Home" };
  ws.mapping = { orders: E.guessMapping("orders", orderFile.keys), payouts: E.guessMapping("payouts", payoutFile.keys) };
  ws.result = E.reconcile(orderFile, payoutFile, ws.mapping);
  run = { state: "idle", steps: [], error: "", summary: "" };
  filter = "review"; query = ""; $("#search").value = "";
  render();
}

const loadSample = () => loadFiles(E.parseCsv(SAMPLES.orders.text, SAMPLES.orders.name), E.parseCsv(SAMPLES.payouts.text, SAMPLES.payouts.name), true);
const pendingFor = id => ws.suggestions.find(s => s.orderId === id && s.status === "pending");
const claimFor = id => ws.claims.find(c => c.orderId === id);

function statusOf(r) {
  const k = E.classify(r);
  const s = pendingFor(r.id);
  if (k === "matched") return { k, text: r.linked ? "Matched, linked by you" : "Matched" };
  if (k === "overpaid") return { k, text: `Overpaid ${fmt(E.gap(r))}` };
  const base = k === "missing" ? "No payout found" : `Short ${fmt(E.gap(r))}`;
  if (s) return { k: "suggested", text: `${base}. Agent found a likely match` };
  if (claimFor(r.id)) return { k, text: `${base}. Claim drafted` };
  return { k, text: base };
}

function render() {
  const r = ws.result;
  $("#data-tag").textContent = isSample ? "Sample shop" : "Your files";
  $("#reset-sample").hidden = isSample;
  $("#files-line").innerHTML = `<span>${esc(ws.orderFile.name)}</span> checked against <span>${esc(ws.payoutFile.name)}</span>`;
  $("#claim-count").textContent = ws.claims.length;
  if (!r.ok) {
    $("#headline").textContent = "Ledgerly couldn't read these columns by itself.";
    $("#subline").textContent = `${r.problems.join(". ")}. The agent can work out which column is which.`;
  } else {
    const t = r.totals;
    $("#headline").innerHTML = t.owed
      ? `<span class="owed">${fmt(t.owed)}</span> of ${fmt(t.expected)} hasn't reached you.`
      : `All ${fmt(t.expected)} has reached you.`;
    const pending = ws.suggestions.filter(s => s.status === "pending").length;
    $("#subline").textContent = pending
      ? `The agent thinks ${pending} of these ${pending === 1 ? "flag is a statement error" : "flags are statement errors"}. Approve or reject each one in the work sheet.`
      : t.exceptions
        ? `${t.exceptions} of ${t.orders} orders need you.${run.state === "idle" ? " Typos and notes in courier statements cause many false alarms." : ""}`
        : `${t.orders} orders matched their courier payouts.`;
  }
  renderLedger();
  renderSheet();
  renderClaims();
}

function renderLedger() {
  const r = ws.result;
  const body = $("#rows");
  if (!r.ok) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><strong>No ledger yet</strong><span>Ask the agent to map the columns, or upload files with headers like order_id and payout_amount.</span></div></td></tr>`;
    ["review", "matched", "all"].forEach(k => $("#n-" + k).textContent = "");
    return;
  }
  const review = r.rows.filter(x => E.classify(x) !== "matched");
  $("#n-review").textContent = review.length;
  $("#n-matched").textContent = r.rows.length - review.length;
  $("#n-all").textContent = r.rows.length;
  $$(".filter").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
  const q = query.toLowerCase();
  const rows = r.rows.filter(x => (filter === "all" || (filter === "matched") === (E.classify(x) === "matched")) && (!q || `${x.id} ${x.customer}`.toLowerCase().includes(q)));
  body.innerHTML = rows.length ? rows.map(x => {
    const s = statusOf(x);
    return `<tr class="${s.k}">
      <td data-label="Order"><button type="button" class="order" data-open="${esc(x.id)}">${esc(x.id)}</button><span class="cust">${esc(x.customer)}, ${esc(x.courier)}</span></td>
      <td data-label="Delivered">${esc(x.delivered)}</td>
      <td data-label="Expected" class="num">${fmt(x.expected)}</td>
      <td data-label="Received" class="num">${x.actual == null ? '<span class="none">Not received</span>' : `<span class="m">got </span>${fmt(x.actual)}`}</td>
      <td data-label="Status"><span class="status">${esc(s.text)}</span></td>
    </tr>`;
  }).join("") : `<tr><td colspan="5"><div class="empty"><strong>${filter === "review" && !q ? "Nothing needs you" : "No orders match"}</strong><span>${filter === "review" && !q ? "Every order in these files matches its courier payout." : "Clear the search or pick another filter."}</span></div></td></tr>`;
}

const STEP = {
  inspect_files: (a, r) => ["Read both files", `${r.orders.row_count} orders and ${r.payouts.row_count} statement lines. Columns include ${r.payouts.columns.slice(0, 4).join(", ")}.`],
  map_columns_and_reconcile: (a, r) => r.ok
    ? ["Mapped the columns and reconciled", `Order ID is "${a.orders.order_id}" and "${a.payouts.order_id}"; payout is "${a.payouts.payout_amount}". Rules alone flag ${r.totals.exceptions} orders, ${fmt(r.totals.owed)}. ${r.unmatched_statement_lines.length} statement lines match no order.`]
    : ["Column mapping rejected", r.problems.join(". "), "warn"],
  propose_match: (a, r) => r.ok
    ? [`Found a likely match for ${a.order_id}`, `Statement line ${a.statement_lines.join(" and ")}, ${a.confidence} confidence. Waiting for your approval above.`]
    : [`Match for ${a.order_id} rejected by Ledgerly`, r.problem, "warn"],
  draft_claim: (a, r) => r.ok
    ? [`Drafted a claim for ${a.order_id}`, "Every taka amount checked against the ledger."]
    : [`Claim for ${a.order_id} sent back`, r.problem, "warn"],
  finish: a => ["Done", a.summary, "done"]
};

function renderSheet() {
  const intro = $("#ws-intro"), btn = $("#run-agent");
  const r = ws.result;
  if (run.state === "idle") {
    intro.innerHTML = r.ok && r.totals.exceptions === 0
      ? "<p>Nothing to check. Every order matched.</p>"
      : `<p>${r.ok ? `The rules flagged ${r.totals.exceptions} orders.` : "The rules couldn't map these files."} The agent reads the statement like you would: it looks for typos, order numbers in notes and split payments, then drafts claims for what is really missing.</p>`;
  } else if (run.state === "error") {
    intro.innerHTML = `<p class="error"><strong>The agent stopped.</strong> ${esc(run.error)} Your ledger is unchanged.</p>`;
  } else intro.innerHTML = "";

  $("#steps").innerHTML = run.steps.map((s, i) => `<li class="${s.tone || ""}"><strong>${esc(s.title)}</strong>${s.detail ? `<span>${esc(s.detail)}</span>` : ""}</li>`).join("")
    + (run.state === "running" ? `<li class="working"><strong>Working</strong><span>Waiting for the model's next step</span></li>` : "");

  const pend = ws.suggestions.filter(s => s.status === "pending");
  $("#suggestions").innerHTML = pend.length ? `<h3>Waiting for you</h3>` + pend.map(s => `
    <div class="suggestion">
      <p><strong>Link statement line ${s.lines.join(" and ")} to ${esc(s.orderId)}</strong></p>
      <p>${esc(s.reason)}</p>
      <p class="math">Expected ${fmt(s.expected)}. Received ${s.before == null ? "nothing" : fmt(s.before)} now, ${fmt(s.after)} if linked.${s.resultStatus === "matched" ? " That settles it." : ` Still ${s.resultStatus}.`} Confidence: ${esc(s.confidence)}.</p>
      <div class="row"><button type="button" class="button primary small" data-approve="${s.id}">Approve link</button><button type="button" class="button small" data-reject="${s.id}">Reject</button></div>
    </div>`).join("") : "";

  btn.hidden = run.state === "running" || (r.ok && r.totals.exceptions === 0 && run.state !== "error");
  btn.textContent = run.state === "idle" ? "Check with the agent" : "Run the agent again";
  btn.classList.toggle("primary", run.state === "idle" || run.state === "error");
}

function renderClaims() {
  const list = $("#claims-list");
  if (!ws.claims.length) {
    list.innerHTML = `<div class="empty big"><strong>No claims yet</strong><span>Run the agent on the Reconcile tab. It drafts a claim for each payout that is really short or missing.</span><button type="button" class="button primary" data-goto="reconcile">Go to Reconcile</button></div>`;
    return;
  }
  list.innerHTML = ws.claims.map(c => `
    <article class="claim" data-claim="${c.id}">
      <header><h2>${esc(c.orderId)}</h2><span>${esc(c.courier)}, ${c.kind === "missing" ? "missing" : "short"} ${fmt(c.amount)}</span><span class="by">${c.by === "agent" ? "Drafted by the agent, amounts checked" : "Drafted from template"}</span></header>
      <label>Subject<input type="text" data-field="subject" value="${esc(c.subject)}"></label>
      <label>Message<textarea data-field="message" rows="9">${esc(c.message)}</textarea></label>
      <div class="row">
        <label class="inline">Status
          <select data-field="status">
            <option value="draft"${c.status === "draft" ? " selected" : ""}>Draft</option>
            <option value="sent"${c.status === "sent" ? " selected" : ""}>Sent to courier</option>
            <option value="paid"${c.status === "paid" ? " selected" : ""}>Courier paid</option>
            <option value="refused"${c.status === "refused" ? " selected" : ""}>Courier refused</option>
          </select>
        </label>
        <button type="button" class="button primary small" data-copy="${c.id}">Copy message</button>
      </div>
    </article>`).join("");
}

function toast(text, tone = "") {
  const n = document.createElement("div");
  n.className = `toast ${tone}`;
  n.textContent = text;
  $("#toasts").append(n);
  setTimeout(() => n.remove(), 4000);
}

async function runAgent() {
  run = { state: "running", steps: [], error: "", summary: "" };
  ws.suggestions = ws.suggestions.filter(s => s.status !== "pending");
  render();
  try {
    const out = await Agent.run({
      url: AGENT_URL, ws, language: $("#language").value,
      onChange: () => render(),
      onStep: s => {
        if (s.type === "tool" && STEP[s.name]) {
          const [title, detail, tone] = STEP[s.name](s.args, s.result);
          run.steps.push({ title, detail, tone });
        }
        renderSheet();
      }
    });
    run.state = "done";
    if (!run.steps.some(s => s.tone === "done") && out.summary) run.steps.push({ title: "Done", detail: out.summary, tone: "done" });
  } catch (e) {
    run.state = "error";
    run.error = e.message;
  }
  render();
}

function decide(id, approve) {
  const s = ws.suggestions.find(x => x.id === id);
  if (!s) return;
  s.status = approve ? "approved" : "rejected";
  if (approve) {
    ws.links[s.orderId] = [...(ws.links[s.orderId] || []), ...s.lines];
    ws.result = E.reconcile(ws.orderFile, ws.payoutFile, ws.mapping, ws.links);
  }
  render();
  toast(approve ? `Linked line ${s.lines.join(", ")} to ${s.orderId}.` : `Rejected. ${s.orderId} stays flagged.`);
}

function openOrder(id) {
  const r = ws.result.rows.find(x => x.id === id);
  if (!r) return;
  const k = E.classify(r);
  $("#detail-title").textContent = `${r.id}, ${r.customer}`;
  const lines = r.payoutLines.length ? `Statement line ${r.payoutLines.join(" + ")}${r.payoutRefs.length ? ` (${r.payoutRefs.join(", ")})` : ""} in ${ws.payoutFile.name}` : `No line in ${ws.payoutFile.name} carries this order ID`;
  $("#detail-body").innerHTML = `<dl class="facts">
    <div><dt>Expected</dt><dd>${fmt(r.expected)} <small>${r.expectedMethod === "provided" ? "from the order export" : `${fmt(r.cod)} collected less ${fmt(r.fee)} delivery charge`}</small></dd></div>
    <div><dt>Received</dt><dd>${r.actual == null ? "Nothing" : fmt(r.actual)}${r.payoutDate ? ` <small>paid ${esc(r.payoutDate)}</small>` : ""}</dd></div>
    <div><dt>${k === "matched" ? "Difference" : k === "overpaid" ? "Overpaid by" : "Owed to you"}</dt><dd class="${k === "matched" ? "" : "owed"}">${fmt(k === "matched" ? 0 : E.gap(r))}</dd></div>
    <div><dt>Evidence</dt><dd>Order export line ${r.orderLine}. ${esc(lines)}.</dd></div>
  </dl>`;
  const btn = $("#detail-claim");
  btn.hidden = k === "matched" || k === "overpaid";
  btn.textContent = claimFor(r.id) ? "Open claim" : "Draft claim";
  btn.dataset.id = r.id;
  $("#detail-dialog").showModal();
}

function templateClaim(id) {
  const r = ws.result.rows.find(x => x.id === id);
  const missing = r.actual == null;
  ws.claims.push({
    id: `c${Date.now()}`, orderId: r.id, courier: r.courier, amount: E.gap(r), kind: missing ? "missing" : "short", by: "template", status: "draft",
    subject: `Payout ${missing ? "missing" : "short"} for ${r.id}`,
    message: `Hello ${r.courier} support,\n\nOrder ${r.id} was delivered on ${r.delivered}. Our expected payout is ${fmt(r.expected)}, but ${missing ? `we can't find it in ${ws.payoutFile.name}` : `the statement shows ${fmt(r.actual)}`}. The unpaid amount is ${fmt(E.gap(r))}.\n\nPlease check and let us know when it will be adjusted.\n\nThank you,\n${ws.shop}`
  });
}

function showView(v) {
  $$(".view-tab").forEach(b => b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  $("#view-reconcile").hidden = v !== "reconcile";
  $("#view-claims").hidden = v !== "claims";
  scrollTo({ top: 0 });
}

function exportCsv() {
  if (!ws.result.ok) return toast("Nothing to export until the columns are mapped.", "error");
  const head = ["order_id", "customer", "courier", "delivered", "expected", "received", "difference", "status", "statement_lines"];
  const lines = ws.result.rows.map(r => [r.id, r.customer, r.courier, r.delivered, r.expected, r.actual ?? "", E.classify(r) === "matched" ? 0 : E.gap(r), statusOf(r).text, r.payoutLines.join(" ")]);
  const csv = [head, ...lines].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "ledgerly-report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Report downloaded.");
}

function init() {
  loadSample();
  $("#run-agent").addEventListener("click", runAgent);
  $("#search").addEventListener("input", e => { query = e.target.value.trim(); renderLedger(); });
  $$(".filter").forEach(b => b.addEventListener("click", () => { filter = b.dataset.filter; renderLedger(); }));
  $$(".view-tab").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#export").addEventListener("click", exportCsv);
  $("#reset-sample").addEventListener("click", () => { loadSample(); toast("Sample files loaded."); });
  $("#how-open").addEventListener("click", () => $("#how-dialog").showModal());
  $("#upload-open").addEventListener("click", () => { $("#upload-error").textContent = ""; $("#upload-dialog").showModal(); });
  $$("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

  $("#upload-form").addEventListener("submit", async e => {
    e.preventDefault();
    const [o, p] = [$("#file-orders").files[0], $("#file-payouts").files[0]];
    if (!o || !p) { $("#upload-error").textContent = "Choose both files."; return; }
    try {
      const [of, pf] = [E.parseCsv(await o.text(), o.name), E.parseCsv(await p.text(), p.name)];
      if (!of.rows.length || !pf.rows.length) throw new Error(`${!of.rows.length ? o.name : p.name} has no data rows under its header.`);
      loadFiles(of, pf, false);
      $("#upload-dialog").close();
      $("#upload-form").reset();
      toast(`${of.rows.length} orders and ${pf.rows.length} statement lines loaded.`);
    } catch (err) { $("#upload-error").textContent = err.message || "These files couldn't be read as CSV."; }
  });

  $("#rows").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openOrder(b.dataset.open); });
  $("#suggestions").addEventListener("click", e => {
    const a = e.target.closest("[data-approve]"), r = e.target.closest("[data-reject]");
    if (a) decide(a.dataset.approve, true);
    if (r) decide(r.dataset.reject, false);
  });
  $("#detail-claim").addEventListener("click", e => {
    const id = e.currentTarget.dataset.id;
    if (!claimFor(id)) { templateClaim(id); toast(`Claim drafted for ${id}. Check it before sending.`); }
    $("#detail-dialog").close();
    render();
    showView("claims");
  });
  $("#claims-list").addEventListener("input", e => {
    const card = e.target.closest("[data-claim]"), field = e.target.dataset.field;
    const c = card && ws.claims.find(x => x.id === card.dataset.claim);
    if (c && field) c[field] = e.target.value;
  });
  $("#claims-list").addEventListener("click", async e => {
    if (e.target.closest("[data-goto]")) return showView("reconcile");
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const c = ws.claims.find(x => x.id === b.dataset.copy);
    try { await navigator.clipboard.writeText(`${c.subject}\n\n${c.message}`); toast("Message copied. Paste it into your courier's support channel."); }
    catch { toast("Copy was blocked by the browser. Select the message and copy it.", "error"); }
  });
}

init();
