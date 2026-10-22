# Remaining issues

## Latest T08 timeout fix (2026-10-22)

The recurring false timeout caused by waiting in a serialized provider queue is fixed. Timers now start at network dispatch, body reads have the same deadline, and Polza receives the documented `reasoning.effort=none`. Known spending survives interrupted requests; successful real answers support explicitly labelled local resume. Unknown-payment requests cannot be resent without an explicit manual selection.

Live Chromium verification: T08/T09 completed in 48 s, 19 calls, 0.59243515 ₽; replay used 19 cached real responses, 0 new calls, 0 ₽, 1 s. Tests/build/nine-route Studio E2E passed. This does not fix unrelated AI Agent token estimation, Impact external evidence routing, or provide an independent classifier-quality benchmark. Genuine provider/network timeouts remain possible; historical unknown charges cannot be reconstructed from old application data.

The Round 5 limitations below remain historical where superseded by this fix.

## Current status after Round 5 (2026-10-22)

All nine modules were reopened and exercised in Chromium. Their fixture UI runs, module suites, and the nine-route Studio E2E passed. A new external-AI loading message now shows elapsed time and tells users that stage-level progress and exact usage are only available after completion; the full build and E2E passed after this UX change. Overall product readiness remains **PARTIAL**.

Three live requests completed in this round: News Intelligence on synthetic input reported 21 provider/model calls and **0.98417155 ₽**; two AI Agent calls on manually selected local profile/event reported **0.05797968 ₽** and **0.1114824 ₽**. Round 5 known spend is **1.15363363 ₽** across 23 provider/model requests; cumulative historical spend is not recalculated here.

### Open findings

1. **P1 — AI Agent live run stops after planning, before evidence tools.** The post-change request registered four planned tools, then the internal token budget stopped the next model request before `get_company_profile`/`get_event_facts`; sources remained empty. The orchestrator now marks unfinished steps `unavailable`, returns `partial`, and displays the stop reason. Live research remains unverified; compact prompts/token estimation need improvement before another authorized run.
2. **P1 — External AI thresholds are post-response checks, not guaranteed spend caps.** The News Intelligence request stayed below its displayed 1 ₽ threshold, but used 21 provider/model requests and took several minutes. Add provider-side spending limits or a conservative preflight/reservation before calling a threshold a cap.
3. **P1 — Impact Analysis external route bypasses its canonical evidence pipeline.** The existing `run_external` path omits canonical Bank RAG retrieval and evidence checks. Route the UI through the canonical analyzer before treating external output as evidence-backed.
4. **P2 — Several optional external modes remain unverified.** Business Intelligence, Impact Analysis, Bank Research, Evidence Verification and the product chat/deep research were not called in Round 5. Product chat/research was specifically skipped because the UI does not preview the complete payload before submission. Readiness/allowlist status is not proof of successful inference.
5. **P2 — No independent quality oracle exists for Personalization or Bank Research.** Fixture and Local Data runs establish execution, but not ranking accuracy or semantic relevance. Reviewed labels are needed before reporting Precision@K, Recall@K, NDCG, or document relevance as measured.
6. **P2 — Product history and API remain difficult to audit.** History rows omit some company/event context and cost; direct product API routes remain a legacy unversioned surface. The read endpoint's SQLite connection may update journal metadata.
7. **P2 — Business graph and source coverage are limited.** The graph is a bounded static SVG (up to 15 nodes), payment amounts have unknown currency/period, and live RSS outage behavior was not freshly exercised because collection writes to persistent SQLite.

The detailed per-module evidence is in [the nine Round 5 reports](docs/module-reports/README.md). Source CSV and source-data SQLite were not changed; existing history rows were not edited or cleared. The two authorized live AI Agent runs appended new records through the normal history path.

## Historical note — update after round 4 (2026-10-22)

`npm run test:all`, `npm run test:e2e:studio`, production build and `git diff --check` pass. All nine fixture routes and 30 scenarios passed; a separate real-data browser pass exercised local ranking, profile/event input loading, RAG retrieval, product source display and the mobile company-switch fix. Evidence Verification now rejects the synthetic 19%/12% percentage mismatch. A new T08/T09 attempt cost 0.447428 ₽ and did not complete T08 taxonomy selection. Previously priced attempts total approximately 3.60683315 ₽; another timeout lacks final cost, so aggregate charges remain unknown against the 5 ₽ ceiling. No additional provider calls were made.

## Provider and analysis safety

1. **P1 — News Intelligence's configured spend threshold is post-response, not a hard cap.** The latest authorized synthetic-only run ended after 8 Polza calls at 0.447428 ₽; T08 did not select a taxonomy label and T09 did not run. A prior request crossed its 1 ₽ threshold at 1.03465749 ₽, and a separate timeout did not report final cost. Cumulative actual spend cannot be derived from application logs. Reconcile the provider dashboard and add a provider-side cap or conservative preflight/reservation before further spend.
2. **P1 — Impact Analysis external route bypasses its canonical evidence pipeline.** `run_external` calls `stage1_analyzer.analyze_one` and only applies local guards; it omits the module's Bank RAG retrieval, exact quote checks and semantic support check. Route this UI through `stage2_analyzer.analyze_company` before treating the AI output as evidence-backed.
3. **P1 — Impact Analysis has no hard per-request spend cap.** Its numeric field is now accurately described as a post-response notification threshold. It cannot prevent a single request from exceeding the chosen value when provider cost is only known after the response. Do not describe it as a guaranteed budget cap.
4. **P2 — Product job deduplication is process-local.** The current server returns an already active research job for the same mode/company/event even when a second tab sends a new request ID; targeted unit tests cover this. Jobs still live only in memory, so a backend restart or multi-worker deployment would lose the protection/recovery state. Persist or recover jobs before using the process-local API in a multi-worker or restart-tolerant deployment.
5. **P2 — Most External AI workflows were not live-tested.** AI Agent Studio, Bank Research, Evidence Verification and product chat/research were not sent to Polza in this pass. Impact Analysis had one earlier manually authorized call, but its adapter bypasses the canonical evidence pipeline and the response does not certify that workflow. Health status confirms configured readiness, not successful or high-quality inference.

## Evaluation and data completeness

6. **P2 — Personalization has no independent relevance gold set.** The local ranker ran on the same 20-event set for two local profiles and showed profile-specific weak/unclear explanations. Fixture suites and this single comparison confirm execution, not ranking quality. Precision@K, Recall@K and NDCG cannot be responsibly reported without reviewed labels. The Business Intelligence adapter can rebuild its derived SQLite graph cache when source fingerprints change.
7. **P2 — Bank Research evaluates lexical retrieval, not semantic applicability.** BM25 returns matching pages locally, but no independent query→page relevance labels exist and the module has no document catalog/index-health view. Keep results labelled as lexical context until measured.
8. **P2 — Evidence Verification is not independent semantic review.** A deterministic percentage-consistency check now catches percentage conflicts. Other numeric units, composite claims and semantic citation applicability remain outside this check; the optional model review is not an independent expert assessment.
9. **P2 — Business Intelligence graph is static.** A bounded SVG graph now shows relationship direction and type, but it is not an interactive exploration surface and only exposes up to 15 nodes. Payment totals use source `PAY_AMT` units with unknown currency/period.
10. **P2 — Product history is hard to audit.** History rows omit some of company, event title, exact time and cost. Legacy entries may contain only metadata; expose those stored-result limitations in the UI.
11. **P2 — History GET may update SQLite journal metadata.** `GET /api/history` uses a normal SQLite connection and runs `PRAGMA journal_mode=WAL`. Product history rows were not changed by the browser read; the two separate live AI Agent runs appended records normally. A read-only URI connection is preferable for a read endpoint.
12. **P2 — Product API is a legacy unversioned surface.** Direct `/api/companies`, `/workspace`, `/event`, `/history`, `/research` and `/chat` payloads lack the module API's versioned contract/error envelope. Document and version them when evolving the endpoint shape.

## Coverage limits

13. **P2 — News source coverage is partial.** One public CBR RSS feed has previously completed a live fetch; the other allowlisted feed and live outage path were not manually exercised. Fixture error scenarios cover injected failures.
14. **FIXED — Personalization comparison was horizontally scrollable on mobile.** It now stacks the same event and company values in labelled rows; Chromium measured comparison width 326/326 px at a 390 px viewport. Screenshot: [fixed mobile comparison](docs/module-reports/assets/04-personalization-round3-compare-mobile-fixed.png).
15. **FIXED — Switching companies on mobile could leave the prior detail pane active.** Company selection now clears mobile detail mode; a live Chromium pass confirmed it returns to the new company's feed at 390/390 px.
16. **INFO — Product chat/research error states and source destinations.** This round did not submit product chat/research, force a missing archive/RAG dependency, or navigate to public source destinations. Those behaviors are not claimed as live-verified.
17. **P2 — Independent module launch coverage is incomplete.** The latest browser E2E opened and exercised all nine routes through Studio. Separate CLI boot commands were previously verified for Personalization and Product, but not for each module in isolation. Run and document the remaining module commands when validating the standalone-development requirement.

## Data and cost handling

- The latest live provider request used only a synthetic article and a synthetic T09 candidate; no company profile or bank material was sent. It ended during T08 and reported 0.447428 ₽. Earlier priced attempts included one overrun and a separate timeout with unknown final cost; cumulative actual charge remains unavailable.
- Fixture suites and browser algorithm runs used synthetic data. Local option lists were read from the configured local root; source CSVs and existing history rows were not edited or cleared. The two authorized AI Agent runs appended records in the staging history through the normal application path. No local values were included in reports. Some local paths can touch derived SQLite caches; see module reports for their safeguards and remaining caveats.
- The local dev API is currently running at `http://127.0.0.1:8097`, with Studio at `http://127.0.0.1:5173/studio`. It has the existing read-only data root configured and External AI is enabled for manual actions only; no automatic provider calls occur.
- For module-level evidence and exact reproduction details, see [the nine reports](docs/module-reports/README.md).
