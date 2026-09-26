import test from "node:test";
import assert from "node:assert/strict";
import { readNdjson } from "../app/lib/ndjson.mjs";
import { reportMarkdown, scoreLedger } from "../app/lib/report.mjs";

test("stream preserves split UTF-8 and a final record without newline", async () => {
  const bytes = new TextEncoder().encode('{"t":"step","text":"€ →"}\n\n{"t":"done"}');
  const body = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  const received = [];
  await readNdjson(body, (msg) => received.push(msg));
  assert.deepEqual(received, [{ t: "step", text: "€ →" }, { t: "done" }]);
  assert.equal(body.locked, false);
});

test("malformed records fail visibly and release the stream", async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"t":')); c.close(); } });
  await assert.rejects(readNdjson(body, () => {}), SyntaxError);
  assert.equal(body.locked, false);
});

test("missing response body fails instead of silently completing", async () => {
  await assert.rejects(readNdjson(null, () => {}), /empty response/);
});

const report = {
  address: "0xexample", chainLabel: "Base", score: 82, baselineScore: 70, grade: "Healthy",
  generatedAt: "2026-09-26T00:00:00.000Z",
  coverage: { balanceProvider: "goldrush", seriesPoints: 30, lastTransaction: null },
  findings: [
    { id: "concentration", title: "Concentration", penalty: 30, detail: "Initial evidence", evidence: "60%" },
    { id: "refund", title: "Broader evidence", penalty: -30, detail: "Expanded coverage", evidence: "Other chains" },
    { id: "approvals", title: "Approvals", penalty: 18, detail: "Allowance exposure", evidence: "$1,000" },
    { id: "note", title: "Informational", penalty: 0 },
  ], trace: [{ tool: "chain.activity", detail: "Unavailable", status: "fail", ms: 100 }],
};

test("export preserves penalty refunds, coverage gaps, and the actual trace", () => {
  const ledger = scoreLedger(report);
  assert.equal(100 - ledger.reduce((sum, f) => sum + f.penalty, 0), report.score);
  const md = reportMarkdown(report);
  for (const part of ["+30 points", "−18 points", "Baseline: 70/100", "Final: 82/100", "[fail] chain.activity", "goldrush", "Latest transaction observed: Unavailable"]) assert.ok(md.includes(part), part);
});

test("unscored reports do not present penalties as a grade", () => {
  const md = reportMarkdown({ ...report, score: null, baselineScore: null });
  assert.ok(md.includes("Score withheld"));
  assert.ok(!md.includes("−30 points"));
  assert.ok(md.includes("Final: Not scored"));
});
