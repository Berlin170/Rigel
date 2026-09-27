import test from "node:test";
import assert from "node:assert/strict";
import { applyFindingScope, modelReportFacts, hasPartialCoverage } from "../app/lib/scope.mjs";
import { reportMarkdown } from "../app/lib/report.mjs";

function report() {
  return {
    chainLabel: "Base", total: 121062, score: 68, baselineScore: 46,
    metrics: { topSymbol: "TRUE", topShare: 107910 / 121062, combinedTotal: 668823, chainsScanned: 2 },
    findings: [
      { id: "concentration", title: "One position carries the whole wallet", detail: "Old claim", evidence: "TRUE $107,910 of $121,062", penalty: 30 },
      { id: "cross-chain", detail: "Observed Ethereum value", penalty: -30 },
      { id: "approvals", penalty: 8 },
    ],
    holdings: [{ symbol: "TRUE", value: 107910, share: 107910 / 121062 }],
    trace: [{ tool: "agent.tool", status: "fail", detail: "inspect_token(WHITE) unavailable" }],
  };
}

test("Base concentration and cross-chain context remain distinct without changing score arithmetic", () => {
  const r = report();
  const before = r.findings.map((f) => f.penalty);
  r.scope = applyFindingScope(r);
  assert.match(r.findings[0].title, /Base holdings/);
  assert.match(r.findings[0].detail, /89\.1% of priced holdings on Base/);
  assert.match(r.findings[0].detail, /16\.1% of observed value/);
  assert.match(r.findings[0].detail, /refunds 30/);
  assert.deepEqual(r.findings.map((f) => f.penalty), before);
  assert.equal(r.score, 68);
  assert.equal(r.findings[1].scope, "Scanned chains");
  assert.equal(r.findings[2].scope, "Base");
});

test("shared model facts include wider evidence, revised concentration context, and failed lookups", () => {
  const r = report();
  applyFindingScope(r);
  const facts = modelReportFacts(r);
  assert.equal(facts.startingChainValueUsd, 121062);
  assert.equal(facts.combinedValueUsd, 668823);
  assert.equal(facts.startingPositionShareOfObservedValue, 107910 / 668823);
  assert.match(facts.findings[0].context, /not the token's consolidated exposure/);
  assert.equal(facts.coverageGaps.length, 1);
  assert.ok(hasPartialCoverage(r));
});

test("single-chain and unscored reports do not acquire invented cross-chain conclusions", () => {
  const r = report();
  r.metrics = { topSymbol: "TRUE", topShare: 0.7 };
  r.findings = r.findings.slice(0, 1);
  r.trace = [];
  applyFindingScope(r);
  assert.ok(!r.findings[0].detail.includes("refund"));
  assert.equal(modelReportFacts(r).chainsScanned, 1);
  assert.equal(hasPartialCoverage(r), false);
  const empty = modelReportFacts({ total: 0, score: null });
  assert.equal(empty.startingPositionShareOfObservedValue, null);
  assert.equal(empty.healthScore, null);
});

test("download preserves chain scope and partial coverage", () => {
  const r = report();
  r.scope = applyFindingScope(r);
  const md = reportMarkdown(r);
  assert.match(md, /Coverage: Partial/);
  assert.match(md, /Scope: Base/);
  assert.match(md, /Scope: Scanned chains/);
});
