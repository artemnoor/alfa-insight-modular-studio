# Remaining issues

## Provider and analysis safety

1. **P1 — News Intelligence's configured spend threshold is post-response, not a hard cap.** In this round one authorized synthetic-only T08/T09 run completed in 12 Polza calls for a reported 0.96455761 ₽ under the configured 1 ₽ threshold. T08 did not support a SENTiVENT event, and T09 returned `SAME` only against a candidate with practically identical text; this proves provider execution, not answer quality. A previous separate request crossed its 1 ₽ threshold at 1.03465749 ₽, and an earlier timed-out request did not report final cost. The cumulative actual charge cannot be derived from application logs. Do not treat the threshold as a guaranteed limit; reconcile the provider dashboard and add a provider-side cap or conservative preflight/reservation before additional spend.
2. **P1 — Impact Analysis external route bypasses its canonical evidence pipeline.** `run_external` calls `stage1_analyzer.analyze_one` and only applies local guards; it omits the module's Bank RAG retrieval, exact quote checks and semantic support check. Route this UI through `stage2_analyzer.analyze_company` before treating the AI output as evidence-backed.
3. **P1 — Impact Analysis has no hard per-request spend cap.** Its numeric field is now accurately described as a post-response notification threshold. It cannot prevent a single request from exceeding the chosen value when provider cost is only known after the response. Do not describe it as a guaranteed budget cap.
4. **P2 — Product job deduplication is process-local.** The current server returns an already active research job for the same mode/company/event even when a second tab sends a new request ID; targeted unit tests cover this. Jobs still live only in memory, so a backend restart or multi-worker deployment would lose the protection/recovery state. Persist or recover jobs before using the process-local API in a multi-worker or restart-tolerant deployment.
5. **P2 — External AI workflows besides module 02 were not live-tested.** AI Agent Studio, Impact Analysis, Bank Research, Evidence Verification and product chat/research were not sent to Polza in this pass. Health status confirms configured readiness, not successful or high-quality inference.

## Evaluation and data completeness

6. **P2 — Personalization has no independent relevance gold set.** Fixture suites confirm execution and output structure, not ranking quality. Precision@K, Recall@K and NDCG cannot be responsibly reported without reviewed labels. A successful local ranking run can also rebuild the business graph SQLite cache; the safe local happy path was therefore skipped in the isolated module audit.
7. **P2 — Bank Research evaluates lexical retrieval, not semantic applicability.** BM25 returns matching pages locally, but no independent query→page relevance labels exist and the module has no document catalog/index-health view. Keep results labelled as lexical context until measured.
8. **P2 — Evidence Verification is not independent semantic review.** The exact quote check is deterministic; its optional semantic review uses the same model family and is explicitly marked non-independent. Composite claims, numeric reconciliation and contradiction search remain unsupported.
9. **P2 — Business Intelligence hides payment-unit caveats and a navigable graph.** The core returns payment units and graph edges, but the main UI focuses on sums, counters and lists. Show source-period/currency limitations next to payment aggregates and make relationship evidence easier to inspect.
10. **P2 — Product history is hard to audit.** History rows omit some of company, event title, exact time and cost. Legacy entries may contain only metadata, and history can briefly show the prior context after a company/event switch. Clear/scope history on context changes and expose stored-result limitations.
11. **P2 — History GET may update SQLite journal metadata.** `GET /api/history` uses a normal SQLite connection and runs `PRAGMA journal_mode=WAL`. No history rows were changed by the browser audit, but a read-only URI connection is preferable for a read endpoint.
12. **P2 — Product API is a legacy unversioned surface.** Direct `/api/companies`, `/workspace`, `/event`, `/history`, `/research` and `/chat` payloads lack the module API's versioned contract/error envelope. Document and version them when evolving the endpoint shape.

## Coverage limits

13. **P2 — News source coverage is partial.** One public CBR RSS feed has previously completed a live fetch; the other allowlisted feed and live outage path were not manually exercised. Fixture error scenarios cover injected failures.
14. **P2 — Mobile comparison is dense.** The Studio and module pages show no horizontal overflow at 390 px, but the side-by-side company comparison is difficult to scan on a phone. A stacked comparison layout would improve readability.
15. **INFO — Product chat/research error states and source destinations.** This pass did not submit product chat/research, force a missing archive/RAG dependency, or navigate to public source destinations. Those behaviors are not claimed as live-verified.
16. **P2 — Independent module launch coverage is incomplete.** The latest browser E2E opened and exercised all nine routes through Studio. Separate CLI boot commands were previously verified for Personalization and Product, but not for each module in isolation. Run and document the remaining module commands when validating the standalone-development requirement.

## Data and cost handling

- The latest live provider request used only a synthetic article and a synthetic T09 candidate with practically identical content; no company profile or bank material was sent. It completed T08/T09 and reported 0.96455761 ₽. Earlier separate attempts included a reported overrun and an unknown final cost; cumulative actual charge remains unavailable.
- The full test suite and browser E2E use fixtures. Product/local-data reads are local-only. Source CSVs, source SQLite databases, the bank knowledge index and existing source-project history were not cleared or overwritten, and are not included in these reports.
- The local dev API is currently running at `http://127.0.0.1:8097`, with Studio at `http://127.0.0.1:5173/studio`. External mode is available but remains manual-only.
- For module-level evidence and exact reproduction details, see [the nine reports](docs/module-reports/README.md).
