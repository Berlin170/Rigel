"use client";

import { activeStage, investigations, STAGES, TOOL_COPY } from "../lib/investigation.mjs";
import AgentActivity, { REPLAY_STEPS, useAgentReplay } from "./AgentActivity";

export default function Investigation({ mode, steps, elapsed, data, target, children }) {
  const example = mode === "replay";
  const replay = useAgentReplay(example);
  const rows = example ? REPLAY_STEPS.slice(0, replay.count) : steps;
  const replayDone = example && replay.count === REPLAY_STEPS.length;
  const replayScored = example && rows.some((s) => s.tool === "engine.revise");
  const cards = investigations(rows);
  const baseline = data?.baselineEvidence || rows.find((s) => s.baseline)?.baseline;
  const failures = rows.filter((s) => s.status === "fail");
  const done = mode === "done";
  const stopped = mode === "error";
  const stage = activeStage(rows, mode);
  const additions = data?.investigationFindings || [];
  const score = example ? 67 : data?.score;
  const baselineScore = baseline?.score ?? data?.baselineScore;
  const skipped = rows.some((s) => s.tool === "agent.skip");
  const liveTitle = ["Reading the wallet", "Choosing what needs a closer look", "Following the evidence", "Checking what the evidence changes", "Preparing your report"][stage];

  return (
    <section className={"investigation" + (example ? " is-example" : "") + (mode === "live" || example && !replay.paused && !replay.reducedMotion && !replayDone ? " is-active" : "") + (example && replay.paused ? " replay-paused" : "")} aria-label="Wallet investigation">
      <AgentActivity steps={rows} example={example} working={mode === "live" || example && !replayDone} paused={replay.paused} reducedMotion={replay.reducedMotion} onToggle={replay.toggle} />
      <div className="investigation-heading">
        <div>
          <span className="eyebrow">{example ? "A previous investigation" : "Your investigation"}</span>
          <h2 aria-live="polite">{example ? "A healthy-looking wallet. An overlooked permission." : done ? "Here’s what the investigation found." : stopped ? "This investigation could not finish." : liveTitle}</h2>
          <p>{example ? "jesse.base.eth · recorded example, not live data" : `${target || "Wallet"} · ${done ? "report ready" : stopped ? "review the trace and try again" : "read-only investigation"}`}</p>
        </div>
        <span className={"pill " + (done ? "is-done" : stopped ? "is-error" : example ? "" : "is-running")}>
          <span className="pill-dot" />{example ? "Recorded example" : done ? "Complete" : stopped ? "Stopped" : `${Math.floor(elapsed / 1000)}s · live`}
        </span>
      </div>

      <ol className="investigation-stages" aria-label={example ? "Example workflow" : "Investigation progress"}>
        {STAGES.map((label, i) => (
          <li key={label} className={i < stage || done || replayDone ? "stage-done" : i === stage ? "stage-current" : ""} aria-current={!done && !replayDone && !stopped && i === stage ? "step" : undefined}>
            <span>{i < stage || done || replayDone ? "✓" : `0${i + 1}`}</span>{label}
          </li>
        ))}
      </ol>

      <div className="investigation-story">
        <div className="baseline-card">
          <span className="eyebrow">01 / Starting evidence</span>
          <div className="baseline-score">{baselineScore == null ? "—" : baselineScore}<small>{baselineScore == null ? baseline ? "Score withheld" : "Awaiting baseline" : "/ 100 baseline"}</small></div>
          <p>{example && baseline ? "The initial portfolio checks scored this wallet 85. Spending permissions were still unchecked." : baseline ? `${baseline.findings} initial findings on ${data?.chainLabel || baseline.chainLabel}. The agent checks what this first pass may have missed.` : stopped ? "No complete baseline was available. No score has been assigned." : "Reading balances, price history, and activity. The engine computes the initial findings before the agent chooses its next step."}</p>
        </div>
        <div className="decision-area">
          <span className="eyebrow">02 / {example || done ? "What the agent investigated" : "Agent-selected checks"}</span>
          {cards.length ? cards.map((card, i) => {
            const copy = TOOL_COPY[card.name] || { title: card.name, purpose: "Inspect additional wallet evidence." };
            const pending = card.tool === "agent.tool.start";
            const failed = card.status === "fail";
            const label = failed ? "Unavailable" : pending ? stopped || done ? "Incomplete" : "Checking" : "Evidence returned";
            return <article className={"decision-card" + (pending && !stopped && !done ? " decision-pending" : "")} key={card.callId || i}>
              <div className="decision-title"><h3>{copy.title}{card.subject ? <span> · {card.subject}</span> : null}</h3><span className={"decision-status " + (failed ? "unavailable" : pending ? "pending" : "returned")}>{label}</span></div>
              <p><b>{card.reason ? "Agent’s stated purpose" : "Check purpose"}</b> {card.reason || card.purpose || copy.purpose}</p>
              <div className="decision-result" key={card.tool}>{failed ? "This lookup did not return usable evidence. It remains an open question." : pending ? stopped || done ? "No result was received before this run ended." : "Waiting for the tool result…" : card.outcome || "Result recorded in the technical trace."}</div>
            </article>;
          }) : <div className="decision-empty"><span className={mode === "live" ? "orbit-marker" : ""} /><p>{skipped ? "No agent-selected lookup was completed. This report uses the available engine evidence." : stopped ? "The scan stopped before a follow-up check could finish." : done ? "No follow-up tools were called in this investigation." : "Checks appear here when the agent chooses them. Each one shows its purpose and the evidence it returns."}</p></div>}
        </div>
      </div>

      {(example || done) && <div className={"investigation-outcome" + (example && !replayScored ? " outcome-waiting" : "")}>
        {example && !replayScored ? <><div><span className="eyebrow">03 / What changed</span><h3>Following the evidence…</h3><p>The recorded score change appears when the lookup returns and the engine applies it.</p></div><div className="score-transition"><span>{baselineScore ?? "—"}</span><span className="transition-arrow">→</span><strong>…</strong><small>awaiting replay result</small></div></> : <>
        <div><span className="eyebrow">03 / What changed</span><h3>{score == null ? "Score withheld" : baselineScore === score ? "More context. The score holds." : "New evidence changed the score."}</h3><p>{example ? "Approval exposure added an 18-point penalty. The scoring engine applied the change." : `${additions.length} additional finding${additions.length === 1 ? "" : "s"} from follow-up evidence. ${failures.length ? `${failures.length} failed lookup${failures.length === 1 ? " remains" : "s remain"} unresolved.` : "Review the findings below for the scope of this report."}`}</p></div>
        <div className="score-transition" aria-label={`Baseline ${baselineScore ?? "unscored"}, final ${score ?? "unscored"}`}><span>{baselineScore ?? "—"}</span><span className="transition-arrow">→</span><strong>{score ?? "—"}</strong><small>engine score / 100</small></div>
        </>}
      </div>}
      {!example && failures.length > 0 && !done && <div className="investigation-warning" role="status">{failures.length} lookup{failures.length === 1 ? "" : "s"} unavailable. Missing evidence will not be presented as a passed check.</div>}
      {!example && <details className="technical-trace"><summary>Technical trace <span>{steps.length} events</span></summary>{children}</details>}
    </section>
  );
}
