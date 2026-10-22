# Remaining issues

## Update after round 3 (2026-10-22)

The final `npm run test:all` and `npm run test:e2e:studio` both pass. All nine fixture routes run; product company/feed tests remain partial without explicit IDs. Personalization's mobile comparison, Evidence Verification's empty-input fallback and duplicate React keys, and unavailable local option requests were fixed and rechecked in Chromium. Evidence Verification still checks exact quotation only: a synthetic claim of 19% with a source quote of 12% returns `supported`. The final allowed Polza run cost 0.9054272 ₽; earlier calls include one unknown-cost timeout, so cumulative spend cannot be confirmed. No further external calls were made.

## Provider and analysis safety

1. **P1 — News Intelligence's configured spend threshold is post-response, not a hard cap.** The latest authorized synthetic-only T08/T09 run completed in 15 Polza calls for 0.9054272 ₽; T08 did not establish an event match, and T09 compared against a near-identical candidate. A prior request crossed its 1 ₽ threshold at 1.03465749 ₽, and a separate timeout did not report final cost. Cumulative actual spend cannot be derived from application logs. Reconcile the provider dashboard and add a provider-side cap or conservative preflight/reservation before further spend.
2. **P1 — Impact Analysis external route bypasses its canonical evidence pipeline.** `run_external` calls `stage1_analyzer.analyze_one` and only applies local guards; it omits the module's Bank RAG retrieval, exact quote checks and semantic support check. Route this UI through `stage2_analyzer.analyze_company` before treating the AI output as evidence-backed.
3. **P1 — Impact Analysis has no hard per-request spend cap.** Its numeric field is now accurately described as a post-response notification threshold. It cannot prevent a single request from exceeding the chosen value when provider cost is only known after the response. Do not describe it as a guaranteed budget cap.
4. **P2 — Product job deduplication is process-local.** The current server returns an already active research job for the same mode/company/event even when a second tab sends a new request ID; targeted unit tests cover this. Jobs still live only in memory, so a backend restart or multi-worker deployment would lose the protection/recovery state. Persist or recover jobs before using the process-local API in a multi-worker or restart-tolerant deployment.
5. **P2 — External AI workflows besides module 02 were not live-tested.** AI Agent Studio, Impact Analysis, Bank Research, Evidence Verification and product chat/research were not sent to Polza in this pass. Health status confirms configured readiness, not successful or high-quality inference.

## Evaluation and data completeness

6. **P2 — Personalization has no independent relevance gold set.** Fixture suites confirm execution and output structure, not ranking quality. Precision@K, Recall@K and NDCG cannot be responsibly reported without reviewed labels. A successful local ranking run can also rebuild the business graph SQLite cache; the safe local happy path was therefore skipped in the isolated module audit.
7. **P2 — Bank Research evaluates lexical retrieval, not semantic applicability.** BM25 returns matching pages locally, but no independent query→page relevance labels exist and the module has no document catalog/index-health view. Keep results labelled as lexical context until measured.
8. **P2 — Evidence Verification is not independent semantic review.** The exact quote check is deterministic; its optional semantic review uses the same model family and is explicitly marked non-independent. Composite claims, numeric reconciliation and contradiction search remain unsupported.
9. **P2 — Business Intelligence graph is not navigable.** Payment totals now state that they use source `PAY_AMT` units and that currency/period are unknown. The graph is still rendered as counters/lists; make relationship evidence easier to inspect and navigate.
10. **P2 — Product history is hard to audit.** History rows omit some of company, event title, exact time and cost. Legacy entries may contain only metadata, and history can briefly show the prior context after a company/event switch. Clear/scope history on context changes and expose stored-result limitations.
11. **P2 — History GET may update SQLite journal metadata.** `GET /api/history` uses a normal SQLite connection and runs `PRAGMA journal_mode=WAL`. No history rows were changed by the browser audit, but a read-only URI connection is preferable for a read endpoint.
12. **P2 — Product API is a legacy unversioned surface.** Direct `/api/companies`, `/workspace`, `/event`, `/history`, `/research` and `/chat` payloads lack the module API's versioned contract/error envelope. Document and version them when evolving the endpoint shape.

## Coverage limits

13. **P2 — News source coverage is partial.** One public CBR RSS feed has previously completed a live fetch; the other allowlisted feed and live outage path were not manually exercised. Fixture error scenarios cover injected failures.
14. **FIXED — Personalization comparison was horizontally scrollable on mobile.** It now stacks the same event and company values in labelled rows; Chromium measured comparison width 326/326 px at a 390 px viewport. Screenshot: [fixed mobile comparison](docs/module-reports/assets/04-personalization-round3-compare-mobile-fixed.png).
15. **INFO — Product chat/research error states and source destinations.** This pass did not submit product chat/research, force a missing archive/RAG dependency, or navigate to public source destinations. Those behaviors are not claimed as live-verified.
16. **P2 — Independent module launch coverage is incomplete.** The latest browser E2E opened and exercised all nine routes through Studio. Separate CLI boot commands were previously verified for Personalization and Product, but not for each module in isolation. Run and document the remaining module commands when validating the standalone-development requirement.

## Data and cost handling

- The latest live provider request used only a synthetic article and a near-identical synthetic T09 candidate; no company profile or bank material was sent. It completed T08/T09 and reported 0.9054272 ₽. Earlier priced attempts included one overrun and a separate timeout with unknown final cost; cumulative actual charge remains unavailable.
- Fixture suites and browser algorithm runs used synthetic data. Local option lists were read from the configured local root; no source CSV, source SQLite, bank index, or existing source-project history was changed or included in the reports.
- The local dev API is currently running at `http://127.0.0.1:8097`, with Studio at `http://127.0.0.1:5173/studio`. It has the existing read-only data root configured and External AI is enabled for manual actions only; no automatic provider calls occur.
- For module-level evidence and exact reproduction details, see [the nine reports](docs/module-reports/README.md).
