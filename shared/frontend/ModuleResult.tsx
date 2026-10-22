import type { ReactNode } from 'react'

export type ResultData = Record<string, any>

export function asRows(value: unknown): ResultData[] {
  return Array.isArray(value) ? value.filter((item): item is ResultData => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}

export function asObject(value: unknown): ResultData {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ResultData : {}
}

export function resultText(value: unknown, fallback = 'Нет данных'): string {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function ResultSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="module-result-section"><div className="module-result-section-heading"><h3>{title}</h3>{aside}</div>{children}</section>
}

export function ResultMetrics({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return <div className="module-result-metrics">{items.map(item => <div className="module-result-metric" key={item.label}><span>{item.label}</span><strong>{resultText(item.value)}</strong></div>)}</div>
}

export function ResultTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  return <span className={`module-result-tag module-result-tag--${tone}`}>{children}</span>
}

export function ResultList({ items, empty = 'Подходящих данных нет.', renderItem }: { items: unknown; empty?: string; renderItem: (item: ResultData, index: number) => ReactNode }) {
  const rows = asRows(items)
  return rows.length ? <div className="module-result-list">{rows.map((item, index) => <div key={`${String(item.id ?? item.event_id ?? item.source_id ?? 'item')}-${index}`}>{renderItem(item, index)}</div>)}</div> : <p className="module-result-empty">{empty}</p>
}

export function ResultTextList({ items, empty = 'Нет отдельных пунктов.' }: { items: unknown; empty?: string }) {
  const values = Array.isArray(items) ? items.filter(item => item !== null && item !== undefined && item !== '') : []
  return values.length ? <ul className="module-result-bullets">{values.map((item, index) => <li key={index}>{resultText(item)}</li>)}</ul> : <p className="module-result-empty">{empty}</p>
}

export function ResultKeyValues({ value, omit = [] }: { value: unknown; omit?: string[] }) {
  const entries = Object.entries(asObject(value)).filter(([key, item]) => !omit.includes(key) && item !== null && item !== undefined && item !== '')
  return entries.length ? <dl className="module-result-key-values">{entries.map(([key, item]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{resultText(item)}</dd></div>)}</dl> : <p className="module-result-empty">Нет заполненных полей.</p>
}
