import { ModuleWorkbench, type ModuleSpec } from '../../../shared/frontend/ModuleWorkbench'
import { ResultList, ResultMetrics, ResultSection, ResultTag, ResultTextList, asRows, resultText } from '../../../shared/frontend/ModuleResult'

function renderResult(data: Record<string, any>) {
  const t08 = data.t08Classification || {}
  const classifications = t08.classifications || {}
  const entities = asRows(classifications.entities?.entities)
  const events = asRows(classifications.entities?.events)
  const relations = asRows(classifications.entities?.relations)
  const evidence = asRows(data.t08Classification?.evidenceReview?.items)
  const eventMatch = data.t09EventMatching || {}
  const decision = eventMatch.decision || {}
  const comparisons = asRows(eventMatch.comparisons || data.t09LocalMatches)
  const transport = data.fixtureTransport || {}
  const liveUsage = data.providerUsage || {}
  const live = data.provenance?.kind === 'Polza AI, manual run'
  const local = data.provenance?.kind === 'local T09 embedding and archive search'
  const classificationReady = Boolean(t08.classifications)

  return <>
    <div className="module-result-inline-note" role="status">
      {live ? `Реальный ручной запуск через Polza AI (${liveUsage.model || 'модель не указана'}). Вызовов: ${liveUsage.modelCalls || 0}; стоимость: ${liveUsage.costReported ? `${liveUsage.costRub} ₽` : 'провайдер не сообщил'} при лимите ${liveUsage.budgetRub} ₽.` : local ? 'Локальный режим: T09 выполнил векторный поиск в архиве без AI. Классификация T08 в этом режиме не запускалась.' : 'Fixture-запуск: выполнены алгоритмы T08/T09, ответы модели синтетические, сетевые вызовы заблокированы. Эти результаты проверяют поток, но не качество модели.'}
    </div>
    <ResultMetrics items={[
      { label: 'T08', value: classificationReady ? 'Классификация выполнена' : data.t08Status === 'requires_external_ai' ? 'Нужен ручной AI-запуск' : 'Нужен текст от 20 символов' },
      { label: 'Главная тема', value: t08.topic?.label },
      { label: 'Событие SENTiVENT', value: classifications.event?.value?.label },
      { label: 'Жанр публикации', value: classifications.genre?.value?.label },
      { label: 'Извлечённые сущности', value: entities.length },
      { label: 'T09: отношение', value: decision.relation || '—' },
      { label: 'Решение T09', value: decision.resolution || '—' },
      { label: live ? 'Вызовы Polza AI' : local ? 'Внешние AI-вызовы' : 'Ответы модели в фикстуре', value: live ? liveUsage.modelCalls ?? 0 : local ? 0 : transport.syntheticModelResponses ?? 0 },
      { label: live ? 'Стоимость' : 'Внешние запросы', value: live ? `${liveUsage.costRub ?? 'неизвестна'} ₽` : transport.externalNetworkCalls ?? 0 },
    ]} />

    {classificationReady && <>
      <ResultSection title="T08 · классификация публикации">
        <div className="module-result-card">
          <h4>Основная тема</h4>
          <p>{resultText(t08.topic?.label)} <span className="module-result-muted">({resultText(t08.topic?.qcode)})</span></p>
          <p>Путь: {resultText((t08.path || []).map((item: any) => item.label).join(' → '))}</p>
          <h4>Тип делового события</h4>
          <p>{resultText(classifications.event?.value?.label)} <span className="module-result-muted">({resultText(classifications.event?.event_type)})</span></p>
          <p>Цитата для проверки: «{resultText(classifications.event?.evidence_text, 'не найдена')}»</p>
          <p>Дословная цитата прошла проверку: {classifications.event?.evidence_verified ? 'да' : 'нет'}; оценка поддержки: {resultText(classifications.event?.support_score)}</p>
          <h4>Редакционный жанр</h4>
          <p>{resultText(classifications.genre?.value?.label)}</p>
          <p>Охват источника: {resultText(t08.source?.evidenceScope)}</p>
        </div>
      </ResultSection>

      <ResultSection title="Сущности, события и связи">
        <ResultList items={entities} empty="В тексте не выделены сущности." renderItem={item => <article className="module-result-card">
          <div className="module-result-card-top"><h4>{resultText(item.name)}</h4><ResultTag>{resultText(item.type)}</ResultTag></div>
          <p>Цитата: «{resultText(item.evidence, 'не указана')}»</p>
          <p>Происхождение: {resultText(item.source)} · связь с реестром: {resultText(item.link_status)}</p>
        </article>} />
        {events.map((item: any) => <article className="module-result-card" key={item.event_id}>
          <h4>{resultText(item.label || item.type)}</h4><p>Событие: «{resultText(item.evidence)}»</p>
          {asRows(item.attributes).length > 0 && <p>Факты: {asRows(item.attributes).map((fact: any) => `${fact.type}: ${fact.normalized_value || fact.mention}`).join(' · ')}</p>}
          {asRows(item.participants).length > 0 && <p>Участники: {asRows(item.participants).map((participant: any) => `${entities.find(entity => entity.id === participant.entity_id)?.name || participant.entity_id} — ${participant.role}`).join(' · ')}</p>}
        </article>)}
        {relations.length > 0 && <div className="module-result-card"><h4>Явные отношения</h4><ResultTextList items={relations.map(item => `${entities.find(entity => entity.id === item.subject_id)?.name || item.subject_id} — ${item.label || item.predicate} → ${entities.find(entity => entity.id === item.object_id)?.name || item.object_id}; доказательство: «${item.evidence}»`)} /></div>}
      </ResultSection>

      <ResultSection title="Проверка цитат и фактов">
        <ResultList items={evidence} empty="Нет отдельных утверждений, требующих смысловой проверки." renderItem={item => <article className="module-result-card">
          <div className="module-result-card-top"><h4>{resultText(item.kind)} · {resultText(item.status)}</h4><ResultTag tone={item.status === 'supported' ? 'good' : item.status === 'unsupported' ? 'warn' : 'neutral'}>{item.quoteExact ? 'цитата найдена дословно' : 'цитата не подтверждена'}</ResultTag></div>
          <p>Утверждение: {resultText(item.assertion || item.candidateId)}</p><p>Причина: {resultText(item.reason)}</p>
        </article>} />
        {t08.evidenceReview?.status && <p>Статус смысловой проверки: {t08.evidenceReview.status} · модельный этап в этой фикстуре не заменяет независимую экспертизу.</p>}
      </ResultSection>
    </>}

    {data.t09Embedding && <ResultSection title="T09 · локальный поиск похожих текстов">
      <p>Локальная модель: {resultText(data.t09Embedding.model)} · размерность {resultText(data.t09Embedding.dimensions)} · ненулевых признаков {resultText(data.t09Embedding.nonZeroDimensions)}.</p>
      <ResultList items={comparisons} empty={local
        ? 'В архиве не найдено записей с ненулевым лексическим сходством. Это не вердикт о связи событий.'
        : 'Кандидатов для сравнения нет; связь событий не оценена.'} renderItem={item => <article className="module-result-card">
        <div className="module-result-card-top"><h4>{resultText(item.title || item.candidate?.title)}</h4><ResultTag>{resultText(item.relation, local ? 'лексический кандидат' : 'связь не оценена')}</ResultTag></div>
        <p>Лексическое сходство: {Number(item.similarity ?? item.candidate?.similarity ?? 0).toFixed(3)} · уверенность сравнения: {resultText(item.confidence)}</p>
        <p>Архивная запись: {resultText(item.candidateId || item.newsId)} · дата: {resultText(item.publicationDate)}</p>
      </article>} />
      {decision.reason && <p>Вывод: {decision.reason}</p>}
      {asRows(decision.fallback?.reasons).length > 0 && <p>Почему оставлено на ручную проверку: {decision.fallback.reasons.join('; ')}.</p>}
    </ResultSection>}
    <details className="module-details"><summary>Ответы алгоритма и контрактный результат</summary><pre>{JSON.stringify({ t08: data.t08Classification, t09: data.t09EventMatching, fixtureTransport: data.fixtureTransport }, null, 2)}</pre></details>
  </>
}

export const moduleSpec: ModuleSpec = {
  id: 'news-intelligence',
  title: 'News Intelligence · T08/T09',
  summary: 'Разберите классификацию новости, извлечённые факты и проверку связи с архивными событиями.',
  purpose: 'Вставьте текст публикации. В External AI T08 использует разрешённые модели для классификации. T09 сравнивает событие с указанными кандидатами или, если список пуст, с локальным архивом.',
  fields: [
    { name: 'text', label: 'Текст публикации', kind: 'text', rows: 8, minLength: 20, placeholder: 'Вставьте текст новости (не менее 20 символов)…' },
    { name: 'title', label: 'Заголовок публикации (необязательно)', externalOnly: true },
    { name: 'date', label: 'Дата публикации (необязательно)', externalOnly: true },
    { name: 'content_status', label: 'Полнота текста', kind: 'select', initial: 'excerpt', options: [
      { value: 'full', label: 'Полный текст' }, { value: 'excerpt', label: 'RSS-выдержка' }, { value: 'missing', label: 'Текст источника отсутствует' },
    ] },
    { name: 't09_candidates', label: 'Кандидаты событий T09 (JSON)', kind: 'json', rows: 7, placeholder: '[]' },
    { name: 'max_cost_rub', label: 'Лимит стоимости (₽, максимум 5)', kind: 'number', initial: '1', min: 0.05, max: 5, externalOnly: true },
  ],
  highlights: [],
  renderResult,
  externalAi: true,
  externalAiScope: 'текст и заголовок публикации, а также до десяти кандидатов T09 из формы; если список пуст — до десяти кандидатов из локального архива',
  preferredMode: 'external_ai',
  localData: true,
  localFields: ['text', 'content_status', 't09_candidates'],
  productLink: false,
}

export default function ModulePage() { return <ModuleWorkbench spec={moduleSpec} /> }

