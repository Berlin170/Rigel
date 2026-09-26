"use client";

import { useEffect, useRef, useState } from "react";

// Paced playback of the existing recorded example, never a live lookup.
export const REPLAY_STEPS = [
  { tool: "resolve", detail: "jesse.base.eth → 0x8491…8bf1", ms: 210 },
  { tool: "chain.portfolio", detail: "Base · 30-day daily holdings series", ms: 1840 },
  { tool: "engine.diagnose", detail: "baseline checks complete · health 85", baseline: { score: 85 }, ms: 12 },
  { tool: "agent.decide", detail: "look beyond balances: inspect spending permissions" },
  { tool: "agent.tool.start", detail: "check_approvals() · reading outstanding allowances", callId: "example", name: "check_approvals", purpose: "Check what approved contracts can still move." },
  { tool: "agent.tool", detail: "check_approvals() · 19 live · $1,293 reachable", callId: "example", name: "check_approvals", status: "ok", purpose: "Check what approved contracts can still move.", outcome: "19 live approvals; $1,293 of current value exposed.", ms: 890 },
  { tool: "engine.revise", detail: "approval exposure adds 18 penalty points · health 67", ms: 8 },
  { tool: "report.start", detail: "85 → 67 · the score moved on evidence" },
];

export function useAgentReplay(active) {
  const [count, setCount] = useState(REPLAY_STEPS.length);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setReducedMotion(media.matches);
      if (media.matches) setCount(REPLAY_STEPS.length);
    };
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    if (!media.matches) setCount(1);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!active || paused || reducedMotion || !visible) return;
    const timer = setTimeout(() => setCount((n) => n >= REPLAY_STEPS.length ? 1 : n + 1), count >= REPLAY_STEPS.length ? 5000 : count === 5 ? 1800 : 1150);
    return () => clearTimeout(timer);
  }, [active, count, paused, reducedMotion, visible]);

  return { count, paused, reducedMotion, toggle: () => setPaused((value) => !value) };
}

export default function AgentActivity({ steps, example, working, paused, reducedMotion, onToggle }) {
  const body = useRef(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [steps.length]);

  return <div className={"agent-activity" + (working && !paused && !reducedMotion ? " activity-running" : "")} aria-label={example ? "Animated recorded example" : "Live agent activity"}>
    <div className="activity-bar">
      <span className="console-lights" aria-hidden="true"><i /><i /><i /></span>
      <span className="console-name">rigel<span className="activity-slash"> / </span><b>{example ? "example playback" : "investigation stream"}</b></span>
      <span className="activity-indicator" aria-hidden="true"><i /><i /><i /><i /></span>
      {example ? reducedMotion ? <span className="activity-label">motion reduced</span> : <button className="ghost" onClick={onToggle} aria-pressed={paused}>{paused ? "Resume replay" : "Pause replay"}</button> : <span className="activity-label">{working ? "receiving events" : "run ended"}</span>}
    </div>
    <div className="activity-stream" ref={body} tabIndex={0} aria-label="Recent agent events">
      {steps.map((step, i) => <div className={"crow " + (example ? "crow-type" : "crow-in")} key={`${i}-${step.tool}`}>
        <span className="crow-n">{String(i + 1).padStart(2, "0")}</span>
        <span className={"crow-tool " + (step.tool.startsWith("agent.") ? "is-agent" : "")}>{step.tool}</span>
        <span className="crow-detail">{step.detail}</span>
        <span className={"crow-ms" + (step.status === "fail" ? " is-fail" : "")}>{step.status === "fail" ? "failed" : step.ms ? `${step.ms}ms` : "—"}</span>
      </div>)}
      {working && <div className="activity-wait"><span className={!paused && !reducedMotion ? "caret" : "quiet-caret"} aria-hidden="true" /><span>{example ? paused ? "Replay paused" : "Playing recorded events…" : "Waiting for the next agent event…"}</span></div>}
    </div>
    {example && <div className="activity-disclosure">Recorded example · paced playback · no live requests</div>}
  </div>;
}
