import { useState } from 'react'
import { Tab, Tabs } from '@alfalab/core-components/tabs'
import T08 from './blocks/T08'
import T09 from './blocks/T09'
import T10 from './blocks/T10'
import T11 from './blocks/T11'
import T12 from './blocks/T12'
import T13 from './blocks/T13'
import type { T08Snapshot } from './blocks/T08'
import Archive from './archive'
import InsightApp from './insight/InsightApp'

const blocks = { T08, T09, T10, T11, T12, T13 }
type BlockId = keyof typeof blocks
type ViewId = BlockId | 'DB'
const viewIds = [...Object.keys(blocks), 'DB'] as ViewId[]
const tabTitles: Record<ViewId, string> = {
  T08: 'Разметка', T09: 'События', T10: 'Профиль', T11: 'Аналитика', T12: 'Обзор', T13: 'Результаты', DB: 'Архив',
}

function LabWorkspace({ onReturn }: { onReturn: () => void }) {
  const [selectedBlock, setSelectedBlock] = useState<ViewId>('T08')
  const [t08Snapshot, setT08Snapshot] = useState<T08Snapshot | null>(null)
  const renderActiveBlock = () => {
    switch (selectedBlock) {
      case 'T08':
        return <T08 initialSnapshot={t08Snapshot} onAnalysisComplete={setT08Snapshot} />
      case 'T09':
        return null
      case 'DB':
        return <Archive />
      default: {
        const OtherBlock = blocks[selectedBlock]
        return <OtherBlock />
      }
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <button className="lab-return" type="button" onClick={onReturn}>← Альфа Инсайт</button>
        <span className="brand">Внутренние инструменты</span>
        <div className="variant-nav">
          <Tabs
            aria-label="Внутренние инструменты анализа"
            selectedId={selectedBlock}
            onChange={(_, payload) => setSelectedBlock(String(payload.selectedId) as ViewId)}
            view="primary"
            size="s"
            scrollable
          >
            {viewIds.map((viewId) => <Tab key={viewId} id={viewId} title={tabTitles[viewId]} />)}
          </Tabs>
        </div>
      </header>
      {renderActiveBlock()}
      <div hidden={selectedBlock !== 'T09'}>
        <T09 source={t08Snapshot} onReturnToT08={() => setSelectedBlock('T08')} />
      </div>
    </div>
  )
}

export default function App() {
  const [showLab, setShowLab] = useState(() => new URLSearchParams(window.location.search).get('view') === 'internal')
  const returnHome = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.replaceState({}, '', url)
    setShowLab(false)
  }
  return showLab
    ? <LabWorkspace onReturn={returnHome} />
    : <InsightApp />
}
