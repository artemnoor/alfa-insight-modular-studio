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

T09 uses the real local vectorizer to order these candidates. The prepared relation response is `UNSURE`, so it remains in manual review. An empty candidate list deterministically returns `DIFFERENT` / `CREATE_NEW_EVENT`.

`Local Data` runs T09 against the processed local archive without an AI call. `External AI` manually runs the existing T08/T09 implementation with the approved Polza model; the submitted publication and selected archive candidates are sent to the provider. The mode requires server opt-in, an API key, and an approved model. Merely opening the page does not make a request. Fixture mode stays synthetic and blocks outbound requests.
