import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, ResultTextList, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const plans = asRows(data.planHistory)
  const latestPlan = plans[plans.length - 1] || {}
  const plannedTools = Array.isArray(latestPlan.selected_tools) ? latestPlan.selected_tools : Array.isArray(data.plannedTools) ? data.plannedTools : []
  const calls = asRows(data.toolCalls)
  const called = new Set(calls.map(call => call.tool))
  const notExecuted = plannedTools.filter((tool: unknown) => !called.has(tool))
  const analysis = data.analysis || {}
  const usage = data.tokenUsage || {}
  const tokens = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)
  return <>
    <ResultMetrics items={[{ label: 'Статус запуска', value: data.executionStatus }, { label: 'Статус вывода', value: data.status }, { label: 'Вызовов исследовательских инструментов', value: calls.length }, { label: 'Стоимость', value: `${resultText(data.costRub, 'Не сообщена')} ₽` }, { label: data.provenance?.kind === 'external AI on synthetic fixture' ? 'Токены провайдера' : 'Токены фикстуры', value: tokens }, ...(data.budgetRub ? [{ label: 'Лимит стоимости', value: `${data.budgetRub} ₽` }] : [])]} />
    <ResultSection title="План исследования"><ResultList items={plans} empty="Агент не зарегистрировал план." renderItem={(plan,index) => <article className="module-result-card"><div className="module-result-card-top"><h4>Версия {resultText(plan.version, String(index + 1))} · {resultText(plan.goal, 'Цель не указана')}</h4><ResultTag>{resultText(plan.status, 'план')}</ResultTag></div><p>Известно: {resultText(plan.known_facts, 'нет перечисленных фактов')}</p><p>Вопросы: {resultText(plan.questions, 'нет дополнительных вопросов')}</p><div className="module-result-tags">{(Array.isArray(plan.selected_tools) ? plan.selected_tools : []).map((tool: unknown,i:number)=><ResultTag key={i}>{resultText(tool)}</ResultTag>)}</div></article>} /></ResultSection>
    <ResultSection title="Планировал проверить и фактически проверил"><div className="module-result-columns"><div className="module-result-column"><h4>Запланировано</h4><ResultTextList items={plannedTools} empty="Инструменты не были выбраны планом." /></div><div className="module-result-column"><h4>Вызвано</h4><ResultTextList items={[...called]} empty="Инструменты не вызывались." /><h4>Не выполнено из плана</h4><ResultTextList items={notExecuted} empty="Все выбранные инструменты были вызваны." /></div></div></ResultSection>
    <ResultSection title="Статус каждого шага плана"><ResultList items={data.planSteps} empty="Шаги плана не зарегистрированы." renderItem={step => <article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(step.tool, 'Шаг исследования')}</h4><ResultTag tone={step.status === 'completed' ? 'good' : step.status === 'skipped' || step.status === 'failed' ? 'warn' : 'neutral'}>{step.status === 'skipped' ? 'Пропущено по плану' : resultText(step.status)}</ResultTag></div><p>{resultText(step.reason, 'Шаг выполнен без дополнительного пояснения.')}</p></article>} /></ResultSection>
    <ResultSection title="Фактические вызовы и ответы"><ResultList items={calls} empty="Фактических вызовов исследовательских инструментов нет." renderItem={call => <article className="module-result-card module-result-agent-call"><div className="module-result-card-top"><h4>{resultText(call.tool)}</h4><div className="module-result-tags"><ResultTag tone={call.status === 'ok' || call.status === 'success' ? 'good' : call.status === 'skipped' ? 'warn' : 'neutral'}>{resultText(call.status)}</ResultTag><ResultTag>{resultText(call.durationSeconds, '—')} сек</ResultTag></div></div><details><summary>Аргументы и результат инструмента</summary><strong>Аргументы</strong><pre>{JSON.stringify(call.arguments ?? {},null,2)}</pre><strong>Результат</strong><pre>{JSON.stringify(call.result ?? {},null,2)}</pre></details></article>} /></ResultSection>
    <ResultSection title="Итог исследования"><article className="module-result-card"><div className="module-result-card-top"><h4>{resultText(analysis.what_happened || analysis.summary, 'Вывод не сформирован.')}</h4><ResultTag tone={data.status === 'complete' ? 'good' : 'warn'}>{resultText(data.status, 'unclear')}</ResultTag></div><p>{resultText(analysis.why_it_matters, 'Связь с профилем остаётся неясной.')}</p><h4>Что делать</h4><ResultTextList items={analysis.actions} /><h4>Каких данных не хватает</h4><ResultTextList items={analysis.missing_data} /></article></ResultSection>
    <ResultSection title="Источники, использованные в ответе"><ResultList items={analysis.sources} empty="Оркестратор не зарегистрировал источники в этом запуске." renderItem={source => <article className="module-result-card"><h4>{resultText(source.title, source.source_id)}</h4><p>{resultText(source.kind, 'Источник')} · {resultText(source.source_id)}</p>{source.url && <p><a href={source.url} target="_blank" rel="noreferrer">Открыть источник ↗</a></p>}</article>} /></ResultSection>
    <p className="module-result-inline-note">{data.provenance?.kind === 'external AI on synthetic fixture' ? `Ответ получен от разрешённой модели ${resultText(data.model)} на синтетическом профиле и фикстурной новости. Фактическая стоимость ${resultText(data.costRub, 'не сообщена')} ₽ при установленном лимите ${resultText(data.budgetRub)} ₽.` : 'Этот запуск использовал deterministic ответы модели из фикстуры: внешних AI-вызовов и тарифицируемых токенов не было. Инструменты агента исполнялись локально.'}</p>
  </>
}

export const moduleSpec = {
  "id": "ai-agent",
  "title": "AI Agent Studio",
  "summary": "Исследуйте версии плана, статусы шагов и реальные вызовы инструментов. Fixture бесплатен; внешний запуск требует явного opt-in.",
  "purpose": "Существующий run_agent на синтетических данных с фиксированными ответами или вручную разрешённой моделью.",
  "fields": [
    {
      "name": "question",
      "label": "Дополнительный вопрос",
      "initial": "Какие данные подтверждают возможный канал через кредитование?",
      "placeholder": "Вопрос к исследованию",
      "rows": 3
    },
    {
      "name": "max_cost_rub",
      "label": "Лимит стоимости (₽, максимум 5)",
      "kind": "number",
      "initial": "1",
      "min": 0.05,
      "max": 5,
      "externalOnly": true
    }
  ],
  "highlights": [
    {
      "label": "Исполнение плана",
      "path": "executionStatus"
    },
    {
      "label": "Статус вывода",
      "path": "status"
    },
    {
      "label": "Запланированные инструменты",
      "path": "plannedTools"
    },
    {
      "label": "Реально вызванные инструменты",
      "path": "toolCalls"
    },
    {
      "label": "Стоимость фикстуры",
      "path": "costRub"
    }
  ],
  renderResult,
  "externalAi": true,
  "localData": false,
  "productLink": false
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec as ModuleSpec} /> }

