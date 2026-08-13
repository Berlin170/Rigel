import { agentChat, claudeConfigured } from "../../lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

const GOLDRUSH = "https://api.covalenthq.com/v1";

const CHAINS = {
  "eth-mainnet": "Ethereum",
  "base-mainnet": "Base",
  "arbitrum-mainnet": "Arbitrum",
  "optimism-mainnet": "Optimism",
  "matic-mainnet": "Polygon",
  "bsc-mainnet": "BNB Chain",
};

const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDC.E", "USDBC", "FRAX", "LUSD", "TUSD",
  "USDE", "PYUSD", "GHO", "CRVUSD", "SUSD", "USDS", "BUSD", "USDD",
]);

const MAJORS = new Set([
  "ETH", "WETH", "BTC", "WBTC", "CBETH", "WSTETH", "STETH", "RETH",
  "MATIC", "WMATIC", "BNB", "WBNB", "ARB", "OP", "LINK", "UNI", "AAVE",
]);

const SPAM_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|org|io|xyz|app|site|top|vip|cc|pro|fi|link)\b/i,
  /\bclaim\b/i,
  /\breward/i,
  /\bairdrop/i,
  /\bvisit\b/i,
  /\bvoucher\b/i,
  /\bgiveaway\b/i,
  /\bbonus\b/i,
  /\$\s?\d/,
  /[\u{1F300}-\u{1FAFF}]/u,
];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const usd = (n) =>
  n >= 1000
    ? "$" + Math.round(n).toLocaleString("en-US")
    : "$" + n.toFixed(2);

const pct = (n) => (n * 100).toFixed(1) + "%";

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
    async run(tool, detail, fn) {
      const t0 = Date.now();
      try {
        const out = await fn();
        push({ tool, detail, ms: Date.now() - t0, status: "ok" });
        return out;
      } catch (err) {
        push({
          tool,
          detail: detail + " — " + (err?.message || "failed"),
          ms: Date.now() - t0,
          status: "fail",
        });
        return null;
      }
    },
    note(tool, detail) {
      push({ tool, detail, ms: 0, status: "ok" });
    },
  };
}

async function goldrush(path, key) {
  const res = await fetch(`${GOLDRUSH}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GoldRush ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error_message || "GoldRush error");
  return json.data;
}

/* ------------------------------------------------------------------ */
/* deterministic engine — no model involved                            */
/* ------------------------------------------------------------------ */

function classify(balances) {
  const priced = [];
  const unpriced = [];
  const spam = [];

  for (const it of balances?.items || []) {
    if (it.type === "nft") continue;

    const raw = Number(it.balance || 0);
    if (!raw) continue;

    const symbol = (it.contract_ticker_symbol || "???").toUpperCase();
    const name = it.contract_name || "Unknown token";
    const value = Number(it.quote || 0);
    const rate = Number(it.quote_rate || 0);
    const decimals = it.contract_decimals ?? 18;

    const rec = {
      symbol,
      name,
      address: it.contract_address,
      logo: it.logo_urls?.token_logo_url || it.logo_urls?.protocol_logo_url || null,
      value,
      rate,
      units: raw / Math.pow(10, decimals),
      isStable: STABLES.has(symbol),
      isMajor: MAJORS.has(symbol),
    };

    const haystack = `${name} ${symbol}`;
    if (it.is_spam === true || SPAM_PATTERNS.some((r) => r.test(haystack))) {
      spam.push(rec);
      continue;
    }

    if (!rate || value <= 0) unpriced.push(rec);
    else priced.push(rec);
  }

  priced.sort((a, b) => b.value - a.value);
  unpriced.sort((a, b) => b.units - a.units);
  return { priced, unpriced, spam };
}

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

const SCAN_CHAINS = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  arbitrum: "arbitrum-mainnet",
  optimism: "optimism-mainnet",
  polygon: "matic-mainnet",
  bnb: "bsc-mainnet",
};

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "scan_chain",
      description:
        "Read this wallet's token balances on another EVM chain. Call this when concentration looks extreme, when the wallet looks nearly empty here, or when the holdings suggest the owner is active elsewhere. Value held on other chains changes what the concentration number actually means.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", enum: Object.keys(SCAN_CHAINS) },
        },
        required: ["chain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_approvals",
      description:
        "List outstanding token approvals and how much value each spender could still move today. Call this when the wallet holds material value. An unlimited approval left open to a stale contract is frequently a larger risk than the shape of the portfolio.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/* Kimi returns its chain of thought inline in `content`, sometimes with an
   unmatched closing tag. Everything before the last </think> is reasoning. */
function stripThink(text) {
  let s = String(text || "");
  const close = s.lastIndexOf("</think>");
  if (close !== -1) s = s.slice(close + 8);
  return s.replace(/<\/?think>/g, "").trim();
}

async function gonkaChat(messages, tools) {
  const base = (process.env.GONKA_BASE_URL || "").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GONKA_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GONKA_MODEL || "moonshotai/Kimi-K2.6",
      messages,
      tools,
      tool_choice: "auto",
      /* reasoning is billed against this budget too — a tight cap returns
         nothing but an unterminated think block */
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`inference ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message || null;
}

async function runScanChain(args, ctx) {
  const slug = SCAN_CHAINS[args?.chain];
  if (!slug || slug === ctx.chain) return { error: "not a chain worth scanning" };

  const data = await goldrush(
    `/${slug}/address/${ctx.address}/balances_v2/?quote-currency=USD&nft=false`,
    ctx.key
  );
  const b = classify(data);
  const total = b.priced.reduce((s, p) => s + p.value, 0);

  const result = {
    chain: CHAINS[slug],
    slug,
    totalUsd: Math.round(total),
    positions: b.priced.length,
    top: b.priced.slice(0, 5).map((p) => ({
      symbol: p.symbol,
      valueUsd: Math.round(p.value),
      share: total ? +(p.value / total).toFixed(3) : 0,
    })),
  };
  ctx.scans.push(result);
  return result;
}

async function runCheckApprovals(_args, ctx) {
  const data = await goldrush(`/${ctx.chain}/approvals/${ctx.address}/`, ctx.key);

  /* Deterministic ranking, grouped by token. Several spenders can each hold an
     allowance over the SAME balance, and the API repeats that balance on every
     one of them — so exposure is per token, not per spender. Summing spenders
     would count the same coins once per approval. */
  const byToken = new Map();

  for (const item of data?.items || []) {
    const symbol = item.ticker_symbol || "???";
    const spenders = (item.spenders || []).filter(
      (sp) => Number(sp.value_at_risk_quote || 0) > 0
    );
    if (!spenders.length) continue;

    /* one loss, not one per spender */
    const exposure = Math.max(...spenders.map((sp) => Number(sp.value_at_risk_quote || 0)));
    const worst = spenders.reduce((a, b) =>
      Number(b.value_at_risk_quote || 0) > Number(a.value_at_risk_quote || 0) ? b : a
    );

    const prior = byToken.get(symbol);
    if (prior && prior.valueAtRisk >= exposure) {
      prior.spenderCount += spenders.length;
      continue;
    }
    byToken.set(symbol, {
      symbol,
      valueAtRisk: exposure,
      spenderCount: (prior?.spenderCount || 0) + spenders.length,
      spender: worst.spender_address,
      unlimited: spenders.some((sp) => sp.allowance === "UNLIMITED"),
      lastSeen: worst.block_signed_at || null,
      flag: worst.risk_factor || null,
    });
  }

  const risky = [...byToken.values()].sort((a, b) => b.valueAtRisk - a.valueAtRisk);
  ctx.approvals = risky;

  return {
    tokensExposed: risky.length,
    openApprovals: risky.reduce((s, r) => s + r.spenderCount, 0),
    totalValueAtRiskUsd: Math.round(risky.reduce((s, r) => s + r.valueAtRisk, 0)),
    top: risky.slice(0, 5).map((r) => ({
      token: r.symbol,
      spenders: r.spenderCount,
      unlimited: r.unlimited,
      valueAtRiskUsd: Math.round(r.valueAtRisk),
      approvedOn: r.lastSeen ? String(r.lastSeen).slice(0, 10) : null,
    })),
  };
}

const TOOL_IMPL = { scan_chain: runScanChain, check_approvals: runCheckApprovals };

/* Findings produced from what the investigation turned up. Still no model
   arithmetic — these are computed here, from tool output. */
function crossChainFindings(report, scans) {
  const found = scans.filter((s) => s.totalUsd > 0);
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

  const where = found
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .map((s) => `${s.chain} ${usd(s.totalUsd)}`)
    .join(" · ");

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

async function investigate(ctx) {
  const { trace, report } = ctx;

  const hasGonka = Boolean(process.env.GONKA_API_KEY && process.env.GONKA_BASE_URL);
  if (!hasGonka && !claudeConfigured()) {
    trace.note("agent.skip", "no investigation endpoint configured — baseline findings only");
    return [];
  }

  const system = [
    "You are Rigel's investigator. A deterministic engine has already scanned one chain and produced the findings below.",
    "Your only job is to decide which follow-up tools to call. You never compute or state a number yourself.",
    "Call scan_chain when the concentration reading might be an artifact of looking at one chain, or when the wallet looks thin here.",
    "Call check_approvals when the wallet holds real value, because open approvals are a risk the portfolio shape cannot show.",
    "You may call several tools at once. Stop calling tools when further lookups would not change the diagnosis.",
    "When you are done, reply with one short sentence naming what you checked and why. No numbers.",
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

  for (let step = 0; step < AGENT_MAX_STEPS; step++) {
    const decision = await trace.run(
      "agent.decide",
      `choosing what to investigate — step ${step + 1}`,
      () => agentChat(messages, AGENT_TOOLS)
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
      if (closing) trace.note("agent.conclude", closing.slice(0, 160));
      break;
    }

    /* the agent's chosen lookups run concurrently */
    await Promise.all(
      calls.map(async (call) => {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          /* malformed arguments — the impl will reject it */
        }
        const label = args.chain ? `${name}(${args.chain})` : `${name}()`;

        const out = await trace.run("agent.tool", `${label} — the agent chose this`, () =>
          TOOL_IMPL[name] ? TOOL_IMPL[name](args, ctx) : Promise.resolve({ error: "no such tool" })
        );

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(out ?? { error: "lookup failed" }),
        });
      })
    );
  }

  return [...crossChainFindings(report, ctx.scans), ...approvalFindings(ctx.approvals)];
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
  trace.note("resolve", `${address} on ${chainLabel}`);

  /* These three reads are independent — nothing consumes one to build another,
     so they run concurrently. Sequentially this was ~51s; now it costs the
     slowest of the three. Steps stream in completion order, which is honest
     and reads as live. */
  const [balances, portfolio, txs] = await Promise.all([
    trace.run(
      "chain.balances",
      `${chainLabel} · token balances and USD quotes`,
      () =>
        goldrush(
          `/${chain}/address/${address}/balances_v2/?quote-currency=USD&nft=false`,
          key
        )
    ),
    trace.run("chain.portfolio", `${chainLabel} · 30-day daily holdings series`, () =>
      goldrush(`/${chain}/address/${address}/portfolio_v2/?quote-currency=USD`, key)
    ),
    trace.run(
      "chain.activity",
      `${chainLabel} · most recent transaction for the dormancy check`,
      () => goldrush(`/${chain}/address/${address}/transactions_v3/?page-size=1`, key)
    ),
  ]);

  if (!balances) {
    send({
      t: "error",
      error: "The chain data provider did not return balances for this address. Try again.",
    });
    return;
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
  trace.note(
    "engine.diagnose",
    `${report.findings.length} findings · health ${report.score ?? "n/a"}/100`
  );

  /* the agent decides what else is worth looking at; anything it turns up
     comes back as engine-computed findings, which can move the score */
  const ctx = { address, chain, chainLabel, key, trace, report, scans: [], approvals: null };

  /* held so the report can show the score moving — the difference between this
     and the final score is the only honest measure of what the agent added */
  const baselineScore = report.score;
  const baselineFindings = report.findings.length;

  const extra = report.score == null ? [] : await investigate(ctx);

  if (extra.length) {
    report.findings.push(...extra);
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

    const order = { critical: 0, warn: 1, ok: 2, note: 3 };
    report.findings.sort((a, b) => order[a.severity] - order[b.severity]);

    report.metrics.chainsScanned = ctx.scans.length + 1;
    report.metrics.combinedTotal =
      report.total + ctx.scans.reduce((s, x) => s + x.totalUsd, 0);

    trace.note(
      "engine.revise",
      `${extra.length} finding${extra.length === 1 ? "" : "s"} added · health ${report.score}/100`
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
  const brief =
    (await trace.run("rigel.brief", "writing the diagnosis from engine facts", () =>
      writeBrief(factsForModel)
    )) || { text: null, reason: "unreachable" };

  send({
    t: "done",
    payload: {
      ok: true,
      address,
      chain,
      chainLabel,
      total: report.total,
      score: report.score,
      baselineScore,
      baselineFindings,
      grade: report.grade,
      findings: report.findings,
      metrics: report.metrics,
      series,
      holdings: buckets.priced.slice(0, 12).map((p) => ({
        symbol: p.symbol,
        name: p.name,
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
