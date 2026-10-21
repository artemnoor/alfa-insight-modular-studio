# 04-personalization

Isolated workspace for **personalization**. Open `/studio/personalization`; fixture scenarios run with `npm run test:module -- personalization`. `Local Data` ranks real local company profiles and processed news with the existing deterministic personalization algorithm. `External AI` sends selected profile fields and the top ranked headlines/factors to Polza for explanations only; AI cannot change the scores, ranking, or order. Provider calls require explicit server opt-in and a manual run.
