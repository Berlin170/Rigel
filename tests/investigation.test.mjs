import test from "node:test";
import assert from "node:assert/strict";
import { activeStage, investigations, toolOutcome } from "../app/lib/investigation.mjs";

test("stages advance on observed events, including verification without score change", () => {
  const steps = [];
  assert.equal(activeStage(steps, "live"), 0);
  for (const [tool, expected] of [["engine.diagnose", 1], ["agent.tool.start", 2], ["engine.verify", 3], ["report.start", 4]]) {
    steps.push({ tool });
    assert.equal(activeStage(steps, "live"), expected);
  }
  assert.equal(activeStage([], "error"), 0);
});

test("tool cards pair start and completion even when parallel calls finish out of order", () => {
  const steps = [
    { tool: "agent.tool.start", callId: "a", name: "scan_chain", reason: "Check another chain" },
    { tool: "agent.tool.start", callId: "b", name: "check_approvals" },
    { tool: "agent.tool", callId: "b", name: "check_approvals", status: "fail" },
    { tool: "agent.tool", callId: "a", name: "scan_chain", status: "ok", outcome: "Evidence" },
  ];
  const cards = investigations(steps);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].reason, "Check another chain");
  assert.equal(cards[0].status, "ok");
  assert.equal(cards[1].status, "fail");
});

test("pending tools and repeated investigations remain distinct", () => {
  const cards = investigations([
    { tool: "agent.tool.start", callId: "1", name: "scan_chain" },
    { tool: "agent.tool.start", callId: "2", name: "scan_chain" },
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].tool, "agent.tool.start");
});

test("outcomes preserve zero and unknown instead of inventing safe results", () => {
  assert.equal(toolOutcome("check_approvals", { openApprovals: 0, totalValueAtRiskUsd: 0 }), "0 live approvals; $0 of current value exposed.");
  assert.match(toolOutcome("inspect_token", { symbol: "TEST", holders: null, top10SupplyShare: null }), /holder count unavailable; supply share unavailable/);
});
