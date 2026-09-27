"use client";

import { useEffect, useRef, useState } from "react";
import { readNdjson } from "./lib/ndjson.mjs";
import Evidence from "./components/Evidence";
import { hasPartialCoverage } from "./lib/scope.mjs";
import Investigation from "./components/Investigation";

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

const chainLabel = (v) => (CHAINS.find(([id]) => id === v) || [, v])[1];

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
      ? "var(--bad)"
      : s.share >= 0.4
      ? "var(--accent)"
      : s.isStable
      ? "var(--ok)"
      : s.isMajor
      ? "var(--fg)"
      : "var(--accent)";

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
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Portfolio plotted as a star chart, position size by share of value"
      >
        {bg.map((b, i) => (
          <circle key={"bg" + i} cx={b.x} cy={b.y} r={b.r} fill="#2b3145" opacity="0.7" />
        ))}

        {guides.map((g) => (
          <g key={g.label}>
            <line
              x1={padL}
              x2={W - padR + 6}
              y1={yScale(g.share)}
              y2={yScale(g.share)}
              stroke="var(--border-strong)"
              strokeDasharray="3 6"
            />
            <text
              x={W - padR + 14}
              y={yScale(g.share) + 4}
              textAnchor="start"
              fill="var(--fg-dim)"
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
          stroke="var(--border-strong)"
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
                  fill="var(--fg-dim)"
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
                  fill="var(--fg)"
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
          <i className="dot" style={{ background: "var(--fg)" }} /> major
        </span>
        <span>
          <i className="dot" style={{ background: "var(--ok)" }} /> stable
        </span>
        <span>
          <i className="dot" style={{ background: "var(--accent)" }} /> long tail
        </span>
        <span>
          <i className="dot" style={{ background: "var(--bad)" }} /> dominant
        </span>
        <span style={{ marginLeft: "auto" }}>size = share of value</span>
      </div>
    </div>
  );
}

function ConsoleRow({ step, i, typed }) {
  return (
    <div className={"crow " + (typed ? "crow-type" : "crow-in")}>
      <span className="crow-n">{String(i + 1).padStart(2, "0")}</span>
      <span className={"crow-tool " + (step.tool.startsWith("agent.") ? "is-agent" : "")}>{step.tool}</span>
      <span className="crow-detail">{step.detail}</span>
      <span className={"crow-ms" + (step.status === "fail" ? " is-fail" : "")}>
        {step.status === "fail" ? "failed" : step.ms ? step.ms + "ms" : "—"}
      </span>
    </div>
  );
}

function ScoreGauge({ score, grade }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const color =
    score == null
      ? "var(--fg-dim)"
      : score >= 80
      ? "var(--ok)"
      : score >= 60
      ? "var(--fg)"
      : score >= 40
      ? "var(--accent)"
      : "var(--bad)";
  const off = score == null ? C : C * (1 - score / 100);

  return (
    <div>
      <div className="gauge">
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle className="gauge-track" cx="70" cy="70" r={R} />
          <circle
            className="gauge-arc"
            cx="70"
            cy="70"
            r={R}
            stroke={color}
            style={{ "--c": C, "--off": off }}
          />
        </svg>
        <div className="gauge-mid">
          <div className="gauge-num" style={{ color }}>
            {score ?? "—"}
          </div>
          <div className="gauge-den">{score == null ? "not scored" : "health"}</div>
        </div>
      </div>
      <div className="grade" style={{ color }}>
        {grade}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

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
  /* the answer as it arrives, and Kimi's reasoning while there is no answer yet */
  const [live, setLive] = useState("");
  const [think, setThink] = useState("");
  const tailRef = useRef(null);

  /* "nearest" scrolls only when the bubble has actually left the viewport, so
     the answer stays visible as it streams without yanking the page around. */
  useEffect(() => {
    if (busy) tailRef.current?.scrollIntoView({ block: "nearest" });
  }, [live, think, busy]);

  async function ask(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;

    const next = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setTools([]);
    setLive("");
    setThink("");

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

      let completed = false;
      await readNdjson(res.body, (msg) => {
          if (msg.t === "tool") {
            setTools((t) => [
              ...t,
              /* show whatever argument the tool got, not just `chain` */
              `${msg.name}(${Object.entries(msg.args || {}).filter(([key]) => key !== "reason").map(([, value]) => value)
                .filter((v) => typeof v === "string" && v.trim())
                .join(", ")})`,
            ]);
          } else if (msg.t === "think") {
            setThink((s) => (s + msg.text).slice(-400));
          } else if (msg.t === "delta") {
            /* the answer supersedes the reasoning that led to it */
            setThink("");
            setTools([]);
            setLive((s) => s + msg.text);
          } else if (msg.t === "reset") {
            setLive("");
            setThink("");
          } else if (msg.t === "reply") {
            completed = true;
            setLive("");
            setThink("");
            setMessages((m) => [...m, { role: "assistant", content: msg.text }]);
          } else if (msg.t === "error") {
            completed = true;
            setMessages((m) => [...m, { role: "assistant", content: msg.error }]);
          }
      });
      if (!completed) throw new Error("The chat stream ended before the reply.");
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "The request did not complete. Try again." },
      ]);
    } finally {
      setBusy(false);
      setTools([]);
      setLive("");
      setThink("");
    }
  }

  return (
    <div className="chat">
      <div className="chat-body">
        {messages.length === 0 && !busy && (
          <p className="chat-intro">
            Ask about this report. Rigel answers from the engine&rsquo;s numbers, and
            can go read more chains or your open approvals if the question needs it.
          </p>
        )}

        {messages.map((m, i) => (
          <div className={"msg msg-" + m.role} key={i}>
            <span className="avatar">{m.role === "user" ? "you" : "R"}</span>
            <div className="msg-body">{m.content}</div>
          </div>
        ))}

        {busy && (
          <div className="msg msg-assistant">
            <span className="avatar">R</span>
            {live ? (
              <div className="msg-body">
                {live}
                <span className="caret" />
              </div>
            ) : (
              <div className="msg-body msg-working">
                {tools.length ? (
                  <>
                    calling <b>{tools.join(", ")}</b>
                  </>
                ) : think ? (
                  <span className="thinking">{think}</span>
                ) : (
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div ref={tailRef} />
      </div>

      <div className="chat-foot">
        {messages.length === 0 && (
          <div className="samples chat-seeds">
            {CHAT_SEEDS.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="chat-console">
          <label className="field">
            <span className="field-prompt">›</span>
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
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef(null);

  /* A run takes upwards of a minute. A clock that is actually counting is the
     difference between "it is working" and "it has hung". */
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [busy]);

  /* ⌘K / ctrl-K / "/" jumps to the address field, the way a console should */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(e.target?.tagName || "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function run(addr, selectedChain = chain) {
    if (busy) return;
    const target = (addr ?? address).trim();
    if (!target) {
      setError("Paste a wallet address to run a diagnosis.");
      inputRef.current?.focus();
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
        body: JSON.stringify({ address: target, chain: selectedChain }),
      });

      /* Validation and config failures still come back as plain JSON. */
      const type = res.headers.get("content-type") || "";
      if (!type.includes("ndjson")) {
        const json = await res.json().catch(() => null);
        setError(json?.error || "The diagnosis failed to run.");
        return;
      }

      let completed = false;
      await readNdjson(res.body, (msg) => {
          if (msg.t === "step") setLive((s) => [...s, msg.step]);
          else if (msg.t === "done") { completed = true; setData(msg.payload); }
          else if (msg.t === "error") { completed = true; setError(msg.error); }
      });
      if (!completed) setError("The connection ended before the report was ready. Run the diagnosis again.");
    } catch {
      setError("The request did not complete. Check your connection and run it again.");
    } finally {
      setBusy(false);
    }
  }

  function sample(a) {
    setAddress(a);
    setChain("base-mainnet");
    run(a, "base-mainnet");
  }

  const mode = busy ? "live" : data ? "done" : error && live.length ? "error" : "replay";
  const status = busy ? "running" : error ? "error" : data ? hasPartialCoverage(data) ? "partial" : "complete" : "idle";

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <svg className="brand-star" viewBox="0 0 64 64" aria-hidden="true">
              <path
                d="M32 8 C34 24, 40 30, 56 32 C40 34, 34 40, 32 56 C30 40, 24 34, 8 32 C24 30, 30 24, 32 8 Z"
                fill="var(--accent)"
              />
            </svg>
            <span className="brand-mark">Rigel</span>
            <span className="brand-note">wallet diagnostics</span>
          </div>

          <span className={"pill is-" + status}>
            <span className="pill-dot" />
            {status === "partial" ? "report ready · partial coverage" : `agent ${status}`}
          </span>

          <span className="topbar-spacer" />

          <span className="topbar-links">
            <a href="https://github.com/Berlin170/Rigel" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://orionagents.org/hackathon" target="_blank" rel="noreferrer">
              Orion
            </a>
          </span>
        </div>
      </header>

      <div className="shell">
        <section className={"hero" + (busy || data ? " hero-compact" : "")}>
          <span className="eyebrow">Autonomous wallet investigation</span>
          <h1>
            Your wallet has a story.<br /><em>Rigel follows the evidence.</em>
          </h1>
          <p>
            Start with an address. Rigel scans the portfolio, chooses what needs a
            closer look, and investigates. See what it checks, why it checks it,
            and <b>what the evidence changes</b>.
          </p>

          <div className="hero-facts">
            <div className="hero-fact">
              <div className="n">9</div>
              <div className="l">deterministic checks</div>
            </div>
            <div className="hero-fact">
              <div className="n">6</div>
              <div className="l">chains reachable</div>
            </div>
            <div className="hero-fact">
              <div className="n">0</div>
              <div className="l">scores assigned by the model</div>
            </div>
          </div>
        </section>

        <div className="cmd">
          <label className="field">
            <span className="field-prompt">›</span>
            <input
              ref={inputRef}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && run()}
              placeholder="0x… EVM wallet address"
              spellCheck="false"
              aria-label="Wallet address"
              disabled={busy}
            />
            <span className="kbd hide-sm">⌘K</span>
          </label>
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain" disabled={busy}>
            {CHAINS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className="run" onClick={() => run()} disabled={busy}>
            {busy && <span className="spin" />}
            {busy ? "Investigating" : "Investigate wallet"}
          </button>
        </div>

        {/* Two wallets that fail in different ways, so each button exercises a
            different tool: the first reads as concentrated until the agent looks
            at another chain, the second holds enough behind live approvals to be
            worth draining. */}
        <div className="samples">
          <span>try</span>
          <button
            disabled={busy}
            onClick={() => sample("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")}
          >
            vitalik.eth
          </button>
          <button
            disabled={busy}
            onClick={() => sample("0x849151d7D0bF1F34b70d5caD5149D28CC2308bf1")}
          >
            jesse.base.eth
          </button>
        </div>

        <p className="scan-hint">Read-only · no wallet connection or signature. Allow a few minutes for a live investigation; sample results change with onchain activity.</p>

        {error && <div className="notice bad" role="alert">{error}</div>}

        <Investigation
          mode={mode}
          steps={mode === "live" || mode === "error" ? live : data?.trace || []}
          elapsed={elapsed}
          data={data}
          target={data?.address || address}
        >
          <div className="console-body is-full">
            {(data?.trace || live).map((step, i) => <ConsoleRow key={i} step={step} i={i} />)}
          </div>
        </Investigation>

        {!data && !busy && (
          <>
            <div className="sec">
              <h2>What it checks</h2>
              <span className="line" />
              <span className="sec-note">before the model sees anything</span>
            </div>
            <div className="checks">
              {CHECKS.map(([name, desc], i) => (
                <div className="check" key={name}>
                  <span className="check-n">{String(i + 1).padStart(2, "0")}</span>
                  <div className="check-name">{name}</div>
                  <div className="check-desc">{desc}</div>
                </div>
              ))}
            </div>
            <p className="preview-foot">
              Every one of these is computed by a deterministic engine. The model
              chooses where to look next and writes the diagnosis. Scores and
              evidence figures come from the engine.
            </p>
          </>
        )}

        {data && (
          <>
            <div className="sec">
              <h2>Verdict</h2>
              <span className="line" />
              <span className="sec-note">{chainLabel(data.chain || chain)} score + follow-up evidence</span>
            </div>
            <div className="verdict">
              <ScoreGauge score={data.score} grade={data.grade} />
              <div className="stat-grid">
                <div className="stat">
                  <div className="k">
                    {data.metrics?.chainsScanned > 1 ? "Value found" : "Total value"}
                  </div>
                  <div className="v">{usd(data.metrics?.combinedTotal ?? data.total)}</div>
                  {data.metrics?.chainsScanned > 1 && (
                    <div className="stat-sub">across {data.metrics.chainsScanned} chains</div>
                  )}
                </div>
                <div className="stat">
                  <div className="k">{data.chainLabel} positions</div>
                  <div className="v">{data.metrics?.positions ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="k">{data.chainLabel} top weight</div>
                  <div className="v">{pct(data.metrics?.topShare)}</div>
                </div>
                <div className="stat">
                  <div className="k">{data.chainLabel} stables</div>
                  <div className="v">{pct(data.metrics?.stableShare)}</div>
                </div>
                <div className="stat">
                  <div className="k">{data.chainLabel} 30d change</div>
                  <div className="v">
                    {data.metrics?.change == null
                      ? "—"
                      : (data.metrics.change > 0 ? "+" : "") + pct(data.metrics.change)}
                  </div>
                </div>
                <div className="stat">
                  <div className="k">{data.chainLabel} off peak</div>
                  <div className="v">{pct(data.metrics?.drawdown)}</div>
                </div>
              </div>
            </div>

            <div className="sec">
              <h2>Findings</h2>
              <span className="line" />
              <span className="sec-note">{data.findings.length} raised</span>
            </div>
            <p className="notice">{data.scope?.scoreScope || `Metrics and holdings describe ${data.chainLabel}.`}{data.scope?.combinedValueUsd > data.scope?.startingChainValueUsd && ` The ${data.chainLabel} ${data.scope.startingPositionSymbol} position represents ${pct(data.scope.startingPositionShareOfObservedValue)} of observed value across scanned chains. This is not its consolidated exposure across chains.`}</p>
            <div>
              {data.findings.map((f) => (
                <div key={f.id} className={"finding " + f.severity}>
                  <span className="finding-source">{data.investigationFindings?.some((extra) => extra.id === f.id) ? "Added by follow-up investigation" : "Initial scan"} · {f.scope || data.chainLabel}</span>
                  <div className="finding-head">
                    <h3>{f.title}</h3>
                    <span className={"badge " + f.severity}>{f.severity}</span>
                  </div>
                  <p>{f.detail}</p>
                  {f.evidence && <div className="evidence">{f.evidence}</div>}
                </div>
              ))}
            </div>

            <Evidence report={data} />

            <div className="sec">
              <h2>{data.chainLabel} holdings chart</h2>
              <span className="line" />
              <span className="sec-note">size = share of value</span>
            </div>
            <Constellation
              key={data.address + data.chain}
              holdings={data.holdings}
              address={data.address}
            />

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
                    AI-written from engine facts. Verify numerical claims against
                    the findings and downloadable evidence.
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

            {data.holdings.length > 0 && (
              <>
                <div className="sec">
                  <h2>Holdings</h2>
                  <span className="line" />
                  <span className="sec-note">{data.holdings.length} priced</span>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th className="hide-sm">Units</th>
                        <th className="num">Value</th>
                        <th className="num">Share</th>
                        <th className="hide-sm" style={{ width: 150 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.holdings.map((h) => (
                        <tr key={h.symbol + h.value}>
                          <td>
                            <span className="tok">
                              {/* the letter is always rendered and the logo
                                  covers it once it loads, so a slow or broken
                                  image degrades to an initial, not a gap */}
                              <span className="tok-icon tok-fallback">
                                {h.symbol.slice(0, 1)}
                                {h.logo && (
                                  <img
                                    className="tok-img"
                                    src={h.logo}
                                    alt=""
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                )}
                              </span>
                              {h.symbol}
                              <span className="tok-name">{h.name.slice(0, 24)}</span>
                            </span>
                          </td>
                          <td className="hide-sm">
                            {h.units < 1
                              ? h.units.toFixed(4)
                              : h.units.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          </td>
                          <td className="num">{usd(h.value)}</td>
                          <td className="num">{pct(h.share)}</td>
                          <td className="hide-sm">
                            <div className="bar-track">
                              <div
                                className="bar"
                                style={{
                                  width: Math.max(2, h.share * 100) + "%",
                                  /* the track is --border, so the fill has to
                                     clear it or the bar reads as empty */
                                  background: h.isStable
                                    ? "var(--ok)"
                                    : h.share >= 0.4
                                    ? "var(--accent)"
                                    : "var(--fg-dim)",
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

          </>
        )}

        <footer className="foot">
          <span>Rigel · not financial advice, always DYOR</span>
          <span className="foot-links">
            <a href="https://github.com/Berlin170/Rigel" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://x.com/BerlinBuildWeb3" target="_blank" rel="noreferrer">
              X
            </a>
            <a href="https://t.me/Berlin926" target="_blank" rel="noreferrer">
              Telegram
            </a>
            <span>Discord berlin170</span>
            <a href="https://orionagents.org/hackathon" target="_blank" rel="noreferrer">
              Orion Builder Hackathon
            </a>
          </span>
        </footer>
      </div>
    </>
  );
}
