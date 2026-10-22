# 02 · News Intelligence

Open `/studio/news-intelligence`. This workspace calls the existing T08 `classifyNews`, T08 `rankModelChoices`, T09 local hash-TFIDF vectorizer, and T09 `classifyEventRelation` implementations. The module owns only the adapter, fixture transport, and its UI.

## Run and test

```bash
npm run studio:module -- news-intelligence
npm run test:module -- news-intelligence
```

Fixture mode runs the T08/T09 algorithms with deterministic synthetic model responses. Its Node runner blocks every outbound request and reports the number of synthetic responses. This exercises parsing, evidence handling, T09 candidate ranking, decisions, and uncertainty branches; it does not measure model accuracy or call an AI provider. To test T09 with candidates, paste a JSON array into the candidate field, for example:

```json
[{"newsId":"sample-1","title":"Событие из архива","content":"Текст публикации","publicationDate":"2026-10-21","contentStatus":"excerpt"}]
```

T09 uses the real local vectorizer to order these candidates. The prepared relation response is `UNSURE`, so it remains in manual review. In the fixture runner, an empty event archive deterministically returns `DIFFERENT` / `CREATE_NEW_EVENT`.

`Local Data` runs T09 against the processed local archive without an AI call. It shows only candidates with non-zero lexical overlap from the local hash-TFIDF vectorizer; this is candidate retrieval, not a semantic decision. An empty local result means no lexical candidate was retrieved, not `DIFFERENT` or a proven absence of an event relationship. `External AI` manually runs the existing T08/T09 implementation with the approved Polza model; the submitted publication and selected archive candidates are sent to the provider. The mode requires server opt-in, an API key, and an approved model. Merely opening the page does not make a request. Fixture mode stays synthetic and blocks outbound requests.

## Provider reliability and resume

T08 launches independent classification branches concurrently; Studio serializes the actual provider requests to account for spending after each response. `shared/backend/polza_transport.mjs` passes a lazy timeout to a request-scoped transport. The timer starts when the scheduler acquires the network slot and remains active through the entire response body. The total runner deadline is 270 s, its Python supervisor 300 s, and the browser 315 s.

Polza receives `reasoning: { effort: "none" }`. Top-level `reasoning_effort` is not read by Polza; merely hiding reasoning does not disable billed reasoning tokens. The approved model list and the classifier/evidence algorithms are unchanged.

Successful real, JSON-complete provider responses are reused for 24 hours from `output/provider-cache/news-intelligence/` (ignored by Git). Keys include the endpoint, model, full request and hashed account scope. These are saved provider responses, not fixtures; UI shows new calls, cache hits and the cost of the current run separately. `cache.originalUsage` preserves the original billing metadata. Do not publish this local cache: model responses may contain private input text.

An atomic pending marker prevents the same request being billed concurrently by two runners. A timeout leaves its payment uncertain: a manual retry reuses successful stages, but stops before sending that uncertain request again. The form's explicit "Оплата проверена — разрешить повтор" option enables retry only after billing has been reviewed. Already active requests cannot be overridden by this option.

Billing is checkpointed before and after each request. If Python interrupts the process, confirmed spending remains available; only the interrupted request is unknown. Usage supports the documented `cost_rub` / `cost` fields. Cost thresholds remain post-response checks, not guaranteed provider-side caps.

Tests cover queue wait versus network timeout, stalled body reads, preserved known spending, cached real-response replay, uncertain-payment retry protection, concurrent duplicates and cancellation of queued work after a fatal classification error. With `LOG_LEVEL=debug`, `[FIX:T08]` emits counts, cost and duration only, never prompts or keys.
