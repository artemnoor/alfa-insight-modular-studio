# Альфа Инсайт

Персональная лента деловых событий и AI-объяснения их возможной связи с профилем компании.

## Быстрый запуск

Требуются Node.js 22 или новее и Python 3.11 или новее.

~~~powershell
npm ci
python -m venv .venv
.venv\\Scripts\\Activate.ps1
python -m pip install -r drive_data_analysis_2026-10-20/requirements_stage3.txt
Copy-Item .env.example .env
npm run dev
~~~

Подробные инструкции и тестовые команды находятся в RUN.md. В репозитории нет клиентских банковских данных и архива публикаций. Для работы с собственными разрешёнными данными подключите локальный архив отдельно и не добавляйте его в Git.

AI-запросы по умолчанию выключены. Не включайте внешние модели с клиентскими данными без надлежащего разрешения.

## Внутренняя разработка модулей

Studio доступна на `/studio` и содержит девять изолированных рабочих пространств. Запуск: `npm run studio`. Команды модулей, тесты и режимы данных описаны в [STUDIO_RUN.md](STUDIO_RUN.md). См. также [ARCHITECTURE.md](ARCHITECTURE.md), [MODULES.md](MODULES.md), [MIGRATION_REPORT.md](MIGRATION_REPORT.md), [MODULE_TEST_REPORT.md](MODULE_TEST_REPORT.md) и [REMAINING_ISSUES.md](REMAINING_ISSUES.md).
# Alfa Insight Studio

The existing Alfa Insight customer application remains at `/`. The internal development portal with nine isolated module workspaces is at `/studio`.

Start locally with `npm run studio`; see [STUDIO_RUN.md](STUDIO_RUN.md) for module-specific commands and tests. Architecture, adapters, contracts and current limitations are described in [ARCHITECTURE.md](ARCHITECTURE.md), [MODULES.md](MODULES.md) and [REMAINING_ISSUES.md](REMAINING_ISSUES.md).
