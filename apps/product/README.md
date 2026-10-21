# Alfa Insight Product

The end-user route is exposed by `ProductApp.tsx` and delegates to the canonical client in `modules/09-alfa-product/frontend/product/`, served at `/` and `/product`. `src/insight/*` remains a thin compatibility facade. Studio embeds a separate integration module at `/studio/alfa-product` without exposing developer controls to the customer route.
