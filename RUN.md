# Локальный запуск

Studio, девять модулей, переключение `Fixture / Local Data`, команды изолированного запуска и E2E описаны в [STUDIO_RUN.md](STUDIO_RUN.md).

## Основное приложение

Нужны Node.js 22+ и Python 3.11+.

~~~powershell
npm ci
python -m venv .venv
.venv\\Scripts\\Activate.ps1
python -m pip install -r drive_data_analysis_2026-10-20/requirements_stage3.txt
Copy-Item .env.example .env
npm run dev
~~~

npm run dev запускает локальный React-интерфейс и Python API. В тестовой копии нет клиентского архива, базы и секретов. Некоторые разделы поэтому останутся пустыми, пока вы не подключите разрешённые локальные данные.

## Внешние AI-модели

По умолчанию ALFA_ALLOW_EXTERNAL_AI=false. Для локального пользовательского тестирования оставьте это значение выключенным. Внешние модели могут получать содержимое запроса и приложенные контексты; подключайте их только после проверки разрешений, политики обработки данных и стоимости.

Ключи API задавайте только в локальном .env; не коммитьте .env.

## Сервисы разработки

Подробные команды для модулей находятся в backend/T08/README.md, backend/T09/README.md, backend/pipeline/README.md и backend/T10/README.md. Для запуска PostgreSQL см. backend/pipeline/compose.yaml. Секреты и рабочие данные в репозитории отсутствуют.

## Проверки

~~~powershell
npm run build
npm --prefix backend/T08 run test:taxonomy
npm --prefix backend/T08 run test:semantic-evidence
npm --prefix backend/T08 run test:explicit-entities
npm --prefix backend/T09 test
npm --prefix backend/pipeline test
npm --prefix backend/T10 test
python -m unittest discover -s drive_data_analysis_2026-10-20/tests
~~~

Эти команды используют локальные детерминированные тесты; отдельные платные AI-запросы не нужны.
