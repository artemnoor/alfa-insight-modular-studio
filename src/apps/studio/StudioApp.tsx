import { useEffect, useState } from 'react'
import NewsCollector from '../../../modules/01-news-collector/frontend/ModulePage'
import NewsIntelligence from '../../../modules/02-news-intelligence/frontend/ModulePage'
import BusinessIntelligence from '../../../modules/03-business-intelligence/frontend/ModulePage'
import Personalization from '../../../modules/04-personalization/frontend/ModulePage'
import ImpactAnalysis from '../../../modules/05-impact-analysis/frontend/ModulePage'
import BankResearch from '../../../modules/06-bank-research/frontend/ModulePage'
import AIAgent from '../../../modules/07-ai-agent/frontend/ModulePage'
import EvidenceVerification from '../../../modules/08-evidence-verification/frontend/ModulePage'
import AlfaProduct from '../../../modules/09-alfa-product/frontend/ModulePage'
import './studio.css'

const pages: Record<string, React.ComponentType> = {
  'news-collector': NewsCollector, 'news-intelligence': NewsIntelligence,
  'business-intelligence': BusinessIntelligence, personalization: Personalization,
  'impact-analysis': ImpactAnalysis, 'bank-research': BankResearch,
  'ai-agent': AIAgent, 'evidence-verification': EvidenceVerification, 'alfa-product': AlfaProduct,
}
type ModuleStatus = { id: string; name: string; purpose: string; backendAvailable: boolean; mode: string; localDataAvailable: boolean; externalAiAvailable: boolean; externalAiEnabled: boolean; lastResult?: string }

export default function StudioApp() {
  const [modules, setModules] = useState<ModuleStatus[]>([])
  const [error, setError] = useState('')
  const slug = window.location.pathname.replace(/^\/studio\/?/, '').split('/')[0]
  useEffect(() => {
    fetch('/api/modules').then(response => { if (!response.ok) throw new Error('API недоступен'); return response.json() })
      .then(data => setModules(data.modules || [])).catch(() => setError('Backend Studio пока недоступен. Проверьте, что локальный API запущен.'))
  }, [])
  if (slug && pages[slug]) {
    const Page = pages[slug]
    return <><div className="studio-mini-header"><a href="/studio">Alfa Insight Studio</a><span>Внутренняя среда разработки</span></div><Page /></>
  }
  return <main className="studio-home">
    <header className="studio-hero"><div><span className="studio-kicker">INTERNAL DEVELOPER PORTAL</span><h1>Alfa Insight Studio</h1><p>Изолированные рабочие пространства для запуска и проверки каждого блока.</p></div><a href="/" className="studio-product-link">Открыть продукт ↗</a></header>
    {error && <div className="studio-error" role="alert">{error}</div>}
    <section className="studio-module-grid" aria-label="Модули Alfa Insight">
      {(modules.length ? modules : [
        ['news-collector','Сбор новостей','Источники, качество публикаций и дубликаты.'],
        ['news-intelligence','News Intelligence','T08-нормализация и локальная T09-векторизация.'],
        ['business-intelligence','Business Intelligence','Профиль, связи и платёжные агрегаты.'],
        ['personalization','Персонализация','Ранжирование событий и факторы.'],
        ['impact-analysis','Анализ влияния','Условные каналы влияния и проверяемые действия.'],
        ['bank-research','Bank Research / RAG','Поиск фрагментов по банковским документам.'],
        ['ai-agent','AI Agent Studio','План и исполненные инструменты.'],
        ['evidence-verification','Проверка доказательств','Сверка цитат с исходным текстом.'],
        ['alfa-product','Alfa Insight Product','Рабочий пользовательский продукт.'],
      ].map(([id,name,purpose]) => ({id,name,purpose,backendAvailable:false,mode:'Fixture',localDataAvailable:false,externalAiAvailable:false,externalAiEnabled:false})) as ModuleStatus[]).map((item,index) => <article className="studio-card" key={item.id}>
        <div className="studio-card-top"><span className="studio-index">{String(index+1).padStart(2,'0')}</span><span className={`studio-health ${item.backendAvailable ? 'is-ready' : 'is-down'}`}><i />{item.backendAvailable ? 'Backend доступен' : 'Backend не проверен'}</span></div>
        <h2>{item.name}</h2><p>{item.purpose}</p>
        <div className="studio-card-meta"><span>Данные: {item.mode}</span><span>Последняя проверка: {item.lastResult || '—'}</span></div>
        <a className="studio-open" href={`/studio/${item.id}`}>Открыть модуль <span>→</span></a>
      </article>)}
    </section>
    <footer className="studio-footer"><span>Fixture-сценарии используют синтетические данные.</span><span>Внешний AI по умолчанию выключен; ручной opt-in доступен только агенту.</span></footer>
  </main>
}
