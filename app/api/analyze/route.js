/* Every chain read, the classifier, and the tools the model may reach for live
   in lib/agent.js so the report route and the chat route share one definition.
   They used to be copied into this file, and the copies drifted: scan_chain
   here had the Alchemy failover and the chat route's did not. */
import {
  AGENT_TOOLS,
  CHAINS,
  SCAN_CHAINS,
  TOOL_IMPL,
  agentChat,
  claudeConfigured,
  classify,
  fetchBalances,
  goldrush,
  pct,
  runScanChain,
  stripThink,
  usd,
} from "../../lib/agent";
import { toolOutcome } from "../../lib/investigation.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;


/* Below this, every ratio a diagnosis rests on is arithmetically true and
   practically meaningless: a third of a cent of ETH reads as "100% concentrated"
   with "no dry powder", and 100 - 39 is a confident-looking 61. Wallets under
   the floor still get investigated — looking almost empty on one chain is the
   best reason there is to go look at another — they just don't get a number. */
const DUST_FLOOR_USD = 10;

/* The trace is streamed to the client as each step lands, so the user watches
   the agent work instead of waiting on a spinner. `emit` is the wire. */
function makeTrace(emit) {
  const steps = [];

  const push = (step) => {
    steps.push(step);
    emit?.(step);
    return step;
  };

  return {
    steps,
    async run(tool, detail, fn, meta = {}) {
      const t0 = Date.now();
      try {
        const out = await fn();
        if (out?.error) throw new Error(out.error);
        push({ tool, detail, ms: Date.now() - t0, status: "ok", ...meta,
          ...(tool === "agent.tool" && out ? { outcome: toolOutcome(meta.name, out) } : {}),
        });
        return out;
      } catch (err) {
        push({
          tool,
          detail: detail + " — " + (err?.message || "failed"),
          ms: Date.now() - t0,
          status: "fail",
          ...meta,
        });
        return null;
      }
    },
    note(tool, detail, meta = {}) {
      push({ tool, detail, ms: 0, status: "ok", ...meta });
    },
  };
}


/* ------------------------------------------------------------------ */
/* deterministic engine — no model involved                            */
/* ------------------------------------------------------------------ */

function buildSeries(portfolio) {
  const map = new Map();
  for (const item of portfolio?.items || []) {
    for (const h of item.holdings || []) {
      const day = String(h.timestamp || "").slice(0, 10);
      if (!day) continue;
      map.set(day, (map.get(day) || 0) + Number(h?.close?.quote || 0));
    }
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));
}

function diagnose({ priced, unpriced, spam }, series, lastTxISO, chainLabel) {
  const total = priced.reduce((s, p) => s + p.value, 0);
  const findings = [];
  let penalty = 0;

  const add = (f) => {
    findings.push(f);
    penalty += f.penalty || 0;
  };

  if (total <= 0) {
    return {
      total: 0,
      score: null,
      grade: "No priced holdings",
      findings: [
        {
          id: "empty",
          severity: "note",
          title: "Nothing priced to diagnose",
          detail: `This wallet holds no tokens with a market price on ${chainLabel}. It may be empty, may hold only unlisted tokens, or may be active on a different chain.`,
          evidence: `${unpriced.length} unpriced · ${spam.length} filtered as spam`,
          penalty: 0,
        },
      ],
      metrics: { total: 0, positions: 0 },
      gradable: false,
      investigable: false,
    };
  }

  /* Above zero but under the floor. Report what is here, refuse to grade it,
     and let the investigation layer go looking on other chains. */
  if (total < DUST_FLOOR_USD) {
    const top = priced[0];
    return {
      total,
      score: null,
      gradable: false,
      investigable: true,
      grade: "Too little to grade",
      findings: [
        {
          id: "below-floor",
          severity: "note",
          title: "Not enough value here to score",
          detail: `This wallet holds ${usd(total)} across ${priced.length} priced position${
            priced.length === 1 ? "" : "s"
          } on ${chainLabel}. Concentration, stable buffer, drawdown — every ratio a health score is built from is technically correct at this size and tells you nothing, so there is no score above. What is worth knowing is whether the wallet is empty or just somewhere else, and that is what Rigel checks next.`,
          evidence: `${usd(total)} · ${priced.length} priced · ${unpriced.length} unpriced · ${spam.length} spam-filtered`,
          penalty: 0,
        },
      ],
      /* the shape ratios are deliberately null: the UI renders them as "—"
         rather than printing a meaningless 100.0% next to $0.00 */
      metrics: {
        total,
        positions: priced.length,
        topSymbol: top.symbol,
        topShare: null,
        hhi: null,
        stableShare: null,
        longtailShare: null,
        unpriced: unpriced.length,
        spam: spam.length,
        drawdown: null,
        change: null,
      },
    };
  }

  /* 1. concentration --------------------------------------------- */
  const top = priced[0];
  const topShare = top.value / total;
  const hhi = priced.reduce((s, p) => s + Math.pow(p.value / total, 2), 0);

  if (topShare >= 0.6) {
    add({
      id: "concentration",
      severity: "critical",
      title: "One position carries the whole wallet",
      detail: `${top.symbol} is ${pct(topShare)} of the portfolio. A bad week for a single token is a bad week for everything. This is the dominant risk here and every other finding is secondary to it.`,
      evidence: `${top.symbol} ${usd(top.value)} of ${usd(total)} · HHI ${hhi.toFixed(2)}`,
      penalty: 30,
    });
  } else if (topShare >= 0.4) {
    add({
      id: "concentration",
      severity: "warn",
      title: "Top position is heavy",
      detail: `${top.symbol} is ${pct(topShare)} of the portfolio. Not fatal, but the wallet moves with one asset more than the holder probably intends.`,
      evidence: `${top.symbol} ${usd(top.value)} of ${usd(total)} · HHI ${hhi.toFixed(2)}`,
      penalty: 14,
    });
  } else {
    add({
      id: "concentration",
      severity: "ok",
      title: "Weight is spread",
      detail: `Largest position is ${top.symbol} at ${pct(topShare)}. No single token dictates the outcome.`,
      evidence: `HHI ${hhi.toFixed(2)} · ${priced.length} priced positions`,
      penalty: 0,
    });
  }

  /* 2. effective diversification --------------------------------- */
  const meaningful = priced.filter((p) => p.value / total >= 0.01);
  if (meaningful.length <= 2 && priced.length > 2) {
    add({
      id: "effective-count",
      severity: "warn",
      title: "Diversification is mostly cosmetic",
      detail: `The wallet holds ${priced.length} priced tokens but only ${meaningful.length} are above 1% of value. The long tail looks like diversification on a screen and does nothing to the risk profile.`,
      evidence: `${meaningful.length} of ${priced.length} positions above 1%`,
      penalty: 8,
    });
  }

  /* 3. stable buffer --------------------------------------------- */
  const stableValue = priced
    .filter((p) => p.isStable)
    .reduce((s, p) => s + p.value, 0);
  const stableShare = stableValue / total;

  if (stableShare < 0.02) {
    add({
      id: "dry-powder",
      severity: "warn",
      title: "No dry powder",
      detail: `Stablecoins are ${pct(stableShare)} of the wallet. Nothing here can be deployed into a drawdown without first selling something at whatever price the market offers.`,
      evidence: `Stables ${usd(stableValue)} · ${pct(stableShare)}`,
      penalty: 9,
    });
  } else if (stableShare > 0.85) {
    add({
      id: "dry-powder",
      severity: "note",
      title: "Almost entirely idle",
      detail: `${pct(stableShare)} sits in stablecoins. That is a position too, and right now it is a position of waiting.`,
      evidence: `Stables ${usd(stableValue)}`,
      penalty: 0,
    });
  } else {
    add({
      id: "dry-powder",
      severity: "ok",
      title: "Buffer exists",
      detail: `${pct(stableShare)} in stablecoins gives the wallet something to act with without forced selling.`,
      evidence: `Stables ${usd(stableValue)}`,
      penalty: 0,
    });
  }

  /* 4. longtail exposure ----------------------------------------- */
  const longtail = priced
    .filter((p) => !p.isStable && !p.isMajor)
    .reduce((s, p) => s + p.value, 0);
  const longtailShare = longtail / total;

  if (longtailShare >= 0.7) {
    add({
      id: "longtail",
      severity: "warn",
      title: "Weighted to the long tail",
      detail: `${pct(longtailShare)} of value sits outside majors and stables. These are the positions that gap down hardest and are hardest to exit at size.`,
      evidence: `Long tail ${usd(longtail)} of ${usd(total)}`,
      penalty: 10,
    });
  }

  /* 5. unpriced positions ---------------------------------------- */
  if (unpriced.length >= 1) {
    add({
      id: "unpriced",
      severity: unpriced.length >= 5 ? "warn" : "note",
      title: `${unpriced.length} position${unpriced.length === 1 ? "" : "s"} with no market price`,
      detail: `These tokens have a balance but no quote from any tracked venue. Some are unlisted, most are airdropped noise. None of them count toward the portfolio value shown above, and treating them as wealth is the most common way people overestimate what they hold.`,
      evidence: unpriced
        .slice(0, 4)
        .map((u) => u.symbol)
        .join(" · "),
      penalty: unpriced.length >= 5 ? 5 : 0,
    });
  }

  /* 6. spam filter ------------------------------------------------ */
  if (spam.length > 0) {
    add({
      id: "spam",
      severity: "note",
      title: `${spam.length} token${spam.length === 1 ? "" : "s"} filtered as spam`,
      detail: `Excluded from every number on this page. These carry contract names that advertise a website or a claim page — the standard shape of a drainer lure. Do not approve them.`,
      evidence: spam
        .slice(0, 3)
        .map((s) => s.name.slice(0, 30))
        .join(" · "),
      penalty: 0,
    });
  }

  /* 7. dust drag -------------------------------------------------- */
  const dust = priced.filter((p) => p.value > 0 && p.value < 5);
  if (dust.length >= 4) {
    add({
      id: "dust",
      severity: "note",
      title: `${dust.length} positions under $5`,
      detail: `Together worth ${usd(dust.reduce((s, d) => s + d.value, 0))}. On most chains the gas to consolidate them costs more than the balances themselves, so the practical move is to ignore them rather than clean them up.`,
      evidence: dust
        .slice(0, 5)
        .map((d) => d.symbol)
        .join(" · "),
      penalty: 0,
    });
  }

  /* 8. drawdown --------------------------------------------------- */
  let drawdown = null;
  let change = null;
  if (series.length >= 4) {
    const values = series.map((s) => s.value);
    const peak = Math.max(...values);
    const current = values[values.length - 1];
    const first = values[0];
    drawdown = peak > 0 ? (peak - current) / peak : 0;
    change = first > 0 ? (current - first) / first : null;

    if (drawdown >= 0.35) {
      add({
        id: "drawdown",
        severity: "warn",
        title: "Sitting well below the recent peak",
        detail: `Value is down ${pct(drawdown)} from its high over the window. That is the market moving, not a mistake on its own — but it sets the context for every decision made from here.`,
        evidence: `Peak ${usd(peak)} → now ${usd(current)}`,
        penalty: 6,
      });
    }
  }

  /* 9. staleness --------------------------------------------------- */
  if (lastTxISO) {
    const days = Math.floor(
      (Date.now() - new Date(lastTxISO).getTime()) / 86400000
    );
    if (days >= 90) {
      add({
        id: "stale",
        severity: "note",
        title: `Dormant for ${days} days`,
        detail: `No outbound activity on ${chainLabel} in three months. Positions this old are usually held by default rather than by decision.`,
        evidence: `Last transaction ${String(lastTxISO).slice(0, 10)}`,
        penalty: 0,
      });
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const grade =
    score >= 80
      ? "Healthy"
      : score >= 60
      ? "Workable"
      : score >= 40
      ? "Fragile"
      : "High risk";

  const order = { critical: 0, warn: 1, ok: 2, note: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    total,
    score,
    grade,
    findings,
    gradable: true,
    investigable: true,
    metrics: {
      total,
      positions: priced.length,
      topSymbol: top.symbol,
      topShare,
      hhi,
      stableShare,
      longtailShare,
      unpriced: unpriced.length,
      spam: spam.length,
      drawdown,
      change,
    },
  };
}

/* ------------------------------------------------------------------ */
/* investigation layer — the model chooses where to look.              */
/* It never computes a number: every tool returns engine output, and   */
/* every finding below is derived deterministically from that output.  */
/* ------------------------------------------------------------------ */

const AGENT_MAX_STEPS = 4;

/* Steps alone do not bound the run. Each decision is a model call capped at 90s,
   so four of them can spend 360s against a maxDuration of 300 — and a measured
   jesse.base.eth run on 2026-08-31 spent 112s deciding across three steps, with
   one single call taking 68s. The ceiling therefore has to be wall-clock, not
   step count: past this point the loop concludes on the evidence already in
   hand rather than opening a decision it may not be able to finish.

   Measured from the start of the investigation, not the start of the request.
   Counting the baseline reads against it meant the provider's latency decided
   how much the agent got to think: on production those reads took 65s of a
   150s budget, one decide took 56s, and the loop stopped with 19s left having
   never opened a second step. The overall wall cap below is what protects
   maxDuration; this number is the investigation's own allowance. */
const AGENT_BUDGET_MS = 150_000;

/* Whatever the investigation is allowed, the response still has to land inside
   maxDuration (300s) with room for the written brief (~9s) and slack. */
const REQUEST_CAP_MS = 240_000;

/* Below this there is not enough left for a decision plus the lookups it would
   ask for, so starting one only risks the response. */
const AGENT_MIN_STEP_MS = 20_000;

/* Per-call cap, still applied under the budget above. */
const AGENT_STEP_TIMEOUT_MS = 90_000;

/* Asked for one sentence, the model sometimes answers with a formatted report
   — headings, bullets, a horizontal rule. The trace is a line, not a document,
   so flatten it rather than trusting the prompt to hold. */
function oneLine(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(#{1,6}|[-*>]|—)+\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Truncate to the last whole word inside `max` and mark it, so a clipped trace
   line reads as a summary rather than as a string that got cut off. */
function clip(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, "") + "…";
}


/* Findings produced from what the investigation turned up. Still no model
   arithmetic — these are computed here, from tool output. */
function crossChainFindings(report, scans) {
  const found = scans.filter((s) => s.totalUsd > 0);

  const where = found
    .slice()
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .map((s) => `${s.chain} ${usd(s.totalUsd)}`)
    .join(" · ");

  /* An ungradable wallet has no concentration penalty to refund and no share
     to restate, so it gets its own reading: where the money actually is, or
     that the sweep came back empty too. */
  if (!report.gradable) {
    if (!scans.length) return [];
    const checked = scans.map((s) => s.chain).join(", ");
    if (!found.length) {
      return [
        {
          id: "cross-chain",
          severity: "note",
          title: "Empty on every chain checked",
          detail: `${report.chainLabel} holds ${usd(
            report.total
          )} and there is nothing on ${checked} either. This wallet is not underweight or badly shaped — it is unused, and there is nothing here to diagnose.`,
          evidence: `${scans.length + 1} chains checked · no priced value found`,
          penalty: 0,
        },
      ];
    }
    const elsewhere = found.reduce((s, x) => s + x.totalUsd, 0);
    return [
      {
        id: "cross-chain",
        severity: "ok",
        title: "The wallet is real, the value is on another chain",
        detail: `${report.chainLabel} holds ${usd(
          report.total
        )}, which is why there is no score above. Elsewhere the same address holds ${usd(
          elsewhere
        )}. Run the diagnosis again against the chain holding the balance and it has something to actually measure.`,
        evidence: where,
        penalty: 0,
      },
    ];
  }

  if (!found.length) return [];

  const elsewhere = found.reduce((s, x) => s + x.totalUsd, 0);
  const combined = report.total + elsewhere;
  if (combined <= 0) return [];

  const topValue = report.total * (report.metrics.topShare || 0);
  const trueTop = topValue / combined;
  const prior = report.findings.find((f) => f.id === "concentration");
  const priorPenalty = prior?.penalty || 0;

  /* if the wider view clears the threshold that caused the penalty, give it
     back — the baseline reading was wrong, not the wallet */
  let refund = 0;
  if (trueTop < 0.4) refund = priorPenalty;
  else if (trueTop < 0.6 && priorPenalty >= 30) refund = 16;

  return [
    {
      id: "cross-chain",
      severity: refund > 0 ? "ok" : "note",
      title:
        refund > 0
          ? "The concentration reading was too harsh"
          : "More of this wallet sits on other chains",
      detail:
        refund > 0
          ? `Counting only ${report.chainLabel} made ${report.metrics.topSymbol} look like ${pct(
              report.metrics.topShare
            )} of everything. Across the chains checked, the wallet is worth ${usd(
              combined
            )} and ${report.metrics.topSymbol} is ${pct(
              trueTop
            )} of it. The single-chain view was the problem, not the portfolio.`
          : `Another ${usd(elsewhere)} sits outside ${report.chainLabel}, bringing the wallet to ${usd(
              combined
            )}. ${report.metrics.topSymbol} is ${pct(
              trueTop
            )} of the combined total rather than ${pct(report.metrics.topShare)}.`,
      evidence: where,
      penalty: -refund,
    },
  ];
}

function approvalFindings(risky) {
  if (!risky) return [];
  if (!risky.length) {
    return [
      {
        id: "approvals",
        severity: "ok",
        title: "No open approvals with value behind them",
        detail:
          "Every outstanding approval on this chain has nothing left for the spender to take. That is the state you want.",
        evidence: "0 approvals with value at risk",
        penalty: 0,
      },
    ];
  }

  const total = risky.reduce((s, r) => s + r.valueAtRisk, 0);
  const approvals = risky.reduce((s, r) => s + r.spenderCount, 0);
  const unlimited = risky.filter((r) => r.unlimited);
  const worst = risky[0];
  const severity = total >= 1000 ? "critical" : "warn";

  return [
    {
      id: "approvals",
      severity,
      title: `${usd(total)} exposed through ${approvals} open approval${
        approvals === 1 ? "" : "s"
      }`,
      detail: `${approvals} approvals are still live across ${risky.length} token${
        risky.length === 1 ? "" : "s"
      }${
        unlimited.length
          ? `, and ${unlimited.length} of those tokens carry at least one unlimited allowance`
          : ""
      }. The largest single exposure is ${usd(worst.valueAtRisk)} of ${
        worst.symbol
      }, reachable by ${worst.spender.slice(0, 10)}…${
        worst.lastSeen ? `, approved on ${String(worst.lastSeen).slice(0, 10)}` : ""
      }. This is live exposure that has nothing to do with how the portfolio is shaped — if any of these contracts is compromised, the balance leaves without another signature.`,
      evidence: risky
        .slice(0, 3)
        .map(
          (r) =>
            `${r.symbol} ${usd(r.valueAtRisk)}${
              r.spenderCount > 1 ? ` · ${r.spenderCount} spenders` : ""
            }${r.unlimited ? " · unlimited" : ""}`
        )
        .join("  |  "),
      penalty: severity === "critical" ? 18 : 8,
    },
  ];
}

/* The agent picks which position is worth inspecting; the arithmetic is the
   engine's, so a thin-float discovery moves the score exactly the way every
   other finding does. A tightly held supply is only a finding when the wallet
   actually has something in it — a ghost token you hold $12 of is noise. */
function tokenDepthFindings(checks = []) {
  const out = [];

  for (const t of checks) {
    if (!t || t.error) continue;

    const share = t.walletShare || 0;
    if (share < 0.05) continue;

    const tight = t.top10SupplyShare != null && t.top10SupplyShare >= 0.7;
    const few = t.holders != null && t.holders < 5000;
    if (!tight && !few) continue;

    const severity = tight && share >= 0.1 ? "critical" : "warn";

    out.push({
      id: `depth-${String(t.symbol).toLowerCase()}`,
      severity,
      title: `${t.symbol} is ${pct(share)} of the wallet and thinly held`,
      detail: `${
        tight
          ? `The ten largest addresses control ${pct(
              t.top10SupplyShare
            )} of ${t.symbol}'s supply.`
          : `${t.symbol} is held by ${t.holders.toLocaleString("en-US")} addresses.`
      } The position is ${usd(
        t.positionUsd
      )}. Concentration measures how much of the wallet rides on one name; this measures whether that name can be sold at all. A supply held by a handful of addresses is one where exiting at size is itself the event that moves the price.`,
      evidence: [
        t.holders != null ? `${t.holders.toLocaleString("en-US")} holders` : null,
        t.top10SupplyShare != null ? `top 10 hold ${pct(t.top10SupplyShare)} of supply` : null,
        t.asOf ? `as of ${t.asOf}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      penalty: severity === "critical" ? 12 : 6,
    });
  }

  return out;
}

async function investigate(ctx) {
  const { trace, report } = ctx;

  const hasGonka = Boolean(process.env.GONKA_API_KEY && process.env.GONKA_BASE_URL);
  if (!hasGonka && !claudeConfigured()) {
    trace.note("agent.skip", "no investigation endpoint configured — baseline findings only");
    return [];
  }

  const system = [
    "You are Rigel's investigator. A deterministic engine has already scanned one chain and produced the findings below. It computes every number; you never compute or state one.",
    "Decide what to look at next, and judge each lookup by one test: would the answer change the diagnosis this wallet's owner is about to act on? If it would not, do not spend the call.",
    "Three things the engine could not see — limits of where it looked, not of how it works:",
    "- It read one chain. How a wallet is shaped on one chain is not how it is shaped.",
    "- It measured the portfolio, which is what the owner holds. It did not measure what someone else is still permitted to move.",
    "- It sized every position but cannot tell whether one can be sold. How big a position is and whether it can be exited are different risks.",
    "Your tools speak to those blind spots. Which of them matter here — and whether any of them do — is a judgement about this wallet, not a rule to apply.",
    ...(report.gradable
      ? []
      : [
          "This wallet is below the value floor, so the engine refused to score it. The only question worth answering is whether the address is unused or simply active somewhere else. Nothing here is worth taking, so exposure is not the question.",
        ]),
    "You may call several tools at once. Stop when further lookups would not change the diagnosis — but stop by saying so, not by describing a check you did not run. Nothing is checked unless you call the tool.",
    "For each tool call, include a brief user-facing reason describing the question that lookup will answer for this wallet. Use one plain sentence, no internal deliberation, no numerical estimates, and no claim that the lookup has already succeeded.",
    "When you are done, reply with one short plain sentence naming what you checked and why. No numbers, no markdown, no headings or bullets — the engine writes the report, not you.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        "Baseline scan:\n\n" +
        JSON.stringify(
          {
            chain: report.chainLabel,
            totalValueUsd: Math.round(report.total),
            healthScore: report.score,
            metrics: report.metrics,
            /* the agent can only inspect a token it has been shown, which is
               also what stops it naming one that is not in the wallet */
            topHoldings: (ctx.holdings || []).slice(0, 8).map((h) => ({
              symbol: h.symbol,
              valueUsd: Math.round(h.value || 0),
              share: +(h.share || 0).toFixed(3),
            })),
            findings: report.findings.map((f) => ({
              severity: f.severity,
              title: f.title,
              evidence: f.evidence,
            })),
          },
          null,
          2
        ) +
        "\n\nDecide what to investigate.",
    },
  ];

  /* Whether anything was actually looked up, as opposed to described. */
  let toolsRun = 0;
  let nudged = false;

  for (let step = 0; step < AGENT_MAX_STEPS; step++) {
    const left = ctx.deadline - Date.now();
    if (left < AGENT_MIN_STEP_MS) {
      trace.note(
        "agent.stop",
        "investigation budget spent — concluding on the evidence already gathered"
      );
      break;
    }

    const decision = await trace.run(
      "agent.decide",
      `choosing what to investigate — step ${step + 1}`,
      () => agentChat(messages, AGENT_TOOLS, {
        timeoutMs: Math.min(AGENT_STEP_TIMEOUT_MS, left),
      })
    );
    const msg = decision?.message;
    if (!msg) break;
    if (decision.degradedFrom) {
      trace.note("agent.fallback", `decentralized node unavailable (${decision.degradedFrom})`);
    }

    const calls = msg.tool_calls || [];
    messages.push({
      role: "assistant",
      content: stripThink(msg.content),
      ...(calls.length ? { tool_calls: calls } : {}),
    });

    if (!calls.length) {
      const closing = stripThink(msg.content);

      /* Observed in production: the model answered "I checked token approvals
         because…" having called nothing at all. Narrating an action instead of
         taking it is a normal tool-calling failure, but the loop treated the
         prose as a conclusion and wrote the claim into the trace — a lie, in
         the one place this app promises not to invent anything. Ask once. */
      if (!toolsRun && !nudged) {
        nudged = true;
        trace.note("agent.retry", "answered without calling anything — asked to look or say why not");
        messages.push({
          role: "user",
          content:
            "You called no tool, so nothing has been checked and nothing was added to the report. Either call the tools you need now, or reply explaining why no lookup would change the diagnosis. Do not describe checks you have not run.",
        });
        continue;
      }

      /* A summary is only allowed to stand when there is something to
         summarise; otherwise record what actually happened, in our words. */
      if (toolsRun) {
        /* cut on a word boundary — a trace line ending mid-word ("…is now
           clear. Her") reads as a truncation bug rather than a summary */
        if (closing) trace.note("agent.conclude", clip(oneLine(closing), 160));
      } else {
        trace.note(
          "agent.skip",
          "the agent called no tools — the baseline scan stands on its own"
        );
      }
      break;
    }

    /* the agent's chosen lookups run concurrently */
    toolsRun += calls.length;

    await Promise.all(
      calls.map(async (call) => {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          /* malformed arguments — the impl will reject it */
        }
        /* label from whatever the tool was actually given — hardcoding `chain`
           left every inspect_token call reading as a bare `inspect_token()` */
        const shown = Object.entries(args || {}).filter(([key]) => key !== "reason").map(([, value]) => value)
          .filter((v) => typeof v === "string" && v.trim())
          .join(", ");
        const label = `${name}(${shown})`;
        const meta = {
          callId: call.id || `step-${step}-${calls.indexOf(call)}`,
          name,
          subject: shown,
          reason: typeof args.reason === "string" ? clip(oneLine(args.reason), 240) : null,
        };
        trace.note("agent.tool.start", label, meta);

        const out = await trace.run("agent.tool", label, () =>
          TOOL_IMPL[name] ? TOOL_IMPL[name](args, ctx) : Promise.resolve({ error: "no such tool" }), meta);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(out ?? { error: "lookup failed" }),
        });
      })
    );
  }

  return [
    ...crossChainFindings(report, ctx.scans),
    ...approvalFindings(ctx.approvals),
    ...tokenDepthFindings(ctx.tokenChecks),
  ];
}

/* ------------------------------------------------------------------ */
/* narration layer — the model only writes, it never scores            */
/* ------------------------------------------------------------------ */

async function writeBrief(facts) {
  const key = process.env.LLM_API_KEY;
  if (!key) return { text: null, reason: "no-key" };

  const base = process.env.LLM_BASE_URL || "https://api.anthropic.com";
  const model = process.env.LLM_MODEL || "claude-sonnet-4-6";

  const system = [
    "You are Rigel, a wallet diagnostics analyst.",
    "You are given the complete output of a deterministic risk engine. Write a short diagnosis for the wallet's owner.",
    "Rules, without exception:",
    "- Use only numbers that appear in the supplied facts. Never estimate, extrapolate, or invent a figure.",
    "- Do not predict prices or tell anyone to buy or sell a specific token.",
    "- Lead with the single thing that matters most. Do not restate every finding.",
    "- Three short paragraphs maximum, plain sentences, no headings, no bullet points, no markdown.",
    "- No hype, no reassurance the facts do not support, no filler openers.",
    "- If the picture is genuinely fine, say so briefly instead of manufacturing concern.",
    "- If healthScore is null the engine deliberately refused to grade this wallet. Say why in plain terms and stop. Do not invent a verdict, a grade, or a substitute score, and do not read meaning into percentages of a near-zero balance.",
  ].join("\n");

  const res = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system,
      messages: [
        {
          role: "user",
          content:
            "Risk engine output:\n\n" +
            JSON.stringify(facts, null, 2) +
            "\n\nWrite the diagnosis.",
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { text: null, reason: `upstream-${res.status}`, body: body.slice(0, 200) };
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { text: text || null, reason: text ? null : "empty", model };
}

/* ------------------------------------------------------------------ */
/* handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const address = String(body.address || "").trim();
  const chain = CHAINS[body.chain] ? body.chain : "base-mainnet";
  const chainLabel = CHAINS[chain];

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { ok: false, error: "That is not a valid address. Rigel needs a 40-character hex address starting with 0x." },
      { status: 400 }
    );
  }

  const key = process.env.GOLDRUSH_API_KEY;
  if (!key) {
    return Response.json(
      {
        ok: false,
        error:
          "The chain data key is not set on the server. Add it in your Vercel project settings and redeploy.",
      },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client disconnected — nothing to do */
        }
      };

      const trace = makeTrace((step) => send({ t: "step", step }));

      try {
        await analyze({ address, chain, chainLabel, key, trace, send });
      } catch (err) {
        send({ t: "error", error: err?.message || "The diagnosis failed to run." });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function analyze({ address, chain, chainLabel, key, trace, send }) {
  const startedAt = Date.now();
  trace.note("resolve", `${address} on ${chainLabel}`);

  /* These three reads are independent — nothing consumes one to build another,
     so they run concurrently. Sequentially this was ~51s; now it costs the
     slowest of the three. Steps stream in completion order, which is honest
     and reads as live. */
  const [balanceRead, portfolio, txs] = await Promise.all([
    trace.run(
      "chain.balances",
      `${chainLabel} · token balances and USD quotes`,
      () => fetchBalances(chain, address, key)
    ),
    trace.run("chain.portfolio", `${chainLabel} · 30-day daily holdings series`, () =>
      goldrush(`/${chain}/address/${address}/portfolio_v2/?quote-currency=USD`, key)
    ),
    trace.run(
      "chain.activity",
      `${chainLabel} · most recent transaction for the dormancy check`,
      /* no-logs is the whole cost of this call: the dormancy check reads one
         timestamp off the first item and never touches decoded events, and
         asking for them took the request from 3.6s to 76s against Base. */
      () =>
        goldrush(
          `/${chain}/address/${address}/transactions_v3/?page-size=1&no-logs=true`,
          key
        )
    ),
  ]);

  const balances = balanceRead?.data;

  if (!balances) {
    send({
      t: "error",
      error: "The chain data provider did not return balances for this address. Try again.",
    });
    return;
  }

  /* Which provider answered is part of the reading of the report, not a detail:
     on Alchemy the drawdown check has no series behind it. */
  const onBackupData = balanceRead.provider === "alchemy";
  if (onBackupData) {
    trace.note(
      "chain.failover",
      `GoldRush balances unavailable (${balanceRead.why}) — balances read from Alchemy instead`
    );
  }

  const buckets = classify(balances);
  trace.note(
    "engine.classify",
    `${buckets.priced.length} priced · ${buckets.unpriced.length} unpriced · ${buckets.spam.length} spam-filtered`
  );

  const series = buildSeries(portfolio);
  trace.note("engine.series", `${series.length} daily points reconstructed`);

  const lastTx = txs?.items?.[0]?.block_signed_at || null;

  const report = diagnose(buckets, series, lastTx, chainLabel);
  report.chainLabel = chainLabel;

  /* Backup balances keep the report alive; they must not be allowed to publish
     a number. Every ratio the score rests on — concentration, dry powder,
     long-tail weight — is taken over priced value, so a thinner price feed
     moves the score without anything in the wallet changing. Measured on
     jesse.base.eth: GoldRush prices 374 positions and scores 85, Alchemy
     prices 3 of the same wallet and the identical engine returns 48. Neither
     number is wrong arithmetic; the second one is answering a different
     question. The header promises this app never invents a number, so under
     failover it reports what it found and withholds the grade — the same
     contract the dust floor already keeps. */
  if (onBackupData && report.gradable) {
    report.gradable = false;
    report.score = null;
    report.grade = "Not scored — backup data";
    report.findings.unshift({
      id: "backup-data",
      severity: "note",
      title: "Not scored: the primary data provider was unavailable",
      detail:
        "Balances came from the backup provider, which prices fewer positions than the primary one. The health score is a ratio over priced value, so scoring this would measure the price feed rather than the wallet. The findings below are real and were computed the usual way; only the number is withheld.",
      evidence: `${buckets.priced.length} priced · ${buckets.unpriced.length} unpriced on backup data`,
      penalty: 0,
    });
  }
  trace.note(
    "engine.diagnose",
    `${report.findings.length} findings · health ${report.score ?? "n/a"}/100`,
    { baseline: { score: report.score, findings: report.findings.length, chainLabel } }
  );

  /* the agent decides what else is worth looking at; anything it turns up
     comes back as engine-computed findings, which can move the score */
  const ctx = {
    address,
    chain,
    chainLabel,
    key,
    trace,
    report,
    scans: [],
    approvals: null,
    tokenChecks: [],
    /* symbol → contract, so inspect_token resolves a name the agent was shown
       instead of accepting an address it could have invented */
    holdings: buckets.priced.map((p) => ({
      symbol: p.symbol,
      address: p.address,
      value: p.value,
      share: report.total ? p.value / report.total : 0,
    })),
    /* the investigation's own allowance, still floored by the request cap so a
       slow set of baseline reads cannot push the response past maxDuration */
    deadline: Math.min(Date.now() + AGENT_BUDGET_MS, startedAt + REQUEST_CAP_MS),
  };

  /* held so the report can show the score moving — the difference between this
     and the final score is the only honest measure of what the agent added */
  const baselineScore = report.score;
  const baselineFindings = report.findings.length;
  const baselineEvidence = { score: report.score, findings: baselineFindings, chainLabel };

  const extra = report.investigable ? await investigate(ctx) : [];

  /* For a wallet under the floor, "look somewhere else" is not a judgement
     call, so the engine sweeps even when the agent didn't choose to — and when
     there is no investigation endpoint configured at all. */
  if (!report.gradable && ctx.scans.length === 0) {
    for (const name of ["ethereum", "arbitrum", "optimism"]) {
      if (SCAN_CHAINS[name] === chain) continue;
      await trace.run("engine.sweep", `${name} — too little here to grade`, () =>
        runScanChain({ chain: name }, ctx)
      );
    }
    extra.push(...crossChainFindings(report, ctx.scans));
  }

  trace.note("engine.verify", "checking the findings against the scoring rules");
  if (extra.length) {
    report.findings.push(...extra);

    /* An ungradable wallet stays ungradable. Value found by a scan is a total,
       not a classified portfolio — scoring it would mean grading concentration
       and stable buffer we never computed. */
    if (report.gradable) {
      const penalty = report.findings.reduce((s, f) => s + (f.penalty || 0), 0);
      report.score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
      report.grade =
        report.score >= 80
          ? "Healthy"
          : report.score >= 60
          ? "Workable"
          : report.score >= 40
          ? "Fragile"
          : "High risk";
    }

    const order = { critical: 0, warn: 1, ok: 2, note: 3 };
    report.findings.sort((a, b) => order[a.severity] - order[b.severity]);

    report.metrics.chainsScanned = ctx.scans.length + 1;
    report.metrics.combinedTotal =
      report.total + ctx.scans.reduce((s, x) => s + x.totalUsd, 0);

    trace.note(
      "engine.revise",
      `${extra.length} finding${extra.length === 1 ? "" : "s"} added · health ${
        report.score ?? "n/a"
      }/100`
    );
  }

  const factsForModel = {
    chain: chainLabel,
    totalValueUsd: Math.round(report.total),
    healthScore: report.score,
    grade: report.grade,
    metrics: report.metrics,
    findings: report.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      evidence: f.evidence,
    })),
    topHoldings: buckets.priced.slice(0, 8).map((p) => ({
      symbol: p.symbol,
      valueUsd: Math.round(p.value),
      share: report.total ? +(p.value / report.total).toFixed(4) : 0,
    })),
  };

  /* trace.run swallows throws and returns null, which would leave both `brief`
     and `briefReason` empty — the UI would then render neither the diagnosis
     nor a notice, so an outage looks like a missing feature. Give the failure
     a reason of its own. */
  trace.note("report.start", "preparing the report from verified engine findings");
  const brief =
    (await trace.run("rigel.brief", "writing the diagnosis from engine facts", () =>
      writeBrief(factsForModel)
    )) || { text: null, reason: "unreachable" };

  send({
    t: "done",
    payload: {
      ok: true,
      generatedAt: new Date().toISOString(),
      coverage: {
        balanceProvider: balanceRead.provider,
        seriesPoints: series.length,
        lastTransaction: lastTx,
      },
      address,
      chain,
      chainLabel,
      total: report.total,
      score: report.score,
      baselineScore,
      baselineFindings,
      baselineEvidence,
      investigationFindings: extra,
      grade: report.grade,
      findings: report.findings,
      metrics: report.metrics,
      series,
      holdings: buckets.priced.slice(0, 12).map((p) => ({
        symbol: p.symbol,
        name: p.name,
        /* carried so the chat route can resolve inspect_token by symbol */
        address: p.address,
        logo: p.logo,
        value: p.value,
        units: p.units,
        share: report.total ? p.value / report.total : 0,
        isStable: p.isStable,
        isMajor: p.isMajor,
      })),
      brief: brief.text || null,
      briefReason: brief.reason || null,
      trace: trace.steps,
    },
  });
}
