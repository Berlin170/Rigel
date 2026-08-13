# Rigel — wallet diagnostics agent

Most portfolio tools show you what you hold. Rigel tells you what is wrong with it.

Paste any EVM address. A deterministic engine reads the wallet and measures what is structurally wrong with the portfolio. Then an agent decides what the baseline scan missed — other chains, open approvals — and goes and looks. Everything it finds comes back through the same engine, so the score moves on evidence, not on opinion.

**The design rule: the model never scores anything.** It chooses where to look and it writes the diagnosis. Every number on the page is computed here, from a real API response. If inference is unavailable the engine still runs and the findings still render.

---

## What makes it an agent

The first pass is fixed: three chain reads, nine deterministic checks, a health score. Then the model gets the engine's output and decides for itself what to investigate.

On a wallet that looks 70% concentrated, it has chosen to scan Base and Arbitrum to test whether the concentration was an artifact of looking at one chain, and to pull the token approvals because a wallet holding real value can be drained without the portfolio shape ever showing it. It called those three lookups in one turn, then stopped, because more lookups would not have changed the diagnosis.

That run took the health score from **46 to 28** — not because the model decided so, but because `check_approvals` surfaced $3,143 reachable through 17 live approvals, and the engine scored it.

The trace at the bottom of every report shows each decision as it happens, streamed live while the agent works.

---

## Architecture

```
  three chain reads (concurrent)
            ↓
  deterministic engine  ──→  9 checks, findings, health score
            ↓
  AGENT LOOP            ──→  model picks tools:  scan_chain()
                                                 check_approvals()
            ↓
  engine re-scores over the enlarged evidence
            ↓
  written diagnosis, constrained to engine facts
            ↓
  chat — same tools, same constraint
```

| Layer | Runs on | Why |
|---|---|---|
| Scoring, every number | This codebase | Deterministic and auditable |
| Investigation + chat | Kimi K2.6, decentralized inference | Tool-capable, low cost per turn |
| Written diagnosis | Claude Sonnet 4.6 | One call per report, quality where it is read |

---

## Setup

1. Create a GitHub repo and upload every file, keeping the paths exactly:

```
package.json
.env.example
app/layout.js
app/page.js
app/globals.css
app/icon.svg
app/lib/agent.js
app/api/analyze/route.js
app/api/chat/route.js
```

Next.js resolves routes from the directory tree — flattening these breaks the build.

2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Add the environment variables below under **Settings → Environment Variables**.
4. **Redeploy.** Vercel does not apply new variables to an existing build.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `GOLDRUSH_API_KEY` | yes | Chain data key |
| `LLM_API_KEY` | no | Anthropic key for the written diagnosis |
| `LLM_BASE_URL` | no | Defaults to `https://api.anthropic.com` |
| `LLM_MODEL` | no | Defaults to `claude-sonnet-4-6` |
| `GONKA_API_KEY` | no | Broker key for the agent loop and chat |
| `GONKA_BASE_URL` | no | Your broker's OpenAI-compatible base URL |
| `GONKA_MODEL` | no | Defaults to `moonshotai/Kimi-K2.6` |

Every optional key degrades cleanly. Without `GONKA_*` the agent loop is skipped and the report falls back to the baseline nine checks. Without `LLM_API_KEY` the findings render with a notice instead of the written diagnosis. Never put keys in client code — every call goes through a server route.

---

## The deterministic checks

| Check | Trigger | Penalty |
|---|---|---|
| Concentration | top position ≥ 60% / ≥ 40% | 30 / 14 |
| Effective diversification | ≤ 2 positions above 1% of value | 8 |
| Dry powder | stables under 2% of value | 9 |
| Long-tail weight | ≥ 70% outside majors and stables | 10 |
| Unpriced positions | 5 or more tokens with no market quote | 5 |
| Drawdown | ≥ 35% below the 30-day peak | 6 |
| Spam tokens | contract name advertises a site or claim page | filtered, 0 |
| Dust | 4 or more positions under $5 | 0 |
| Dormancy | no transaction in 90 days | 0 |

Added by the agent when it chooses to look:

| Check | Trigger | Penalty |
|---|---|---|
| Open approvals | value reachable by a spender ≥ $1,000 / > $0 | 18 / 8 |
| Cross-chain | value found outside the scanned chain | refunds concentration if the wider view clears it |

Health score starts at 100 and subtracts penalties. Bands: 80+ healthy, 60+ workable, 40+ fragile, below 40 high risk.

**Approvals are counted per token, not per spender.** Several spenders can each hold an allowance over the same balance, and the API repeats that balance on every one of them. Summing them would count the same coins once per approval.

---

## Chat

Ask follow-up questions about a report. The same tools are available, under the same constraint: answers come from the engine's numbers or from a tool result, never from the model's own arithmetic. It will not predict a price.

---

## Running locally

```bash
npm install
cp .env.example .env    # fill in your keys
npm run dev
```

Stop the dev server before `npm run build` — both write to `.next`, and building while dev is running corrupts it.

---

## Submission copy

> Rigel is an autonomous wallet diagnostics agent for EVM chains. A deterministic engine reads any address and measures what is structurally wrong with the portfolio — concentration, dry powder, long-tail weight, unpriced and spam positions, drawdown, dormancy. Then the agent decides what the first pass missed and goes looking: scanning other chains when a concentration reading looks like a single-chain artifact, pulling token approvals when the wallet holds enough to be worth draining. Everything it finds is scored by the same engine, so the health score moves on evidence. On one run it took a wallet from 46 to 28 after finding $3,143 reachable through 17 live approvals that no portfolio view would ever show. The full sequence of decisions streams live in the trace. The model chooses where to look and writes the diagnosis; it never produces a number. Most portfolio tools show you what you hold. Rigel tells you what is wrong with it.

---

Not financial advice — always DYOR.
