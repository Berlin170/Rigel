import {
  AGENT_TOOLS,
  TOOL_IMPL,
  agentChat,
  gonkaConfigured,
  claudeConfigured,
  stripThink,
  CHAINS,
} from "../../lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_STEPS = 3;
const MAX_HISTORY = 8;
/* enough to sweep every supported chain in one round — lookups run
   concurrently, so the cost is prompt size on the follow-up, not wall time */
const MAX_CALLS_PER_STEP = 6;

/* The same discipline as the written brief: the model may reason about the
   facts and go fetch more, but every figure it repeats has to come from the
   engine or from a tool result. */
const SYSTEM = [
  "You are Rigel, a wallet diagnostics analyst, answering follow-up questions about a report the engine has already produced.",
  "",
  "Rules, without exception:",
  "- Use only numbers that appear in the report below or in a tool result. Never estimate, extrapolate, or invent a figure.",
  "- If the answer needs data you do not have, call a tool to get it. Do not guess.",
  "- If a tool cannot answer it, say plainly that you do not have that data.",
  "- Never predict a price, and never tell anyone to buy or sell a specific token.",
  "- Answer in one or two short paragraphs. Plain sentences, no headings, no bullet lists, no markdown. Do not escape dollar signs.",
  "- No hype and no filler openers. Answer the question that was asked.",
  "",
  "The report already contains the findings, the score, and the holdings. Questions about what to prioritise, what a finding means, or how bad something is can be answered from it directly — reach for a tool only when the question needs data the report does not contain.",
  "Always finish with your answer written out for the reader. Never end your turn having only reasoned internally.",
].join("\n");

/* Kimi occasionally closes its reasoning block and stops without writing an
   answer. One nudge recovers it; the alternative is a false "I don't know". */
async function answerOrNudge(messages) {
  const { message, provider } = await agentChat(messages, AGENT_TOOLS, { maxTokens: 3000 });
  if (!message) return { message: null, provider };
  if (message.tool_calls?.length || stripThink(message.content)) return { message, provider };

  messages.push({ role: "assistant", content: "" });
  messages.push({
    role: "user",
    content: "Answer the question directly now, in plain sentences.",
  });
  const retry = await agentChat(messages, null, { maxTokens: 1200 });
  return { message: retry.message, provider: retry.provider };
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!gonkaConfigured() && !claudeConfigured()) {
    return Response.json(
      { ok: false, error: "Chat is off — no inference provider is configured on the server." },
      { status: 503 }
    );
  }

  const report = body.report || {};
  const address = String(report.address || "").trim();
  const chain = CHAINS[report.chain] ? report.chain : "eth-mainnet";

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { ok: false, error: "Run a diagnosis first — chat answers questions about a report." },
      { status: 400 }
    );
  }

  const key = process.env.GOLDRUSH_API_KEY;
  if (!key) {
    return Response.json(
      { ok: false, error: "The chain data key is not set on the server." },
      { status: 500 }
    );
  }

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  if (!history.length) {
    return Response.json({ ok: false, error: "Nothing to answer." }, { status: 400 });
  }

  const facts = {
    chain: report.chainLabel,
    address,
    totalValueUsd: Math.round(report.total || 0),
    combinedValueUsd: report.metrics?.combinedTotal
      ? Math.round(report.metrics.combinedTotal)
      : undefined,
    chainsScanned: report.metrics?.chainsScanned,
    healthScore: report.score,
    grade: report.grade,
    metrics: report.metrics,
    /* titles and evidence only — the full prose roughly triples the prompt and
       Kimi's reasoning time scales with it */
    findings: (report.findings || []).map((f) => ({
      severity: f.severity,
      title: f.title,
      evidence: f.evidence,
    })),
    topHoldings: (report.holdings || []).slice(0, 10).map((h) => ({
      symbol: h.symbol,
      valueUsd: Math.round(h.value),
      share: +(h.share || 0).toFixed(4),
    })),
  };

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "system", content: "Engine report:\n\n" + JSON.stringify(facts, null, 2) },
    ...history,
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client went away */
        }
      };

      const ctx = { address, chain, key, scans: [], approvals: null };

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const { message: msg, provider } = await answerOrNudge(messages);
          if (!msg) break;
          if (step === 0) send({ t: "provider", provider });

          const calls = msg.tool_calls || [];
          const text = stripThink(msg.content).replace(/\\\$/g, "$");

          messages.push({
            role: "assistant",
            content: text,
            ...(calls.length ? { tool_calls: calls } : {}),
          });

          if (!calls.length) {
            send({ t: "reply", text: text || "I do not have the data to answer that." });
            break;
          }

          await Promise.all(
            calls.slice(0, MAX_CALLS_PER_STEP).map(async (call) => {
              const name = call.function?.name;
              let args = {};
              try {
                args = JSON.parse(call.function?.arguments || "{}");
              } catch {
                /* malformed — the impl rejects it */
              }

              send({ t: "tool", name, args });

              let out;
              try {
                out = TOOL_IMPL[name]
                  ? await TOOL_IMPL[name](args, ctx)
                  : { error: "no such tool" };
              } catch (err) {
                out = { error: err?.message || "lookup failed" };
              }

              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(out),
              });
            })
          );

          /* anything past the cap still needs a result, or the next request is
             rejected for an unanswered tool call */
          for (const skipped of calls.slice(MAX_CALLS_PER_STEP)) {
            messages.push({
              role: "tool",
              tool_call_id: skipped.id,
              content: JSON.stringify({ error: "skipped — too many lookups in one step" }),
            });
          }
        }
      } catch (err) {
        send({ t: "error", error: err?.message || "The answer did not come back." });
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
