/* Shared agent core: chain reads, the deterministic classifier, and the tools
   the model is allowed to reach for. Imported by both the report route and the
   chat route so there is exactly one definition of each tool. */

export const GOLDRUSH = "https://api.covalenthq.com/v1";

export const CHAINS = {
  "eth-mainnet": "Ethereum",
  "base-mainnet": "Base",
  "arbitrum-mainnet": "Arbitrum",
  "optimism-mainnet": "Optimism",
  "matic-mainnet": "Polygon",
  "bsc-mainnet": "BNB Chain",
};

export const SCAN_CHAINS = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  arbitrum: "arbitrum-mainnet",
  optimism: "optimism-mainnet",
  polygon: "matic-mainnet",
  bnb: "bsc-mainnet",
};

export const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDC.E", "USDBC", "FRAX", "LUSD", "TUSD",
  "USDE", "PYUSD", "GHO", "CRVUSD", "SUSD", "USDS", "BUSD", "USDD",
]);

export const MAJORS = new Set([
  "ETH", "WETH", "BTC", "WBTC", "CBETH", "WSTETH", "STETH", "RETH",
  "MATIC", "WMATIC", "BNB", "WBNB", "ARB", "OP", "LINK", "UNI", "AAVE",
]);

export const SPAM_PATTERNS = [
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

export const usd = (n) =>
  n >= 1000 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + Number(n).toFixed(2);

export const pct = (n) => (n * 100).toFixed(1) + "%";

export async function goldrush(path, key) {
  const res = await fetch(`${GOLDRUSH}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`chain data ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error_message || "chain data error");
  return json.data;
}

export function classify(balances) {
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

/* ------------------------------------------------------------------ */
/* decentralized inference — OpenAI-compatible, tool-calling           */
/* ------------------------------------------------------------------ */

/* Kimi returns its chain of thought inline in `content`, sometimes with an
   unmatched closing tag. Everything before the last </think> is reasoning. */
export function stripThink(text) {
  let s = String(text || "");
  const close = s.lastIndexOf("</think>");
  if (close !== -1) s = s.slice(close + 8);
  return s.replace(/<\/?think>/g, "").trim();
}

export function gonkaConfigured() {
  return Boolean(process.env.GONKA_API_KEY && process.env.GONKA_BASE_URL);
}

/* The broker runs behind an edge function with its own wall-clock limit, and
   Kimi reasons for a long time on large prompts — left alone a call can sit for
   five minutes and then 504. Bound it here so a slow turn degrades into a
   readable message instead of a hang. */
export async function gonkaChat(messages, tools, { maxTokens = 2000, timeoutMs = 90000 } = {}) {
  const base = (process.env.GONKA_BASE_URL || "").replace(/\/$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.GONKA_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GONKA_MODEL || "moonshotai/Kimi-K2.6",
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        /* reasoning is billed against this budget too — a tight cap returns
           nothing but an unterminated think block */
        max_tokens: maxTokens,
      }),
    });

    if (res.status === 504 || res.status === 524) {
      throw new Error("the inference node timed out");
    }
    if (!res.ok) throw new Error(`inference ${res.status}`);

    const json = await res.json();
    return json.choices?.[0]?.message || null;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("the inference node timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* fallback inference — Anthropic, same tool loop, different wire shape */
/* ------------------------------------------------------------------ */

export function claudeConfigured() {
  return Boolean(process.env.LLM_API_KEY);
}

/* Messages are held in OpenAI shape because that is what the broker speaks.
   Anthropic wants system hoisted out, tool calls as content blocks, and tool
   results as user turns — so translate on the way in and back on the way out. */
function toAnthropic(messages, tools) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "tool") {
      const prev = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: String(m.content ?? ""),
      };
      /* consecutive tool results belong in one user turn */
      if (prev?.role === "user" && Array.isArray(prev.content)) prev.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }

    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.tool_calls) {
        let input = {};
        try {
          input = JSON.parse(c.function?.arguments || "{}");
        } catch {
          /* leave empty — the impl rejects it */
        }
        blocks.push({ type: "tool_use", id: c.id, name: c.function?.name, input });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    if (!m.content) continue;
    out.push({ role: m.role, content: String(m.content) });
  }

  return {
    system,
    messages: out,
    tools: tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    })),
  };
}

async function claudeChat(messages, tools, { maxTokens = 2000, timeoutMs = 90000 } = {}) {
  const base = (process.env.LLM_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const req = toAnthropic(messages, tools);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.LLM_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "claude-sonnet-4-6",
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(req.tools?.length ? { tools: req.tools } : {}),
        messages: req.messages,
      }),
    });

    if (!res.ok) throw new Error(`fallback inference ${res.status}`);
    const json = await res.json();

    /* back into OpenAI shape so callers stay provider-agnostic */
    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const tool_calls = (json.content || [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));

    return { role: "assistant", content: text, ...(tool_calls.length ? { tool_calls } : {}) };
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("fallback inference timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* Decentralized inference first — that is the point — but the broker's latency
   swings by an order of magnitude and it returns 504/429 under load. Falling
   back keeps the agent alive on a bad night instead of silently degrading to a
   dashboard. Returns which provider actually answered so the trace can say so. */
export async function agentChat(messages, tools, opts = {}) {
  let firstError = null;

  if (gonkaConfigured()) {
    try {
      const message = await gonkaChat(messages, tools, opts);
      if (message) return { message, provider: "gonka" };
      firstError = new Error("empty response");
    } catch (err) {
      firstError = err;
    }
  }

  if (claudeConfigured()) {
    const message = await claudeChat(messages, tools, opts);
    return { message, provider: "claude", degradedFrom: firstError?.message || null };
  }

  throw firstError || new Error("no inference provider configured");
}

/* ------------------------------------------------------------------ */
/* the tools the model may choose                                      */
/* ------------------------------------------------------------------ */

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "scan_chain",
      description:
        "Read this wallet's token balances on another EVM chain. Call this when concentration looks extreme, when the wallet looks nearly empty here, or when the holdings suggest the owner is active elsewhere. Value held on other chains changes what the concentration number actually means.",
      parameters: {
        type: "object",
        properties: { chain: { type: "string", enum: Object.keys(SCAN_CHAINS) } },
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

export async function runScanChain(args, ctx) {
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
  ctx.scans?.push(result);
  return result;
}

export async function runCheckApprovals(_args, ctx) {
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
  if (ctx) ctx.approvals = risky;

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

export const TOOL_IMPL = {
  scan_chain: runScanChain,
  check_approvals: runCheckApprovals,
};
