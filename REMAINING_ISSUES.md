# Remaining issues

## Provider and analysis safety

1. **P1 — News Intelligence live analysis did not complete, and the tested spend threshold is not a hard cap.** Two manual Polza requests used synthetic news only. The first stopped at T08 after 8 calls; known priced calls total 0.25234689 ₽ but `costReported=false`, so its final charge is unknown. The authorized repeat stopped at T08 after 12 calls and returned HTTP 503 `POLZA_COST_LIMIT_REACHED`; the reported charge was 1.03465749 ₽ against the approved 1 ₽ maximum, an overrun of 0.03465749 ₽. T09 did not run. No more paid calls were made. Do not run external AI until the provider dashboard has been reconciled and a real preflight/reservation or provider-side cap prevents this failure mode.
2. **P1 — Impact Analysis external route bypasses its canonical evidence pipeline.** `run_external` calls `stage1_analyzer.analyze_one` and only applies local guards; it omits the module's Bank RAG retrieval, exact quote checks and semantic support check. Route this UI through `stage2_analyzer.analyze_company` before treating the AI output as evidence-backed.
3. **P1 — Impact Analysis has no hard per-request spend cap.** Its numeric field is now accurately described as a post-response notification threshold. It cannot prevent a single request from exceeding the chosen value when provider cost is only known after the response. Do not describe it as a guaranteed budget cap.
4. **P1 — Product research duplicate prevention does not survive refresh or a second tab.** The server keeps active jobs in memory and deduplicates only by client-generated request ID. A refresh or new tab may generate a new ID for the same company/event while a paid run is still active. Add server-side active-job deduplication or durable job recovery before relying on the UI as a cost guard.
5. **P2 — External AI workflows besides module 02 were not live-tested.** AI Agent Studio, Impact Analysis and product chat/research were not sent to Polza in this pass. Health status confirms provider readiness, not successful or high-quality inference.

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

- The last live provider request used only a synthetic article and synthetic T09 candidate; no company profile or bank material was sent. T08 failed, T09 did not run, and the full provider charge is unknown from the application response.
- The full test suite and browser E2E use fixtures. Product/local-data reads are local-only. Source CSVs, source SQLite databases, the bank knowledge index and existing source-project history were not cleared or overwritten, and are not included in these reports.
- The local dev API is currently running at `http://127.0.0.1:8097`, with Studio at `http://127.0.0.1:5173/studio`. External mode is available but remains manual-only.
- For module-level evidence and exact reproduction details, see [the nine reports](docs/module-reports/README.md).
