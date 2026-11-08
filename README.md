# Ledgerly

Ledgerly checks a small online seller's cash-on-delivery orders against courier payout statements. An AI agent separates statement errors (typos, order numbers in notes, split payments) from money the seller is really owed, then drafts claims for the seller to approve.

**Live demo:** https://zachthedude.github.io/ledgerly/ (no sign-up; the sample files load automatically)

## Try it in one minute

1. The page opens on a messy Steadfast statement. Rules alone say ৳5,680 hasn't arrived.
2. Press **Check with the agent**. Watch the work sheet: it reads the files, maps the columns, finds likely matches and drafts claims. If a claim draft uses an amount that isn't in the ledger, Ledgerly sends it back and the agent fixes it.
3. Approve the links. The headline drops to the money that is really owed (৳530 in the sample).
4. Open **Claims** to edit, copy and track each claim. Switch **Claims in** to বাংলা before running to get Bangla drafts.
5. **Upload statements** accepts your own CSVs (`examples/` has the sample files).

## How the AI is used

An OpenAI model runs a tool-calling loop (`agent.js`). The tools run in the browser against the seller's files:

| Tool | What it does | Guardrail |
|---|---|---|
| `inspect_files` | Reads column keys and the first rows | Read-only |
| `map_columns_and_reconcile` | Model picks the columns; `engine.js` does the maths | Model never computes money |
| `propose_match` | Links stray statement lines to an order, with a reason | Queued for seller approval; Ledgerly computes the result |
| `draft_claim` | Writes a courier claim in English or Bangla | Every ৳ amount is checked against the ledger; wrong amounts are sent back |
| `finish` | Summary for the seller | |

The OpenAI key lives in a Cloudflare Worker (`worker/`), never in the page. If the agent can't be reached, the rules-based reconciliation still works and the work sheet says what failed.

## Run locally

```
python -m http.server 8123      # then open http://localhost:8123
node engine.test.js && node agent.test.js
```

The tests check the reconciliation maths and run the full agent loop against a scripted model (no network).

## Deploy the agent service

```
cd worker
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

Put the printed `*.workers.dev` URL in `AGENT_URL` at the top of `app.js`. `ALLOWED_ORIGINS` in `wrangler.toml` must include the site's origin. `MODEL` defaults to `gpt-5-mini`.

## Limits

Prototype: no courier API connections, no accounts, and claims are kept only for the browser session. The sample shop, customers and amounts are made up. Time saved and money recovered have not been measured with real sellers yet.

## Built with

Plain HTML, CSS and JavaScript (no build step), OpenAI tool calling, Cloudflare Workers. Built during the Agentic Hackathon.
