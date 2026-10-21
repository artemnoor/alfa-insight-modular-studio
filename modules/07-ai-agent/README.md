# 07-ai-agent

Isolated workspace for **ai-agent**. Open `/studio/ai-agent` in Studio. Run its fixture suite with `npm run test:module -- ai-agent`. The adapter invokes the existing `run_agent`, including plan revisions, tool policy, source tracking, and cost accounting. Four synthetic scenarios include an adaptive replan; fixture responses are deterministic and cost 0 ₽.

External AI is closed by default. To make the manual `External AI` mode available, set `ALFA_ENABLE_EXTERNAL_AI=1` for the API process and provide an existing provider API key. The configured model must remain in the existing allowlist. External runs accept only the synthetic fixture profile/news, take a 0.05–5 ₽ limit, and require the operator to select the mode and click Run.
