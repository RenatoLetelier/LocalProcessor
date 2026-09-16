import { useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Placeholder } from '@/sections/Placeholder'
import { useApiStatus } from '@/lib/useApiStatus'
import { SECTIONS, type SectionId } from '@/sections'

export function App() {
  const [active, setActive] = useState<SectionId>('process')
  const apiStatus = useApiStatus()
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!

  return (
    <div className="layout">
      <Sidebar active={active} onSelect={setActive} apiStatus={apiStatus} />
      <main className="panel">
        <header className="panel__header">
          <h1 className="panel__title">{section.label}</h1>
        </header>
        <section className="panel__content">
          <Placeholder section={section} />
        </section>
      </main>
    </div>
  )
}
