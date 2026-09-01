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

/* The agent fires its chosen lookups concurrently, and GoldRush throttles a
   burst from one key with a 403 — not a 401-shaped "your key is bad", just a
   momentary no. Measured on a four-call step: three came back 403 and the
   identical calls succeeded ~2s later. Retrying transient statuses here is the
   difference between a trace full of red and one that reads as a clean run. */
export async function goldrush(path, key, { tries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GOLDRUSH}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json();
      if (json.error) throw new Error(json.error_message || "GoldRush error");
      return json.data;
    }

    /* 0.7s, 1.4s, 2.8s. Three tries at half this was still exhausting the
       limiter when four lookups went out at once; the steps have a 90s cap, so
       waiting longer costs less than losing the lookup. */
    const transient = res.status === 429 || res.status === 403 || res.status >= 500;
    if (transient && attempt < tries - 1) {
      await new Promise((r) => setTimeout(r, 700 * 2 ** attempt + Math.random() * 400));
      continue;
    }

    /* The status matters to whoever is reading the trace: a 429 under load and
       a 401 from a missing key are the same blank screen otherwise. 403 only
       reaches here after the retries, so by now it really is a refusal. */
    const why =
      res.status === 429
        ? "rate limited"
        : res.status === 401
        ? "key rejected"
        : res.status === 403
        ? "throttled or forbidden after retries"
        : res.status >= 500
        ? "provider error"
        : `HTTP ${res.status}`;
    throw new Error(`GoldRush ${res.status} — ${why}`);
  }
}

/* ------------------------------------------------------------------ */
/* balance failover                                                    */
/* ------------------------------------------------------------------ */

const ALCHEMY_NETWORKS = {
  "eth-mainnet": "eth-mainnet",
  "base-mainnet": "base-mainnet",
  "arbitrum-mainnet": "arb-mainnet",
  "optimism-mainnet": "opt-mainnet",
  "matic-mainnet": "matic-mainnet",
  "bsc-mainnet": "bnb-mainnet",
};

/* Alchemy reports the native coin as a null tokenAddress with null metadata,
   so the symbol has to come from the chain rather than the record. */
const NATIVE_COIN = {
  "eth-mainnet": ["ETH", "Ether"],
  "base-mainnet": ["ETH", "Ether"],
  "arbitrum-mainnet": ["ETH", "Ether"],
  "optimism-mainnet": ["ETH", "Ether"],
  "matic-mainnet": ["POL", "Polygon Ecosystem Token"],
  "bsc-mainnet": ["BNB", "BNB"],
};

/* Reshaped into Covalent's items[] because classify() is the single place that
   reads a balance record, and it should not learn about a second provider. */
export async function alchemyBalances(chain, address) {
  const key = process.env.ALCHEMY_API_KEY;
  const network = ALCHEMY_NETWORKS[chain];
  if (!key || !network) return null;

  const res = await fetch(`https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      addresses: [{ address, networks: [network] }],
      withMetadata: true,
      withPrices: true,
    }),
  });
  if (!res.ok) throw new Error(`Alchemy ${res.status}`);

  const json = await res.json();
  const [nativeSymbol, nativeName] = NATIVE_COIN[chain] || ["ETH", "Ether"];

  const items = (json?.data?.tokens || []).map((t) => {
    const native = !t.tokenAddress;
    const decimals = t.tokenMetadata?.decimals ?? 18;
    const rate = Number((t.tokenPrices || []).find((q) => q.currency === "usd")?.value || 0);
    /* hex wei, wider than Number can hold exactly */
    const raw = BigInt(t.tokenBalance || "0x0").toString();
    const units = Number(raw) / Math.pow(10, decimals);

    return {
      contract_ticker_symbol: native ? nativeSymbol : t.tokenMetadata?.symbol || "???",
      contract_name: native ? nativeName : t.tokenMetadata?.name || "Unknown token",
      contract_address: t.tokenAddress || null,
      contract_decimals: decimals,
      balance: raw,
      quote_rate: rate,
      quote: units * rate,
      logo_urls: { token_logo_url: t.tokenMetadata?.logo || null },
    };
  });

  return { items };
}

/* GoldRush first — it is the richer record, and it is the one the rest of the
   pipeline is calibrated against. Alchemy only answers when it does not. */
export async function fetchBalances(chain, address, key) {
  try {
    const data = await goldrush(
      `/${chain}/address/${address}/balances_v2/?quote-currency=USD&nft=false`,
      key
    );
    return { data, provider: "goldrush", why: null };
  } catch (err) {
    const data = await alchemyBalances(chain, address);
    if (!data) throw err;
    return { data, provider: "alchemy", why: err.message };
  }
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
  {
    type: "function",
    function: {
      name: "inspect_token",
      description:
        "Look up how one token is distributed: how many addresses hold it, and how much of the supply the largest holders control. Concentration is only half the question — a position is a different risk when the token is held by millions of addresses than when ten addresses control most of the supply and cannot be exited at size. Only the holdings on the chain being diagnosed can be inspected; a token seen through scan_chain on another chain is not reachable here.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Ticker symbol, exactly as it appears in the holdings.",
          },
        },
        required: ["symbol"],
      },
    },
  },
];

export async function runScanChain(args, ctx) {
  const slug = SCAN_CHAINS[args?.chain];
  if (!slug || slug === ctx.chain) return { error: "not a chain worth scanning" };

  /* The cross-chain scan is the tool that clears a false concentration reading,
     so it fails over too — a 429 here would leave the agent unable to prove the
     wallet is fine. */
  const { data } = await fetchBalances(slug, ctx.address, ctx.key);
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

/* The agent names a symbol it was shown; resolving that to a contract here
   rather than letting the model pass an address means it cannot invent one. */
export async function runInspectToken(args, ctx) {
  const want = String(args?.symbol || "").trim().toUpperCase();
  if (!want) return { error: "name a token symbol from the holdings" };

  const held = (ctx.holdings || []).find((h) => String(h.symbol).toUpperCase() === want);
  if (!held?.address) return { error: `${want} is not a priced holding on this chain` };

  const data = await goldrush(`/${ctx.chain}/tokens/${held.address}/token_holders_v2/`, ctx.key);

  /* One page is the top holders by balance, and pagination carries the full
     holder count — enough to say whether supply sits in a few hands without
     walking millions of rows. */
  const items = data?.items || [];
  if (!items.length) return { error: `no holder data for ${want}` };

  const scale = Math.pow(10, items[0]?.contract_decimals ?? 18);
  const supply = Number(items[0]?.total_supply || 0) / scale;
  const balances = items.map((i) => Number(i.balance || 0) / scale).sort((a, b) => b - a);
  const top10 = balances.slice(0, 10).reduce((s, b) => s + b, 0);

  const result = {
    symbol: want,
    holders: data?.pagination?.total_count ?? null,
    top10SupplyShare: supply > 0 ? +(top10 / supply).toFixed(3) : null,
    positionUsd: Math.round(held.value || 0),
    walletShare: +(held.share || 0).toFixed(3),
    asOf: data?.updated_at ? String(data.updated_at).slice(0, 10) : null,
  };

  ctx.tokenChecks?.push(result);
  return result;
}

export const TOOL_IMPL = {
  scan_chain: runScanChain,
  check_approvals: runCheckApprovals,
  inspect_token: runInspectToken,
};

/* ------------------------------------------------------------------ */
/* streaming inference                                                 */
/* ------------------------------------------------------------------ */

/* Both providers speak SSE. Read it line by line and hand each `data:`
   payload to the caller; the frame boundaries mean nothing to us. */
async function readSse(res, onPayload) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      onPayload(payload);
    }
  }
}

/* Kimi splits reasoning out into `delta.reasoning` when streaming, but it has
   also been seen inlining a <think> block in `content`. Emit only the part of
   the content that is genuinely the answer, and never more than once. */
function answerSoFar(content) {
  if (!content.includes("<think")) return content;
  const close = content.lastIndexOf("</think>");
  return close === -1 ? "" : content.slice(close + 8);
}

/* A caller's abort (the hedge losing) and our own deadline both have to reach
   the same fetch, so fold the outer signal into the local controller. */
function linkAbort(signal, timeoutMs) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener("abort", onAbort);
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return {
    signal: ctl.signal,
    release() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

/* Streams the turn and still returns the finished message in OpenAI shape, so
   the tool loop above is unchanged — it just gets to show its work first. */
export async function gonkaChatStream(
  messages,
  tools,
  { maxTokens = 2000, timeoutMs = 45000, signal } = {},
  onDelta = () => {}
) {
  const base = (process.env.GONKA_BASE_URL || "").replace(/\/$/, "");
  const link = linkAbort(signal, timeoutMs);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: link.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.GONKA_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GONKA_MODEL || "moonshotai/Kimi-K2.6",
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (res.status === 504 || res.status === 524) {
      throw new Error("the inference node timed out");
    }
    if (!res.ok) throw new Error(`inference ${res.status}`);

    let content = "";
    let emitted = 0;
    const calls = new Map();

    await readSse(res, (payload) => {
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) return;

      if (delta.reasoning) onDelta({ type: "think", text: delta.reasoning });

      if (delta.content) {
        content += delta.content;
        const answer = answerSoFar(content);
        if (answer.length > emitted) {
          onDelta({ type: "text", text: answer.slice(emitted) });
          emitted = answer.length;
        }
      }

      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) || {
          id: tc.id,
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name = tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        calls.set(i, cur);
        onDelta({ type: "tool_signal" });
      }
    });

    const tool_calls = [...calls.values()].filter((c) => c.function.name);
    return {
      role: "assistant",
      content,
      ...(tool_calls.length ? { tool_calls } : {}),
    };
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("the inference node timed out");
    throw err;
  } finally {
    link.release();
  }
}

/* Same contract against Anthropic's event stream: text arrives as text_delta,
   tool arguments as input_json_delta fragments against the open block. */
export async function claudeChatStream(
  messages,
  tools,
  { maxTokens = 2000, timeoutMs = 45000, signal } = {},
  onDelta = () => {}
) {
  const base = (process.env.LLM_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const req = toAnthropic(messages, tools);
  const link = linkAbort(signal, timeoutMs);

  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: link.signal,
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
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`fallback inference ${res.status}`);

    let text = "";
    const blocks = new Map();

    await readSse(res, (payload) => {
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }

      if (json.type === "content_block_start") {
        const b = json.content_block || {};
        if (b.type === "tool_use") {
          blocks.set(json.index, { id: b.id, name: b.name, args: "" });
          onDelta({ type: "tool_signal" });
        }
        return;
      }

      if (json.type === "content_block_delta") {
        const d = json.delta || {};
        if (d.type === "text_delta" && d.text) {
          text += d.text;
          onDelta({ type: "text", text: d.text });
        } else if (d.type === "thinking_delta" && d.thinking) {
          onDelta({ type: "think", text: d.thinking });
        } else if (d.type === "input_json_delta") {
          const blk = blocks.get(json.index);
          if (blk) blk.args += d.partial_json || "";
        }
      }
    });

    const tool_calls = [...blocks.values()].map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: b.args || "{}" },
    }));

    return {
      role: "assistant",
      content: text.trim(),
      ...(tool_calls.length ? { tool_calls } : {}),
    };
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("fallback inference timed out");
    throw err;
  } finally {
    link.release();
  }
}

/* Decentralized inference is the point, so Gonka always gets first run — but
   its time to first token measured 3s, 9s and 24s on three consecutive calls,
   and once 98s before a 429. Waiting out that tail is what made the chat feel
   broken. So: start Gonka, and if it has not said anything by CHAT_HEDGE_MS,
   start Claude alongside it and let the first one to actually produce output
   win. 4.5s is deliberate: a healthy Gonka turn writes its first word at ~3.2s,
   and Claude needs ~1.1s of its own, so Gonka still takes any turn it can
   answer inside ~5.5s while the ceiling drops from 98s to about six. The loser is aborted mid-stream. Gonka still answers whenever it is
   healthy, and the trace names whoever really spoke. */
export async function agentChatStream(messages, tools, opts = {}, onDelta = () => {}) {
  const hedgeMs = Number(process.env.CHAT_HEDGE_MS || 4500);
  const hasGonka = gonkaConfigured();
  const hasClaude = claudeConfigured();

  if (!hasGonka && !hasClaude) throw new Error("no inference provider configured");

  if (!hasGonka) {
    return { message: await claudeChatStream(messages, tools, opts, onDelta), provider: "claude" };
  }
  if (!hasClaude) {
    return { message: await gonkaChatStream(messages, tools, opts, onDelta), provider: "gonka" };
  }

  let winner = null;
  const ctl = { gonka: new AbortController(), claude: new AbortController() };

  /* First real output wins and silences the other side. Reasoning does not
     count — Kimi can reason for twenty seconds and still say nothing. */
  const claim = (who) => {
    if (winner) return winner === who;
    winner = who;
    ctl[who === "gonka" ? "claude" : "gonka"].abort();
    return true;
  };

  const forward = (who) => (ev) => {
    if (ev.type === "think") {
      if (!winner || winner === who) onDelta(ev);
      return;
    }
    if (ev.type === "tool_signal") {
      claim(who);
      return;
    }
    if (claim(who)) onDelta(ev);
  };

  const usable = (m) => Boolean(m && (m.tool_calls?.length || String(m.content || "").trim()));

  const run = async (who, fn) => {
    const message = await fn(messages, tools, { ...opts, signal: ctl[who].signal }, forward(who));
    if (!usable(message)) throw new Error(`${who} returned nothing`);
    if (!claim(who)) return null;
    return { message, provider: who };
  };

  const gonkaP = run("gonka", gonkaChatStream).then(
    (r) => r,
    (failed) => ({ failed })
  );

  /* Hedge on the clock, but jump early if Gonka has already settled either way */
  const hedge = new Promise((resolve) => {
    const t = setTimeout(resolve, hedgeMs);
    gonkaP.then(() => {
      clearTimeout(t);
      resolve();
    });
  });

  const claudeP = hedge
    .then(() => (winner === "gonka" ? null : run("claude", claudeChatStream)))
    .then(
      (r) => r,
      (failed) => ({ failed })
    );

  const [g, c] = await Promise.all([gonkaP, claudeP]);

  const win = [g, c].find((r) => r && r.message);
  if (win) {
    return {
      ...win,
      degradedFrom:
        win.provider === "claude" ? g?.failed?.message || "the node was slower" : null,
    };
  }

  /* Gonka claimed the turn and then died, so Claude was waved off before it
     ever ran. Give it the turn properly rather than failing the message. */
  if (!c) {
    onDelta({ type: "reset" });
    const message = await claudeChatStream(messages, tools, { ...opts }, onDelta);
    if (usable(message)) {
      return { message, provider: "claude", degradedFrom: g?.failed?.message || null };
    }
  }

  throw g?.failed || c?.failed || new Error("no answer came back");
}
