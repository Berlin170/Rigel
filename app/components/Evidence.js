"use client";

import { reportMarkdown, scoreLedger } from "../lib/report.mjs";

function download(report, format) {
  const json = format === "json";
  const blob = new Blob([json ? JSON.stringify(report, null, 2) : reportMarkdown(report)], {
    type: json ? "application/json" : "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rigel-${report.chain}-${report.address}.${json ? "json" : "md"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Evidence({ report }) {
  const failed = (report.trace || []).filter((s) => s.status === "fail").length;
  const adjustments = scoreLedger(report);
  return (
    <section className="evidence-panel" aria-label="Report evidence and score breakdown">
      <div className="evidence-header">
        <div>
          <h2>Verify this diagnosis</h2>
          <p>Follow every score adjustment back to a finding.</p>
        </div>
        <div className="evidence-actions">
          <button className="ghost" onClick={() => download(report, "md")}>Download report</button>
          <button className="ghost" onClick={() => download(report, "json")}>Evidence JSON</button>
        </div>
      </div>
      <div className="coverage-strip">
        <span>Balances: <b>{report.coverage?.balanceProvider || "Unknown"}</b></span>
        <span>History: <b>{report.coverage?.seriesPoints ?? 0} daily points</b></span>
        <span>Failed lookups: <b>{failed}</b></span>
        {report.generatedAt && <time dateTime={report.generatedAt}>{new Date(report.generatedAt).toLocaleString()}</time>}
      </div>
      {failed > 0 && <p className="coverage-warning">Some lookups failed. Unavailable evidence does not mean a check passed; see the full trace.</p>}
      <details>
        <summary>How the score was calculated {report.score != null && `· ${report.baselineScore} → ${report.score}`}</summary>
        {report.score == null ? <p>This report is not scored because the available evidence does not support a grade.</p> : (
          <div className="score-ledger">
            <div><span>Starting score</span><strong>100</strong></div>
            {adjustments.map((f) => <div key={f.id}><span>{f.title}</span><strong className={f.penalty < 0 ? "credit" : "debit"}>{f.penalty < 0 ? "+" : "−"}{Math.abs(f.penalty)}</strong></div>)}
            <div className="ledger-total"><span>Final score <small>(clamped to 0–100)</small></span><strong>{report.score}</strong></div>
          </div>
        )}
      </details>
      <p className="evidence-scope">Holdings and shape metrics describe {report.chainLabel}. Additional chain totals broaden the evidence; this is not a full multichain portfolio audit. The score is a heuristic, not a security guarantee.</p>
    </section>
  );
}
