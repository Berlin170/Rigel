export function scoreLedger(report) {
  return (report.findings || []).filter((f) => Number.isFinite(f.penalty) && f.penalty !== 0);
}

export function reportMarkdown(report) {
  const score = (value) => value == null ? "Not scored" : `${value}/100`;
  const lines = [
    "# Rigel wallet evidence report", "",
    `Wallet: ${report.address}`, `Starting chain: ${report.chainLabel}`,
    `Generated: ${report.generatedAt || "Not recorded"}`,
    `Balance provider: ${report.coverage?.balanceProvider || "Not recorded"}`, "",
    `Baseline: ${score(report.baselineScore)}`, `Final: ${score(report.score)} (${report.grade})`, "",
    "## Score breakdown", "",
    ...(report.score == null ? ["Score withheld; findings below are not a grade."] : [
      "Starts at 100. Positive adjustments refund an earlier penalty. Final score is clamped to 0–100.",
      ...scoreLedger(report).map((f) => `- ${f.title}: ${f.penalty < 0 ? "+" : "−"}${Math.abs(f.penalty)} points`),
    ]), "", "## Evidence coverage", "",
    `30-day series: ${report.coverage?.seriesPoints ?? "unknown"} daily points`,
    `Latest transaction observed: ${report.coverage?.lastTransaction || "Unavailable"}`,
    "A missing lookup is unknown, not evidence of safety. Holdings and shape metrics describe the starting chain; additional chain totals do not constitute a full multichain portfolio audit.",
    "", "## Findings", "",
    ...(report.findings || []).flatMap((f) => [`### ${f.title}`, f.detail, `Evidence: ${f.evidence || "None supplied"}`, ""]),
    "## Investigation trace", "",
    ...(report.trace || []).map((s) => `- [${s.status || "ok"}] ${s.tool}: ${s.detail} (${s.ms ?? 0} ms)${s.reason ? `\n  Stated purpose: ${s.reason}` : ""}${s.outcome ? `\n  Result: ${s.outcome}` : ""}`), "",
    "Snapshot of provider responses at scan time. Prices, holdings, and allowances can change. The score is a heuristic, not a security audit or investment recommendation.", "",
  ];
  return lines.join("\n");
}
