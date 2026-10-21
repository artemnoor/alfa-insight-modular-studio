# Alfa Insight Product

The end-user route is exposed by `ProductApp.tsx` and delegates to the existing React application in `src/insight/InsightApp.tsx`, served at `/` and `/product`. Studio embeds a separate integration module at `/studio/alfa-product` without exposing developer controls to the customer route.
