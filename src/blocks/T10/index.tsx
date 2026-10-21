import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@alfalab/core-components/button'
import { Input } from '@alfalab/core-components/input'
import { Textarea } from '@alfalab/core-components/textarea'
import './styles.css'

const api = import.meta.env.VITE_T10_API_BASE || 'http://127.0.0.1:8095'
const entityTypes = ['PRODUCT','SERVICE','COMPONENT','FACILITY','RESOURCE','PROCESS','CONTRACT','LOCATION','PERSON','TECHNOLOGY']
const predicates = ['PRODUCES','PROVIDES_SERVICE','SUPPLIES','PURCHASES','OWNS','OPERATES','USES','REQUIRES','LOCATED_IN','PART_OF','CONTRACTED_WITH','DEPENDS_ON']

type Profile = { profile_id: string; profile_name: string; legal_name: string; inn: string | null; ogrn: string | null; website: string | null; identity_status: string }
type Source = { source_id: string; title: string; source_type: string; url: string | null; access_level: string; source_status: string; retrieved_at: string; duplicate?: boolean }
type Evidence = { sourceId: string; sourceTitle: string; sourceType: string; accessLevel: string; quote: string; quoteMatchesSource: boolean; factValidation: string }
type Claim = { claim_id: string; predicate: string; claim_status: string; subject_name: string; object_name: string | null; object_value: unknown; evidence: Evidence[] }
type GraphNode = { id: string; type: string; name: string; resolutionStatus: string }
type Graph = { nodes: GraphNode[]; edges: Array<{ id: string; source: string; target: string | null; type: string; status: string; value: unknown; evidence: Evidence[] }> }
type EnrichmentCandidate = { chunkId:string; sourceTitle:string; similarity?:number; match?:string; excerpt:string }
type RunStage = { blockId: string; status: string; errors?: Array<{ code?:string; message?:string }>; error?: string | null; output?: { attempts?: Array<{ gapId:string; sourceType:string; status:string; candidates?:EnrichmentCandidate[]; requiresVerification?:boolean }> } }
type Gap = { gap_id: string; missing_fact: string; rationale: string; priority: number; question: string; status: string; related_entity_name: string | null; answers?:Array<{answerId:string;answerText:string;answerStatus:string}> }
type Entity = { entity_id: string; entity_type: string; canonical_name: string; resolution_status: string; canonical_entity_id?:string|null; canonical_entity_name?:string|null; mentions: Array<{ sourceTitle:string; quote:string }> }
type RunHistory = { run_id:string; run_number:number; status:string; started_at:string; input_tokens?:number; output_tokens?:number; reported_cost_rub?:string; blocks:Array<{blockId:string;status:string;error?:string|null}> }

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Ошибка API T10 (${response.status})`)
  return result as T
}

function base64(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes); let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

function accessName(value: string) { return ({ public: 'Публичный', customer_internal: 'Данные клиента', confidential: 'Конфиденциальный' } as Record<string,string>)[value] ?? value }

function uniqueEnrichmentCandidates(attempts: NonNullable<RunStage['output']>['attempts'] = []) {
  const candidates = new Map<string, EnrichmentCandidate>()
  for (const candidate of attempts.flatMap((attempt) => attempt.candidates ?? [])) {
    const previous = candidates.get(candidate.chunkId)
    if (!previous || Number(candidate.similarity ?? 0) > Number(previous.similarity ?? 0)) candidates.set(candidate.chunkId, candidate)
  }
  return [...candidates.values()]
}

export default function T10() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] })
  const [entities, setEntities] = useState<Entity[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  const [runStages, setRunStages] = useState<RunStage[]>([])
  const [runMetrics, setRunMetrics] = useState<Record<string,unknown> | null>(null)
  const [runHistory, setRunHistory] = useState<RunHistory[]>([])
  const [versions, setVersions] = useState<Array<{version:number;created_at:string;profile_json:Record<string,unknown>}>>([])
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [gapAnswers, setGapAnswers] = useState<Record<string,string>>({})
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [inn, setInn] = useState('')
  const [ogrn, setOgrn] = useState('')
  const [website, setWebsite] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceType, setSourceType] = useState('document')
  const [accessLevel, setAccessLevel] = useState('customer_internal')
  const [sourceText, setSourceText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [predicate, setPredicate] = useState('PRODUCES')
  const [objectType, setObjectType] = useState('PRODUCT')
  const [objectName, setObjectName] = useState('')
  const [evidenceText, setEvidenceText] = useState('')
  const [attributes, setAttributes] = useState('{}')

  const refreshProfiles = useCallback(async () => {
    const data = await call<{ profiles: Profile[] }>('/profiles')
    const availableProfiles = data.profiles.filter((item) => !/^T10 live [LR]\d{2} —/u.test(item.profile_name))
    setProfiles(availableProfiles)
    if (profileId && !availableProfiles.some((item) => item.profile_id === profileId)) setProfileId(availableProfiles[0]?.profile_id ?? '')
    else if (!profileId && availableProfiles[0]) setProfileId(availableProfiles[0].profile_id)
  }, [profileId])

  const refreshProfile = useCallback(async (id: string) => {
    const [p,s,c,g,e,d,r,v] = await Promise.all([
      call<{profile:Profile}>(`/profiles/${id}`), call<{sources:Source[]}>(`/profiles/${id}/sources`),
      call<{claims:Claim[]}>(`/profiles/${id}/claims`), call<{graph:Graph}>(`/profiles/${id}/graph`),
      call<{entities:Entity[]}>(`/profiles/${id}/entities`), call<{gaps:Gap[]}>(`/profiles/${id}/gaps`), call<{runs:RunHistory[]}>(`/profiles/${id}/runs`), call<{versions:Array<{version:number;created_at:string;profile_json:Record<string,unknown>}>}>(`/profiles/${id}/versions`),
    ])
    setProfile(p.profile); setSources(s.sources); setClaims(c.claims); setGraph(g.graph); setEntities(e.entities); setGaps(d.gaps); setRunHistory(r.runs); setVersions(v.versions)
    if (r.runs[0]) { setRunStages(r.runs[0].blocks.map((block)=>({...block,errors:block.error?[{message:block.error}]:[]}))); setRunMetrics({inputTokens:r.runs[0].input_tokens,outputTokens:r.runs[0].output_tokens,costRub:r.runs[0].reported_cost_rub}) }
  }, [])

  useEffect(() => {
    let active = true
    void call<{ready:boolean}>('/health').then((result) => { if (active) setReady(result.ready) }).catch(() => { if (active) setReady(false) })
    void refreshProfiles().catch((cause) => { if (active) setError(cause.message || 'API T10 недоступен') })
    return () => { active = false }
  }, [refreshProfiles])

  useEffect(() => {
    if (!profileId) { setProfile(null); setSources([]); setClaims([]); setGraph({nodes:[],edges:[]}); setEntities([]); setGaps([]); setRunStages([]); setRunHistory([]); setVersions([]); return }
    let active = true
    void refreshProfile(profileId).catch((cause) => { if (active) setError(cause.message || 'Не удалось загрузить профиль') })
    return () => { active = false }
  }, [profileId, refreshProfile])

  const createProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const result = await call<{profile:{profileId:string}}>('/profiles','POST',{companyName,inn:inn||null,ogrn:ogrn||null,website:website||null})
      setProfileId(result.profile.profileId); await refreshProfiles()
      setCompanyName(''); setInn(''); setOgrn(''); setWebsite('')
      setNotice('Профиль создан. Введённые ИНН и ОГРН ещё не проверены по реестру.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать профиль') } finally { setBusy(false) }
  }

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!profileId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const body: Record<string,unknown> = { title:sourceTitle||file?.name||sourceUrl||'Источник без названия',sourceType,accessLevel,url:sourceUrl||null }
      if (file) {
        if (file.size > 20*1024*1024) throw new Error('Файл больше 20 МБ')
        body.contentType=file.type||'application/octet-stream'; body.contentBase64=base64(await file.arrayBuffer())
      } else if (sourceText.trim()) {
        body.contentText=sourceText; body.contentType=sourceTitle.toLowerCase().endsWith('.json')?'application/json':'text/plain; charset=utf-8'
      } else if (!sourceUrl) throw new Error('Добавьте ссылку, текст или файл')
      const result=await call<{source:Source}>(`/profiles/${profileId}/sources`,'POST',body)
      await refreshProfile(profileId); setSourceTitle(''); setSourceUrl(''); setSourceText(''); setFile(null)
      setNotice(result.source.duplicate?'Этот документ уже сохранён в профиле.':'Источник сохранён. Его содержимое ещё не считается обработанным или подтверждённым.')
    } catch (cause) { setError(cause instanceof Error?cause.message:'Не удалось сохранить источник') } finally { setBusy(false) }
  }

  const addFact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!profileId||!profile) return
    setBusy(true); setError(''); setNotice('')
    try {
      const parsed=JSON.parse(attributes)
      if (!parsed||Array.isArray(parsed)||typeof parsed!=='object') throw new Error('Атрибуты должны быть JSON-объектом')
      await call(`/profiles/${profileId}/known-facts`,'POST',{subject:{type:'COMPANY',name:profile.legal_name},predicate,object:{type:objectType,name:objectName},attributes:parsed,evidenceText})
      await refreshProfile(profileId); setObjectName(''); setEvidenceText(''); setAttributes('{}')
      setNotice('Факт записан как SUPPORTED: цитата сохранена, независимая проверка ещё не выполнялась.')
    } catch (cause) { setError(cause instanceof Error?cause.message:'Не удалось сохранить факт') } finally { setBusy(false) }
  }

  const runPipeline = async () => {
    if (!profileId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await call<{run:{status:string};stages:RunStage[];metrics:Record<string,unknown>}>(`/profiles/${profileId}/runs`,'POST',{config:{trigger:'manual'}})
      setRunStages(result.stages); setRunMetrics(result.metrics); await refreshProfile(profileId)
      setNotice(`Обработка завершена со статусом ${result.run.status}. Состояния и стоимость сохранены в истории запусков.`)
    } catch (cause) { setError(cause instanceof Error?cause.message:'Не удалось выполнить обработку') } finally { setBusy(false) }
  }

  const answerGap = async (gapId:string) => {
    const answerText = gapAnswers[gapId]?.trim()
    if (!answerText) return
    setBusy(true); setError(''); setNotice('')
    try {
      await call(`/profiles/${profileId}/gaps/${gapId}/answers`,'POST',{answerText})
      await refreshProfile(profileId); setGapAnswers((current)=>({...current,[gapId]:''}))
      setNotice('Ответ сохранён как пользовательский источник. Он не подтверждён до следующего запуска обработки.')
    } catch (cause) { setError(cause instanceof Error?cause.message:'Не удалось сохранить ответ') } finally { setBusy(false) }
  }

  const exportLatestProfile = () => {
    const latest = versions[0]
    if (!latest) return
    const blob = new Blob([JSON.stringify(latest.profile_json, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `t10-business-profile-v${latest.version}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const inspectGraphNode = (node: GraphNode) => {
    const entity = entities.find((item) => item.entity_id === node.id)
    setSelectedEntity(entity ?? {
      entity_id:node.id, entity_type:node.type, canonical_name:node.name, resolution_status:node.resolutionStatus,
      canonical_entity_id:null, canonical_entity_name:null, mentions:[],
    })
  }

  return <main className="content t10-page">
    <header className="t10-heading"><div><span className="eyebrow">T10 · BUSINESS UNDERSTANDING</span><h1>Профиль бизнеса</h1><p>Сведения о компании, их источники и границы подтверждения.</p></div><div className="t10-heading-actions"><span className={`t10-health ${ready?'is-ready':''}`}>{ready?'PostgreSQL · T10 готов':'API T10 недоступен'}</span>{profile&&<Button view="primary" size={48} disabled={busy||!ready} onClick={()=>void runPipeline()}>{busy?'Обрабатываем…':'Обработать профиль'}</Button>}</div></header>
    {error&&<p className="t10-message t10-error" role="alert">{error}</p>}{notice&&<p className="t10-message t10-notice" role="status">{notice}</p>}

    <section className="t10-panel"><div className="t10-panel-title"><div><span>01</span><div><h2>Компания</h2><p>Профиль хранится отдельно от этапов новостной классификации.</p></div></div>{profiles.length>0&&<label>Открыть профиль<select value={profileId} onChange={(event)=>setProfileId(event.currentTarget.value)}>{profiles.map((item)=><option key={item.profile_id} value={item.profile_id}>{item.profile_name} · {item.inn||'без ИНН'}</option>)}</select></label>}</div>
      <form className="t10-grid" onSubmit={(event)=>void createProfile(event)}><Input label="Название компании" labelView="outer" value={companyName} onChange={(_,p)=>setCompanyName(p.value)} block maxLength={300} required/><Input label="ИНН" labelView="outer" value={inn} onChange={(_,p)=>setInn(p.value)} block maxLength={20}/><Input label="ОГРН / ОГРНИП" labelView="outer" value={ogrn} onChange={(_,p)=>setOgrn(p.value)} block maxLength={20}/><Input label="Сайт" labelView="outer" value={website} onChange={(_,p)=>setWebsite(p.value)} block placeholder="example.ru"/><div className="t10-action"><Button view="primary" size={48} type="submit" disabled={busy||!ready}>{busy?'Сохраняем…':'Создать профиль'}</Button></div></form>
      {profile&&<p className="t10-identity">{profile.legal_name} · {profile.identity_status==='identifier_provided'?'идентификатор введён, но ещё не проверен':'название без подтверждённой идентификации'}</p>}
    </section>

    {profile&&<>
      <section className="t10-panel"><div className="t10-panel-title"><div><span>02</span><div><h2>Источники</h2><p>Принимаются текст, JSON, PDF и URL; загрузка не считается извлечением фактов.</p></div></div><small>{sources.length} источников</small></div>
        <form className="t10-form" onSubmit={(event)=>void addSource(event)}><div className="t10-grid t10-source-grid"><Input label="Название источника" labelView="outer" value={sourceTitle} onChange={(_,p)=>setSourceTitle(p.value)} block placeholder="Годовой отчёт"/><label className="t10-native"><span>Тип источника</span><select value={sourceType} onChange={(e)=>setSourceType(e.currentTarget.value)}><option value="document">Документ компании</option><option value="annual_report">Годовой отчёт</option><option value="catalog">Каталог</option><option value="company_website">Сайт компании</option><option value="official_registry">Официальный реестр</option><option value="public_source">Другой публичный источник</option><option value="internal_system">Внутренняя система</option></select></label><label className="t10-native"><span>Уровень доступа</span><select value={accessLevel} onChange={(e)=>setAccessLevel(e.currentTarget.value)}><option value="customer_internal">Данные клиента</option><option value="confidential">Конфиденциальный</option><option value="public">Публичный</option></select></label></div>
          <Input label="URL (необязательно)" labelView="outer" value={sourceUrl} onChange={(_,p)=>setSourceUrl(p.value)} block placeholder="https://…"/><Textarea label="Текст источника (необязательно)" labelView="outer" value={sourceText} onChange={(_,p)=>setSourceText(p.value)} block minRows={3} maxRows={8} autosize maxLength={200000}/><label className="t10-file"><span>Файл TXT, JSON или PDF · до 20 МБ</span><input type="file" accept=".txt,.json,.pdf,text/plain,application/json,application/pdf" onChange={(e)=>setFile(e.currentTarget.files?.[0]??null)}/></label>{file&&<small>{file.name} · {(file.size/1024).toFixed(0)} КБ</small>}<div className="t10-action"><Button view="primary" size={48} type="submit" disabled={busy}>{busy?'Сохраняем…':'Добавить источник'}</Button></div></form>
        <div className="t10-source-list">{sources.length===0?<p className="t10-empty">Источников пока нет.</p>:sources.map((item)=><article key={item.source_id}><div><b>{item.title}</b><span>{item.source_type} · {accessName(item.access_level)} · {new Date(item.retrieved_at).toLocaleString('ru-RU')}</span>{item.url&&<a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}</div><small className={`t10-badge t10-${item.source_status}`}>{item.source_status==='available'?'сохранён':item.source_status==='queued'?'ожидает обработки':item.source_status}</small></article>)}</div>
      </section>

      <section className="t10-panel"><div className="t10-panel-title"><div><span>03</span><div><h2>Известный факт</h2><p>Ввод вручную создаёт утверждение с точной цитатой и происхождением.</p></div></div></div>
        <form className="t10-form" onSubmit={(event)=>void addFact(event)}><div className="t10-grid t10-fact-grid"><div className="t10-company"><small>КОМПАНИЯ</small><b>{profile.legal_name}</b></div><label className="t10-native"><span>Связь</span><select value={predicate} onChange={(e)=>setPredicate(e.currentTarget.value)}>{predicates.map((value)=><option key={value}>{value}</option>)}</select></label><label className="t10-native"><span>Тип объекта</span><select value={objectType} onChange={(e)=>setObjectType(e.currentTarget.value)}>{entityTypes.map((value)=><option key={value}>{value}</option>)}</select></label><Input label="Объект" labelView="outer" value={objectName} onChange={(_,p)=>setObjectName(p.value)} block required placeholder="Промышленные насосы"/></div><Textarea label="Цитата или пользовательское утверждение" labelView="outer" value={evidenceText} onChange={(_,p)=>setEvidenceText(p.value)} block minRows={3} maxRows={7} autosize required maxLength={20000}/><Textarea label="Атрибуты связи (JSON)" labelView="outer" value={attributes} onChange={(_,p)=>setAttributes(p.value)} block minRows={2} maxRows={4} autosize/><div className="t10-fact-footer"><p>Статус будет <code>SUPPORTED</code>: текст введён пользователем; независимая проверка факта не выполнялась.</p><Button view="primary" size={48} type="submit" disabled={busy}>{busy?'Сохраняем…':'Сохранить факт'}</Button></div></form>
      </section>

      <section className="t10-panel"><div className="t10-panel-title"><div><span>04</span><div><h2>Граф и происхождение</h2><p>Откройте доказательство у связи, чтобы увидеть цитату и уровень доступа.</p></div></div><small>{graph.nodes.length} узлов · {graph.edges.length} связей</small></div>
        {graph.edges.length===0?<p className="t10-empty">Связей пока нет.</p>:<div className="t10-edges">{graph.edges.map((edge)=>{const left=graph.nodes.find(n=>n.id===edge.source);const right=graph.nodes.find(n=>n.id===edge.target);return <article key={edge.id}><div className="t10-graph-row"><button type="button" className="t10-graph-node" onClick={()=>left&&inspectGraphNode(left)} disabled={!left}><small>{left?.type??'Субъект'}</small><b>{left?.name??'Объект'}</b></button><div className="t10-graph-link"><span>{edge.type}</span><i aria-hidden="true"/><small>{edge.status}</small></div>{right?<button type="button" className="t10-graph-node" onClick={()=>inspectGraphNode(right)}><small>{right.type}</small><b>{right.name}</b></button>:<div className="t10-graph-node is-value"><small>Значение</small><b>{String(edge.value??'—')}</b></div>}</div>{edge.evidence.map((item,index)=><button type="button" className="t10-evidence" key={`${edge.id}-${index}`} onClick={()=>setSelectedEvidence(item)}><span>{item.sourceTitle} · {accessName(item.accessLevel)}</span><q>{item.quote}</q><b>Показать происхождение →</b></button>)}</article>})}</div>}
        {graph.nodes.length>0&&<div className="t10-node-shelf" aria-label="Узлы графа">{graph.nodes.map((node)=><button type="button" key={node.id} onClick={()=>inspectGraphNode(node)}><small>{node.type} · {node.resolutionStatus}</small><b>{node.name}</b></button>)}</div>}
        {claims.length>0&&<details className="t10-history"><summary>Список утверждений ({claims.length})</summary><ul>{claims.map((claim)=><li key={claim.claim_id}>{claim.subject_name} → {claim.predicate} → {claim.object_name??JSON.stringify(claim.object_value)} <b>{claim.claim_status}</b></li>)}</ul></details>}
      </section>
      <section className="t10-panel"><div className="t10-panel-title"><div><span>05</span><div><h2>Сущности и неизвестное</h2><p>Показываются извлечённые объекты, цитаты и открытые вопросы из реального запуска.</p></div></div><small>{entities.length} сущностей · {gaps.filter((gap)=>gap.status==='open').length} пробелов</small></div>
        {runStages.length>0&&<div className="t10-stages"><div className="t10-stage-title"><b>Последний запуск</b><span>{String(runMetrics?.inputTokens??0)} входных · {String(runMetrics?.outputTokens??0)} выходных токенов · {String(runMetrics?.costRub??'0')} ₽</span></div>{runStages.map((stage)=><article key={stage.blockId}><b>{stage.blockId}</b><span>{stage.status}</span>{stage.errors?.[0]?.message&&<small>{stage.errors[0].message}</small>}{stage.blockId==='B10'&&uniqueEnrichmentCandidates(stage.output?.attempts).map((candidate)=><details className="t10-enrichment-candidate" key={candidate.chunkId}><summary>{candidate.sourceTitle} · {candidate.similarity!==undefined?`${Math.round(candidate.similarity*100)}% сходства`:candidate.match==='lexical'?'текстовое совпадение':'кандидат'}</summary><q>{candidate.excerpt}</q><small>Кандидат для ручной проверки; факт не добавлен автоматически.</small></details>)}</article>)}</div>}
        {Boolean(versions[0]?.profile_json.statuses)&&<details className="t10-history"><summary>Статусы профиля</summary><pre>{JSON.stringify(versions[0]?.profile_json.statuses,null,2)}</pre></details>}
        {entities.length>0&&<div className="t10-entity-list">{entities.map((entity)=><button type="button" className="t10-entity-card" key={entity.entity_id} onClick={()=>setSelectedEntity(entity)}><div><small>{entity.entity_type} · {entity.canonical_entity_name?`объединено с ${entity.canonical_entity_name}`:entity.resolution_status}</small><b>{entity.canonical_name}</b></div>{entity.mentions.slice(0,1).map((mention,index)=><blockquote key={`${entity.entity_id}-${index}`}><q>{mention.quote}</q><small>{mention.sourceTitle}</small></blockquote>)}</button>)}</div>}
        {gaps.length>0?<div className="t10-gap-list">{gaps.map((gap)=><article key={gap.gap_id}><span>Приоритет {gap.priority} · {gap.related_entity_name??'Компания'} · {gap.status==='open'?'нужен ответ':'ответ сохранён'}</span><b>{gap.missing_fact}</b><p>{gap.rationale}</p><q>{gap.question}</q>{gap.answers?.map((answer)=><blockquote key={answer.answerId}>{answer.answerText}<small>Пользовательский ответ · {answer.answerStatus}</small></blockquote>)}{gap.status==='open'&&<div className="t10-gap-answer"><Textarea label="Ответ" labelView="outer" value={gapAnswers[gap.gap_id]??''} onChange={(_,p)=>setGapAnswers((current)=>({...current,[gap.gap_id]:p.value}))} block minRows={2} maxRows={5} autosize maxLength={20000}/><Button view="secondary" size={40} disabled={busy||!gapAnswers[gap.gap_id]?.trim()} onClick={()=>void answerGap(gap.gap_id)}>Сохранить ответ</Button></div>}</article>)}</div>:<p className="t10-empty">Открытых пробелов не обнаружено.</p>}
      </section>
      <section className="t10-panel"><div className="t10-panel-title"><div><span>06</span><div><h2>История и версии</h2><p>Запуски, статусы этапов, расход и сохранённые версии профиля.</p></div></div><div className="t10-version-actions"><small>{runHistory.length} запусков · {versions.length} версий</small>{versions.length>0&&<Button view="secondary" size={40} onClick={exportLatestProfile}>Скачать JSON профиля</Button>}</div></div>
        {runHistory.length===0?<p className="t10-empty">Запусков ещё нет.</p>:<div className="t10-run-history">{runHistory.map((run)=><details key={run.run_id}><summary><b>Запуск #{run.run_number}</b><span>{run.status}</span><time>{new Date(run.started_at).toLocaleString('ru-RU')}</time><small>{run.input_tokens??0} входных · {run.output_tokens??0} выходных · {run.reported_cost_rub??'0'} ₽</small></summary><div>{run.blocks.map((stage)=><p key={`${run.run_id}-${stage.blockId}`}><b>{stage.blockId}</b> · {stage.status}{stage.error&&<small>{stage.error}</small>}</p>)}</div></details>)}</div>}
        {versions.length>0&&<details className="t10-history"><summary>Версии профиля</summary>{versions.map((version)=><details key={version.version}><summary>Версия {version.version} · {new Date(version.created_at).toLocaleString('ru-RU')}</summary><pre>{JSON.stringify(version.profile_json,null,2)}</pre></details>)}</details>}
      </section>
      {selectedEvidence&&<div className="t10-overlay" onClick={()=>setSelectedEvidence(null)}><section role="dialog" aria-modal="true" aria-label="Происхождение факта" onClick={(e)=>e.stopPropagation()}><button type="button" className="t10-close" onClick={()=>setSelectedEvidence(null)} aria-label="Закрыть">×</button><span className="eyebrow">ПРОИСХОЖДЕНИЕ ФАКТА</span><h2>{selectedEvidence.sourceTitle}</h2><p>Тип: {selectedEvidence.sourceType} · доступ: {accessName(selectedEvidence.accessLevel)}</p><blockquote>{selectedEvidence.quote}</blockquote><p>Совпадение цитаты с сохранённым текстом: {selectedEvidence.quoteMatchesSource?'да':'нет'}.</p><p>Проверка: <b>{selectedEvidence.factValidation}</b>. Наличие точной цитаты само по себе не доказывает истинность отношения.</p></section></div>}
      {selectedEntity&&<div className="t10-overlay" onClick={()=>setSelectedEntity(null)}><section role="dialog" aria-modal="true" aria-label="Узел графа компании" onClick={(e)=>e.stopPropagation()}><button type="button" className="t10-close" onClick={()=>setSelectedEntity(null)} aria-label="Закрыть">×</button><span className="eyebrow">УЗЕЛ ГРАФА · {selectedEntity.entity_type}</span><h2>{selectedEntity.canonical_name}</h2><p>Разрешение сущности: <b>{selectedEntity.resolution_status}</b></p>{selectedEntity.mentions.map((mention,index)=><blockquote key={index}><q>{mention.quote}</q><p>{mention.sourceTitle}</p></blockquote>)}</section></div>}
    </>}
  </main>
}
