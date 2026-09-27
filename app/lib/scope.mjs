export const SCOPE_RULES = [
  "Chain scope is mandatory: holdings, position counts, concentration, stable share, long-tail share, history, and approvals refer only to startingChain unless explicitly stated otherwise.",
  "When combinedValueUsd exceeds startingChainValueUsd, acknowledge the additional chains before describing the wallet's overall risk. Never call a starting-chain percentage a percentage of the entire wallet.",
  "startingPositionShareOfObservedValue describes only that position on the starting chain divided by observed value across scanned chains. It is NOT aggregate exposure to that asset or the largest position across chains. Do not calculate missing consolidated ratios.",
  "Explain the final score using scoreScope and the cross-chain finding. A concentration refund adjusts the heuristic; it does not erase the starting-chain concentration or establish whole-wallet diversification.",
  "Use these report facts over conflicting earlier chat responses. When answering what to fix first, distinguish starting-chain findings from the wider observed wallet and mention relevant cross-chain context.",
  "Report coverage gaps as unknown, never as passed checks. Holder distribution is not proof of liquidity, sellability, or inability to sell.",
].join("\n");

export function scopeContext(report) {
  const startingChain = report.chainLabel || report.chain || "Starting chain";
  const startingChainValueUsd = report.total || 0;
  const combinedValueUsd = report.metrics?.combinedTotal ?? startingChainValueUsd;
  const topShare = report.metrics?.topShare;
  return {
    startingChain,
    startingChainValueUsd,
    combinedValueUsd,
    chainsScanned: report.metrics?.chainsScanned || 1,
    startingPositionSymbol: report.metrics?.topSymbol || null,
    startingChainTopShare: topShare ?? null,
    startingPositionShareOfObservedValue: combinedValueUsd > 0 && topShare != null
      ? startingChainValueUsd * topShare / combinedValueUsd : null,
    scoreScope: `${startingChain} diagnostic heuristic, adjusted by available follow-up evidence. Not a consolidated multichain portfolio score.`,
  };
}

export function applyFindingScope(report) {
  const scope = scopeContext(report);
  for (const finding of report.findings || []) {
    finding.scope = finding.id === "cross-chain" ? "Scanned chains" : scope.startingChain;
    if (finding.id !== "concentration") continue;
    const share = scope.startingChainTopShare;
    if (share == null) continue;
    finding.title = share >= 0.6 ? `One position dominates ${scope.startingChain} holdings`
      : share >= 0.4 ? `Top position is heavy on ${scope.startingChain}` : `Weight is spread on ${scope.startingChain}`;
    finding.detail = `${scope.startingPositionSymbol} is ${(share * 100).toFixed(1)}% of priced holdings on ${scope.startingChain}. This measures the starting chain only.`;
    if (scope.combinedValueUsd > scope.startingChainValueUsd) {
      finding.detail += ` That same ${scope.startingChain} position represents ${(scope.startingPositionShareOfObservedValue * 100).toFixed(1)}% of observed value across ${scope.chainsScanned} scanned chains. This is not the token's consolidated exposure across chains.`;
      const refund = -(report.findings.find((f) => f.id === "cross-chain")?.penalty || 0);
      if (refund > 0) finding.detail += ` The cross-chain finding refunds ${refund} concentration penalty points in the final score; the original penalty remains in the ledger for auditability.`;
    }
  }
  return scope;
}

export function modelReportFacts(report) {
  return {
    ...scopeContext(report),
    healthScore: report.score,
    baselineScore: report.baselineScore,
    grade: report.grade,
    startingChainMetrics: report.metrics,
    coverageGaps: (report.trace || []).filter((s) => s.status === "fail").map((s) => ({ tool: s.tool, detail: s.detail })),
    findings: (report.findings || []).map((f) => ({ id: f.id, scope: f.scope || (f.id === "cross-chain" ? "Scanned chains" : report.chainLabel), severity: f.severity, title: f.title, evidence: f.evidence, scorePenalty: f.penalty, ...(f.id === "concentration" || f.id === "cross-chain" ? { context: f.detail } : {}) })),
    startingChainHoldings: (report.holdings || []).slice(0, 10).map((h) => ({ symbol: h.symbol, valueUsd: Math.round(h.value), share: h.share ?? (report.total ? h.value / report.total : 0) })),
  };
}

export function hasPartialCoverage(report) {
  return (report?.trace || []).some((s) => s.status === "fail");
}
