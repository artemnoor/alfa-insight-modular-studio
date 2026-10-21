# 03-business-intelligence

Изолированное рабочее пространство Business Intelligence. Маршрут: `/studio/business-intelligence`; тесты: `npm run test:module -- business-intelligence`. `Fixture` строит граф на временных CSV/SQLite. `Local Data` читает профили, person links и payment CSV из `ALFA_INSIGHT_DATA_ROOT`; производный `business_network.sqlite` создаётся в локальном `data/` текущего клона. Исходные файлы не меняются. Платёжный поток не доказывает поставку, а общий GROUP_ID — корпоративный контроль.
