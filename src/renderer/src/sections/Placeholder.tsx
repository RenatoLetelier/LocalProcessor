import type { Section } from '@/sections'

export function Placeholder({ section }: { section: Section }) {
  return (
    <div className="placeholder">
      <p className="placeholder__hint">Esta sección se implementa en la fase 7.</p>
      <p>{section.description}</p>
    </div>
  )
}
