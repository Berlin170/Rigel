"use client";

import { useState } from "react";

const CHAINS = [
  ["base-mainnet", "Base"],
  ["eth-mainnet", "Ethereum"],
  ["arbitrum-mainnet", "Arbitrum"],
  ["optimism-mainnet", "Optimism"],
  ["matic-mainnet", "Polygon"],
  ["bsc-mainnet", "BNB Chain"],
];

const CHECKS = [
  ["Concentration", "Whether one position quietly carries the whole wallet"],
  ["Effective spread", "How many holdings are actually above 1% of value"],
  ["Dry powder", "Can this wallet act in a drawdown without forced selling"],
  ["Long tail", "Value sitting outside majors and stables"],
  ["Unpriced", "Balances no venue will quote — the wealth that isn't there"],
  ["Spam", "Contracts advertising a claim page, excluded from every number"],
  ["Drawdown", "Distance below the 30-day peak"],
  ["Dust", "Positions worth less than the gas to consolidate them"],
  ["Dormancy", "Held by decision, or held by default"],
];

const usd = (n) =>
  n == null
    ? "—"
    : n >= 1000
    ? "$" + Math.round(n).toLocaleString("en-US")
    : "$" + n.toFixed(2);

const pct = (n) => (n == null ? "—" : (n * 100).toFixed(1) + "%");

/* deterministic pseudo-random from a string, for background star field */
function seeded(str, i) {
  let h = 2166136261;
  const s = str + ":" + i;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/* ---------------------------------------------------------------- */
/* signature element: the portfolio as a star chart                   */
/* ---------------------------------------------------------------- */

function Constellation({ holdings, address }) {
  const W = 900;
  const H = 380;
  /* padding must clear the largest glow (radiusOf max * 2.1 ≈ 63) so the
     dominant star is never clipped at the top or left edge */
  const padL = 68;
  const padR = 92;
  const padT = 68;
  const padB = 46;

  const stars = holdings.slice(0, 12);
  if (!stars.length) return null;

  const maxShare = Math.max(...stars.map((s) => s.share), 0.05);
  const yScale = (share) => {
    const t = Math.sqrt(share) / Math.sqrt(maxShare);
    return H - padB - t * (H - padT - padB);
  };
  const xScale = (i) =>
    stars.length === 1
      ? (W - padL - padR) / 2 + padL
      : padL + (i * (W - padL - padR)) / (stars.length - 1);

  const colorOf = (s) =>
    s.share >= 0.6
      ? "var(--crimson)"
      : s.share >= 0.4
      ? "var(--amber)"
      : s.isStable
      ? "var(--cyan)"
      : s.isMajor
      ? "var(--star)"
      : "var(--amber)";

  const radiusOf = (s) => 4 + Math.sqrt(s.share) * 26;

  const line = stars
    .map((s, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(s.share)}`)
    .join(" ");

  const bg = Array.from({ length: 60 }, (_, i) => ({
    x: seeded(address, i) * W,
    y: seeded(address, i + 500) * H,
    r: 0.4 + seeded(address, i + 900) * 1.1,
  }));

  const guides = [
    { share: 0.6, label: "dominant" },
    { share: 0.4, label: "heavy" },
  ].filter((g) => g.share <= maxShare * 1.05);

  return (
    <div className="chart-frame">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Portfolio plotted as a star chart, position size by share of value">
        {bg.map((b, i) => (
          <circle key={"bg" + i} cx={b.x} cy={b.y} r={b.r} fill="#3a4478" opacity="0.6" />
        ))}

        {guides.map((g) => (
          <g key={g.label}>
            <line
              x1={padL}
              x2={W - padR + 6}
              y1={yScale(g.share)}
              y2={yScale(g.share)}
              stroke="var(--rule)"
              strokeDasharray="3 6"
            />
            <text
              x={W - padR + 14}
              y={yScale(g.share) + 4}
              textAnchor="start"
              fill="var(--paper-dim)"
              fontFamily="var(--mono)"
              fontSize="9.5"
              letterSpacing="1.4"
            >
              {g.label.toUpperCase()}
            </text>
          </g>
        ))}

        <path
          className="constellation-line"
          d={line}
          pathLength="1"
          fill="none"
          stroke="var(--rule)"
          strokeWidth="1"
        />

        {stars.map((s, i) => {
          const cx = xScale(i);
          const cy = yScale(s.share);
          const r = radiusOf(s);
          const c = colorOf(s);
          return (
            <g key={s.symbol + i}>
              <g className="star-in" style={{ "--d": `${260 + i * 70}ms` }}>
                <circle cx={cx} cy={cy} r={r * 2.1} fill={c} opacity="0.08" className="twinkle" />
                <circle cx={cx} cy={cy} r={r} fill={c} opacity="0.85" />
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1" opacity="0.5" />
              </g>
              {i < 6 && (
                <text
                  className="star-label"
                  style={{ "--d": `${380 + i * 70}ms` }}
                  x={cx}
                  y={H - padB + 20}
                  textAnchor="middle"
                  fill="var(--paper-dim)"
                  fontFamily="var(--mono)"
                  fontSize="10.5"
                  letterSpacing="0.8"
                >
                  {s.symbol.slice(0, 8)}
                </text>
              )}
              {i === 0 && (
                <text
                  className="star-label"
                  style={{ "--d": "900ms" }}
                  x={cx}
                  y={cy - r - 12}
                  textAnchor="middle"
                  fill="var(--star)"
                  fontFamily="var(--mono)"
                  fontSize="12"
                >
                  {pct(s.share)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="chart-legend">
        <span>
          <i className="dot" style={{ background: "var(--star)" }} /> major
        </span>
        <span>
          <i className="dot" style={{ background: "var(--cyan)" }} /> stable
        </span>
        <span>
          <i className="dot" style={{ background: "var(--amber)" }} /> long tail
        </span>
        <span>
          <i className="dot" style={{ background: "var(--crimson)" }} /> dominant
        </span>
        <span style={{ marginLeft: "auto" }}>size = share of value</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* the loop, running on the landing page                              */
/* ---------------------------------------------------------------- */

/* The agency was invisible until you committed to a 110-second run: the page
   opened on a chart and the trace sat collapsed at the bottom. This replays
   one real run — jesse.base.eth, health 85 down to 67 — on a loop, so what
   the thing actually does is legible before anyone types an address.
   Pure CSS on staged delays; no state, no hydration cost. */
const LOOP_STAGES = [
  { k: "engine", label: "engine", detail: "9 checks · Base · health 85" },
  { k: "decide", label: "agent", detail: "this wallet holds enough to be worth draining" },
  { k: "tool", label: "check_approvals()", detail: "19 live approvals · $1,293 reachable" },
  { k: "rescore", label: "engine", detail: "re-scored on what came back · health 67" },
];

function AgentLoop() {
  return (
    <div className="loop" aria-label="How Rigel works: the engine scores, the agent chooses a tool, the engine re-scores what it finds">
      <div className="loop-track">
        {LOOP_STAGES.map((s, i) => (
          <div className={`loop-stage loop-${s.k}`} key={s.k} style={{ "--i": i }}>
            <span className="loop-dot" />
            <div className="loop-body">
              <span className="loop-label">{s.label}</span>
              <span className="loop-detail">{s.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="loop-foot">
        <span className="loop-delta">
          85 <span className="loop-arrow">→</span> <em>67</em>
        </span>
        <span className="loop-caption">
          the score moved because the agent went looking, not because a model said so
        </span>
      </div>
    </div>
  );
}

/* Decisions and tool calls are already in the trace; counting them here keeps
   the report honest — the summary can only ever describe steps that ran. */
function agentStats(steps = []) {
  const decisions = steps.filter((s) => s.tool === "agent.decide").length;
  const calls = steps
    .filter((s) => s.tool === "agent.tool")
    .map((s) => String(s.detail || "").split(" —")[0]);
  return { decisions, calls };
}

function AgentSummary({ data }) {
  const { decisions, calls } = agentStats(data.trace);
  if (!decisions && !calls.length) return null;

  const moved =
    data.baselineScore != null && data.score != null && data.baselineScore !== data.score;

  return (
    <div className="agentsum">
      <div className="agentsum-head">
        <span className="agentsum-pip" />
        the agent chose {calls.length} tool{calls.length === 1 ? "" : "s"} over{" "}
        {decisions} decision{decisions === 1 ? "" : "s"}
      </div>
      <div className="agentsum-calls">
        {calls.map((c, i) => (
          <span className="agentsum-call" key={i} style={{ "--i": i }}>
            {c}
          </span>
        ))}
      </div>
      {moved && (
        <div className="agentsum-move">
          health <span className="from">{data.baselineScore}</span>
          <span className="loop-arrow">→</span>
          <span className="to">{data.score}</span>
          <span className="agentsum-why">
            {data.score < data.baselineScore
              ? "on evidence the first pass never saw"
              : "the first pass was reading one chain and got it wrong"}
          </span>
        </div>
      )}
    </div>
  );
}

function TraceRows({ steps, pending }) {
  return (
    <div className="trace">
      {steps.map((t, i) => (
        <div className="trace-row trace-in" key={i}>
          <span className="trace-n">{String(i + 1).padStart(2, "0")}</span>
          <span>
            <span className="trace-tool">{t.tool}</span>
            <span className="trace-detail">{t.detail}</span>
          </span>
          <span className="trace-ms">
            {t.status === "fail" ? "failed" : t.ms ? t.ms + "ms" : "—"}
          </span>
        </div>
      ))}
      {pending && (
        <div className="trace-row trace-pending">
          <span className="trace-n">{String(steps.length + 1).padStart(2, "0")}</span>
          <span className="trace-detail">working</span>
          <span className="trace-ms">⋯</span>
        </div>
      )}
    </div>
  );
}

const CHAT_SEEDS = [
  "What should I fix first?",
  "Is the concentration actually dangerous?",
  "Check my other chains",
];

function Chat({ report }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState([]);

  async function ask(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;

    const next = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setTools([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, report }),
      });

      const type = res.headers.get("content-type") || "";
      if (!type.includes("ndjson")) {
        const json = await res.json().catch(() => null);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: json?.error || "That did not go through." },
        ]);
        return;
      }

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
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.t === "tool") {
            setTools((t) => [
              ...t,
              msg.args?.chain ? `${msg.name}(${msg.args.chain})` : `${msg.name}()`,
            ]);
          } else if (msg.t === "reply") {
            setMessages((m) => [...m, { role: "assistant", content: msg.text }]);
          } else if (msg.t === "error") {
            setMessages((m) => [...m, { role: "assistant", content: msg.error }]);
          }
        }
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "The request did not complete. Try again." },
      ]);
    } finally {
      setBusy(false);
      setTools([]);
    }
  }

  return (
    <div className="chat">
      {messages.length === 0 && (
        <p className="chat-intro">
          Ask about this report. Rigel answers from the engine&rsquo;s numbers, and
          can go read more chains or your open approvals if the question needs it.
        </p>
      )}

      {messages.map((m, i) => (
        <div className={"msg msg-" + m.role} key={i}>
          <span className="msg-who">{m.role === "user" ? "You" : "Rigel"}</span>
          <div className="msg-body">{m.content}</div>
        </div>
      ))}

      {busy && (
        <div className="msg msg-assistant">
          <span className="msg-who">Rigel</span>
          <div className="msg-body msg-working">
            {tools.length ? (
              <>
                calling <b>{tools.join(", ")}</b>
              </>
            ) : (
              <span className="scanning">thinking</span>
            )}
          </div>
        </div>
      )}

      {messages.length === 0 && (
        <div className="samples chat-seeds">
          {CHAT_SEEDS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="console chat-console">
        <label className="field">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ask about this wallet…"
            aria-label="Ask about this wallet"
          />
        </label>
        <button className="run" onClick={() => ask()} disabled={busy || !input.trim()}>
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

export default function Page() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("base-mainnet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [live, setLive] = useState([]);
  const [showTrace, setShowTrace] = useState(true);

  async function run(addr) {
    const target = (addr ?? address).trim();
    if (!target) {
      setError("Paste a wallet address to run a diagnosis.");
      return;
    }
    setBusy(true);
    setError(null);
    setData(null);
    setLive([]);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: target, chain }),
      });

      /* Validation and config failures still come back as plain JSON. */
      const type = res.headers.get("content-type") || "";
      if (!type.includes("ndjson")) {
        const json = await res.json().catch(() => null);
        setError(json?.error || "The diagnosis failed to run.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        /* NDJSON: complete lines only — the tail may be a partial record. */
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.t === "step") setLive((s) => [...s, msg.step]);
          else if (msg.t === "done") setData(msg.payload);
          else if (msg.t === "error") setError(msg.error);
        }
      }
    } catch {
      setError("The request did not complete. Check your connection and run it again.");
    } finally {
      setBusy(false);
    }
  }

  const scoreColor =
    data?.score == null
      ? "var(--paper-dim)"
      : data.score >= 80
      ? "var(--cyan)"
      : data.score >= 60
      ? "var(--star)"
      : data.score >= 40
      ? "var(--amber)"
      : "var(--crimson)";

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="brand">
          <svg className="brand-star" viewBox="0 0 64 64" aria-hidden="true">
            <path
              d="M32 8 C34 24, 40 30, 56 32 C40 34, 34 40, 32 56 C30 40, 24 34, 8 32 C24 30, 30 24, 32 8 Z"
              fill="var(--amber)"
            />
          </svg>
          <span className="brand-mark">Rigel</span>
          <span className="brand-note">wallet diagnostics</span>
        </div>
        <div className="masthead-right">
          autonomous · picks its own tools · never invents a number
        </div>
      </header>

      <section className="hero">
        <h1>
          It decides what to check.
          <br />
          <em>Then it goes and looks.</em>
        </h1>
        <p>
          Rigel runs nine deterministic checks on any Base wallet. Then an agent
          reads that output and picks what the first pass missed — other chains,
          open approvals — and investigates. Everything it brings back is
          re-scored by the same engine, so the health score moves on evidence.
          The model chooses where to look and writes the diagnosis. It never
          produces a number.
        </p>
      </section>

      <AgentLoop />

      <div className="console">
        <label className="field">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run()}
            placeholder="0x… wallet address"
            spellCheck="false"
            aria-label="Wallet address"
          />
        </label>
        <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain">
          {CHAINS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="run" onClick={() => run()} disabled={busy}>
          {busy ? "Reading" : "Diagnose"}
        </button>
      </div>

      {/* Two wallets that fail in different ways, so each button exercises a
          different tool: the first reads as concentrated until the agent looks
          at another chain, the second holds enough behind live approvals to be
          worth draining. */}
      <div className="samples">
        <span>try</span>
        <button
          onClick={() => {
            const a = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
            setAddress(a);
            setChain("base-mainnet");
            run(a);
          }}
        >
          vitalik.eth
        </button>
        <button
          onClick={() => {
            const a = "0x849151d7D0bF1F34b70d5caD5149D28CC2308bf1";
            setAddress(a);
            setChain("base-mainnet");
            run(a);
          }}
        >
          jesse.base.eth
        </button>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {!data && !busy && (
        <div className="preview">
          <div className="sec">
            <h2>What Rigel checks</h2>
            <span className="line" />
          </div>
          <div className="preview-grid">
            {CHECKS.map(([name, desc]) => (
              <div className="preview-item" key={name}>
                <div className="pi-name">{name}</div>
                <div className="pi-desc">{desc}</div>
              </div>
            ))}
          </div>
          <p className="preview-foot">
            Every one of these is computed by a deterministic engine before the
            model sees anything. The model writes the diagnosis — it never
            produces a number.
          </p>
        </div>
      )}

      {busy && (
        <div className="loading-wrap">
          <div className="sec">
            <h2>Agent trace</h2>
            <span className="line" />
            <span className="scanning">live</span>
          </div>
          <TraceRows steps={live} pending />
          <div className="skeleton sk-chart" />
          <div className="skeleton sk-verdict" />
        </div>
      )}

      {data && (
        <>
          <div className="sec">
            <h2>What the agent did</h2>
            <span className="line" />
          </div>
          <AgentSummary data={data} />

          <div className="sec">
            <h2>The chart</h2>
            <span className="line" />
          </div>
          <Constellation
            key={data.address + data.chain}
            holdings={data.holdings}
            address={data.address}
          />

          <div className="sec">
            <h2>Verdict</h2>
            <span className="line" />
          </div>
          <div className="verdict">
            <div className="score-block">
              <div className="score-num" style={{ color: scoreColor }}>
                {data.score ?? "—"}
              </div>
              <div className="score-den">health score</div>
              <div className="grade" style={{ color: scoreColor }}>
                {data.grade}
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="k">
                  {data.metrics?.chainsScanned > 1 ? "Value found" : "Total value"}
                </div>
                <div className="v">
                  {usd(data.metrics?.combinedTotal ?? data.total)}
                </div>
                {data.metrics?.chainsScanned > 1 && (
                  <div className="stat-sub">
                    across {data.metrics.chainsScanned} chains
                  </div>
                )}
              </div>
              <div className="stat">
                <div className="k">Positions</div>
                <div className="v">{data.metrics?.positions ?? 0}</div>
              </div>
              <div className="stat">
                <div className="k">Top weight</div>
                <div className="v">{pct(data.metrics?.topShare)}</div>
              </div>
              <div className="stat">
                <div className="k">In stables</div>
                <div className="v">{pct(data.metrics?.stableShare)}</div>
              </div>
              <div className="stat">
                <div className="k">30d change</div>
                <div className="v">
                  {data.metrics?.change == null
                    ? "—"
                    : (data.metrics.change > 0 ? "+" : "") + pct(data.metrics.change)}
                </div>
              </div>
              <div className="stat">
                <div className="k">Off peak</div>
                <div className="v">{pct(data.metrics?.drawdown)}</div>
              </div>
            </div>
          </div>

          {data.brief && (
            <>
              <div className="sec">
                <h2>Diagnosis</h2>
                <span className="line" />
              </div>
              <div className="brief">
                {data.brief.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <div className="byline">
                  Written from the engine output above. No figure in this text was
                  produced by the model.
                </div>
              </div>
            </>
          )}

          {!data.brief && data.briefReason === "no-key" && (
            <div className="notice">
              The written diagnosis is off — no LLM_API_KEY is set on the server. The
              risk engine below runs without it.
            </div>
          )}

          {!data.brief && data.briefReason && data.briefReason !== "no-key" && (
            <div className="notice">
              The written diagnosis did not come back ({data.briefReason}). Engine
              findings below are unaffected.
            </div>
          )}

          <div className="sec">
            <h2>Ask Rigel</h2>
            <span className="line" />
            <span className="sec-note">decentralized inference</span>
          </div>
          <Chat key={data.address + data.chain} report={data} />

          <div className="sec">
            <h2>Findings</h2>
            <span className="line" />
          </div>
          <div>
            {data.findings.map((f) => (
              <div key={f.id} className={"finding " + f.severity}>
                <div className="finding-head">
                  <h3>{f.title}</h3>
                  <span className={"sev " + f.severity}>{f.severity}</span>
                </div>
                <p>{f.detail}</p>
                {f.evidence && <div className="evidence">{f.evidence}</div>}
              </div>
            ))}
          </div>

          {data.holdings.length > 0 && (
            <>
              <div className="sec">
                <h2>Holdings</h2>
                <span className="line" />
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th className="hide-sm">Units</th>
                    <th className="num">Value</th>
                    <th className="num">Share</th>
                    <th className="hide-sm" style={{ width: 160 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((h) => (
                    <tr key={h.symbol + h.value}>
                      <td>
                        <span className="tok">
                          {h.logo ? (
                            <img
                              className="tok-icon"
                              src={h.logo}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.visibility = "hidden";
                              }}
                            />
                          ) : (
                            <span className="tok-icon tok-fallback">
                              {h.symbol.slice(0, 1)}
                            </span>
                          )}
                          {h.symbol}
                          <span style={{ color: "var(--paper-dim)", marginLeft: 4 }}>
                            {h.name.slice(0, 24)}
                          </span>
                        </span>
                      </td>
                      <td className="hide-sm" style={{ color: "var(--paper-dim)" }}>
                        {h.units < 1 ? h.units.toFixed(4) : h.units.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="num">{usd(h.value)}</td>
                      <td className="num">{pct(h.share)}</td>
                      <td className="hide-sm">
                        <div
                          className="bar"
                          style={{
                            width: Math.max(2, h.share * 100) + "%",
                            background: h.isStable
                              ? "var(--cyan)"
                              : h.share >= 0.4
                              ? "var(--amber)"
                              : "var(--rule)",
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="sec">
            <h2>Agent trace</h2>
            <span className="line" />
            <button className="ghost" onClick={() => setShowTrace((v) => !v)}>
              {showTrace ? "Hide" : "Show"}
            </button>
          </div>
          {showTrace && <TraceRows steps={data.trace} />}
        </>
      )}

      <footer className="foot">
        <span>Rigel · not financial advice, always DYOR</span>
        <span className="foot-links">
          <a href="https://github.com/Berlin170" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://x.com/BerlinBuildWeb3" target="_blank" rel="noreferrer">
            X
          </a>
          <a href="https://t.me/Berlin926" target="_blank" rel="noreferrer">
            Telegram
          </a>
          <span className="foot-dim">Discord berlin170</span>
          <a href="https://orionagents.org/hackathon" target="_blank" rel="noreferrer">
            Orion Builder Hackathon
          </a>
        </span>
      </footer>
    </div>
  );
}
