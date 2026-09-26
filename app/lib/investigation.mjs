export const STAGES = ["Scan", "Identify gaps", "Investigate", "Verify", "Report"];

export const TOOL_COPY = {
  scan_chain: { title: "Explore another chain", purpose: "Find value the starting chain cannot show." },
  check_approvals: { title: "Check spending permissions", purpose: "Check what approved contracts can still move." },
  inspect_token: { title: "Inspect token holders", purpose: "Check whether a held token's supply is concentrated." },
};

export function activeStage(steps, mode) {
  if (mode === "done") return 4;
  if (steps.some((s) => s.tool === "report.start" || s.tool === "rigel.brief")) return 4;
  if (steps.some((s) => s.tool === "engine.verify" || s.tool === "engine.revise")) return 3;
  if (steps.some((s) => s.tool === "agent.tool.start" || s.tool === "agent.tool" || s.tool === "engine.sweep")) return 2;
  if (steps.some((s) => s.tool === "engine.diagnose" || s.tool === "agent.decide")) return 1;
  return 0;
}

export function investigations(steps) {
  const cards = new Map();
  for (const [i, step] of steps.entries()) {
    if (!["agent.tool.start", "agent.tool"].includes(step.tool)) continue;
    const name = step.name || step.detail?.split("(")[0];
    const key = step.callId || `legacy-${i}`;
    cards.set(key, { ...cards.get(key), ...step, name });
  }
  return [...cards.values()];
}

export function toolOutcome(name, out) {
  if (name === "scan_chain") return `${out.chain}: $${out.totalUsd.toLocaleString("en-US")} in priced holdings across ${out.positions} positions.`;
  if (name === "check_approvals") return `${out.openApprovals} live approvals; $${out.totalValueAtRiskUsd.toLocaleString("en-US")} of current value exposed.`;
  if (name === "inspect_token") return `${out.symbol}: ${out.holders == null ? "holder count unavailable" : out.holders.toLocaleString("en-US") + " holders"}${out.top10SupplyShare == null ? "; supply share unavailable" : "; top 10 hold " + (out.top10SupplyShare * 100).toFixed(1) + "% of supply"}.`;
  return "Lookup returned evidence.";
}
