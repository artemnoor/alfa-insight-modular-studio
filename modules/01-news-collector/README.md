# 01-news-collector

Isolated RSS collection workspace. `Live RSS` fetches the configured public feeds when you select the mode and click the collection button; it does not need an LLM to download and parse RSS. Use News Intelligence for T08/T09 AI classification of collected items. `Fixture` scenarios use synthetic feeds and a temporary SQLite database without contacting the network. Open `/studio/news-collector` or run `npm run test:module -- news-collector`.
