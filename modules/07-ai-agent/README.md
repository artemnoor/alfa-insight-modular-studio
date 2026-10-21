# 07-ai-agent

Isolated workspace for **ai-agent**. Open `/studio/ai-agent` in Studio. Run its fixture suite with `npm run test:module -- ai-agent`. The adapter invokes the existing `run_agent`, including plan revisions, tool policy, source tracking, and cost accounting. Four synthetic scenarios include an adaptive replan; fixture responses are deterministic and cost 0 ₽.

`Local Data` loads a real company profile and processed news event without calling AI. `External AI` runs the existing orchestrator against these selected local inputs, with its real tool calls, plan history, source tracking, and cost accounting. The selected profile, event, related processed events, and any available business network may be sent to Polza. It requires an explicit server opt-in, configured key, and model in the existing allowlist. Each run has a 0.05–5 ₽ cap and starts only after the operator selects the mode and clicks Run; opening the module does not trigger a request.
