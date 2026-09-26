# Rigel — submission and demo

## Short pitch

Rigel investigates the risks a wallet balance alone cannot explain. It runs deterministic checks, lets an AI agent choose follow-up tools, and applies explicit scoring rules to the evidence returned. Every investigation exposes its tool trace, score adjustments, data coverage, and downloadable report. No wallet connection or signature is required.

## Submission description

Most wallet dashboards show balances. Rigel asks what those balances leave unanswered. Starting with an EVM address, it checks concentration, meaningful diversification, stablecoin share, long-tail exposure, unpriced positions, spam, drawdown, dust, and activity. The agent then chooses whether to inspect another chain, check token approvals, or inspect a held token's holder distribution. New evidence passes through explicit rules, and the interface shows how it affected the score.

The model selects investigations and writes explanations; the scoring engine assigns points. The live trace makes the tool use inspectable. A score ledger explains penalties and refunds, while report downloads preserve findings and trace data for review. Missing lookups remain visible, and backup balance data does not receive a misleading grade. Live results vary with wallet activity and provider coverage.

## Two-minute recording script

1. **0:00–0:15:** “A wallet can look diversified and still expose value through token allowances. Rigel investigates what the initial portfolio view misses.”
2. **0:15–0:30:** Show the landing page. Explain that the case study is a labeled recorded example. Click **jesse.base.eth** to start a real Base scan.
3. **0:30–1:00:** Show the five investigation stages and the live tool cards: the agent's stated purpose, tool result, and any unresolved lookup. Investigations can take several minutes; trim the waiting period in the recording and label the cut. Do not describe an example's historical figures as the current result.
4. **1:00–1:25:** Show the actual baseline and final score. Open **How the score was calculated**. Explain one finding and its evidence. An unchanged score is also a valid result.
5. **1:25–1:45:** Ask “Which finding should I investigate first, and what evidence supports it?” Show the answer or clearly state if inference is unavailable.
6. **1:45–2:00:** Download the report and evidence JSON. Expand **Technical trace** in the investigation panel: “The decisions are autonomous. The score is inspectable.”

## Links already present in the project

- Website: https://rigel-ten.vercel.app/
- Source: https://github.com/Berlin170/Rigel
- X: https://x.com/BerlinBuildWeb3
- Telegram: https://t.me/Berlin926

Record and add your demo-video link to the existing hackathon entry. Check that the submitted entry uses the intended wallet and all links open for a signed-out judge. Submission deadline supplied in the brief: September 27, 23:59 UTC.

## Honest scope

- This is a read-only diagnostic agent. It does not revoke allowances or move funds.
- The score is a heuristic, not a security audit. Symbol-based asset classification and incomplete price coverage limit its interpretation.
- Holdings and shape metrics describe the starting chain. Additional-chain totals are not a full consolidated asset-level risk analysis.
- AI-written text is prompted to use engine facts but is not a formal guarantee against numerical errors.
- The historical replay illustrates a prior run; it is not a live API response. Use the live trace as evidence for the current run.

## Local verification — September 26, 2026

`npm test`: 9 regression tests passed. `npm run build`: production build passed; Google Fonts stylesheet optimization was skipped because the build environment could not fetch it.

A real local scan of the Jesse sample completed in 76 seconds with GoldRush balances, 31 history points, 376 priced positions, and an Ethereum follow-up scan. The baseline and final score were both 76. The visible ledger and exported JSON reconciled to `100 - 9 - 10 - 5 = 76`. Approval and two token-holder lookups failed during this run; the coverage warning and trace reported all three failures. This verifies a complete report with partial investigation coverage, not an all-tools-successful run.

Browser checks also confirmed that selecting Ethereum and then clicking the Jesse sample starts a Base scan, and that a failed scan retains its actual trace. Both evidence-export buttons produced files in the browser download directory.

A subsequent scan with the redesigned investigation UI completed all four selected checks successfully: two token-holder inspections, approvals, and Ethereum balances. It added three findings and moved the score from 76 to 46. Desktop and phone-width layouts were checked. The restored animated replay was verified with working pause/resume controls; it remains labeled as recorded playback.
