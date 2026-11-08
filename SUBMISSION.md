# Devpost submission pack

## Tagline
An AI agent that tells small online sellers which missing courier payouts are real, and drafts the claims to get them back.

## Problem
In Bangladesh, many small online shops sell on Facebook and Instagram and get paid through cash on delivery. The courier collects the cash and pays the seller days later, minus fees, listed in a statement file. Checking that file against your own orders is slow, and the files are messy: each courier uses different columns, order numbers get typed wrong or only appear in a note, and one payment can arrive split over two lines. Matching by rules flags all of that as missing money. Sellers either spend hours on false alarms or stop checking, and then miss the payouts that really are short.

## Solution
Ledgerly reconciles the seller's order export against the courier statement. An AI agent then works through the flagged orders like a careful bookkeeper:
- reads both files and works out which column is which, whatever the courier calls them
- finds statement lines that belong to an order despite a typo, a note or a split payment, and cites the exact line
- waits for the seller to approve every link before anything changes
- drafts a claim to the courier, in English or Bangla, for each payout that is really short or missing

In the demo files, rules alone flag ৳5,680. After the agent's three approved links, ৳530 is left, and claims for it are ready to send. (Sample data, not a measured result.)

## Target users
Small online sellers in Bangladesh who use Pathao, RedX, Steadfast or similar couriers for cash on delivery, especially one-person and family shops that do their own accounts.

## How it uses AI
- An OpenAI model runs a tool-calling loop with five tools that execute in the browser: inspect files, map columns and reconcile, propose match, draft claim, finish.
- The model decides what to do next; Ledgerly's own code does every money calculation, so amounts are exact and traceable to file lines.
- Every claim draft is checked: a ৳ amount that isn't in the ledger is sent back to the agent to fix.
- People stay in charge: matches need approval, and claims are copied and sent by the seller, never automatically.
- The API key sits in a Cloudflare Worker, not in the page.
- [FILL IN: what you used Devin for. Only write what is true.]

## Setup for judges
Open the live link. Sample files load automatically; press "Check with the agent". To try other files, use Upload statements with the CSVs in `examples/`. Local run and deploy steps are in the README.

## Built with
javascript, html, css, openai, cloudflare-workers, github-pages

---

# Demo video script (about 2 minutes)

**0:00 Problem (opening screen)**
"This is a small shop's week of cash-on-delivery orders, checked against their Steadfast payout statement. Rules say ৳5,680 hasn't arrived. But courier statements are messy, so a lot of that is false alarms, and sellers can't tell which."

**0:20 Run the agent**
Press Check with the agent. "Ledgerly's agent reads both files, works out the columns itself and reconciles. Ledgerly's code does every calculation; the model never does the maths."

**0:40 Point at the work sheet as steps appear**
"It found likely matches: a typo with a letter O instead of a zero, an order number that only appears in a note, and a payment split over two lines. Each one cites the exact statement line."
If a red "sent back" step appears: "Here it used an amount that isn't in the ledger. Ledgerly sent it back and it fixed it."

**1:05 Approve**
Approve the links. "Nothing changes until I approve. Now the real answer: ৳530 is owed, not ৳5,680."

**1:20 Claims**
Open Claims. "The claims are drafted: a ৳60 short payment and a ৳470 missing one. I edit, copy into the courier's support chat, and track each until it's paid." Show the status menu.

**1:35 Bangla**
Switch Claims in to বাংলা, run again, show a Bangla draft.

**1:50 Close**
"Ledgerly turns a messy courier statement into the short list of money you're really owed, and the messages to get it back."

Tips: record at 1440 by 900, browser zoom 100%, bookmarks bar hidden. Cut out the waiting between agent steps.
