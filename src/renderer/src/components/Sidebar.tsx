import type { ApiStatus } from '@/lib/useApiStatus'
import { SECTIONS, type SectionId } from '@/sections'

interface SidebarProps {
  active: SectionId
  onSelect: (id: SectionId) => void
  apiStatus: ApiStatus
}

export function Sidebar({ active, onSelect, apiStatus }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">LP</span>
        <span className="sidebar__title">LocalProcessor</span>
      </div>

      <nav className="sidebar__nav" aria-label="Secciones">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`sidebar__item${section.id === active ? ' sidebar__item--active' : ''}`}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <footer className="sidebar__footer">
        <ApiStatusBadge status={apiStatus} />
      </footer>
    </aside>
  )
}

function ApiStatusBadge({ status }: { status: ApiStatus }) {
  const host = status.baseUrl?.replace(/^https?:\/\//, '') ?? '…'
  const label =
    status.state === 'ok' ? `API v${status.version}` : status.state === 'error' ? 'API sin respuesta' : 'Conectando'

  return (
    <div className={`api-status api-status--${status.state}`} title={status.state === 'error' ? status.message : host}>
      <span className="api-status__dot" aria-hidden="true" />
      <span className="api-status__text">
        <span>{label}</span>
        <span className="api-status__host">{host}</span>
      </span>
    </div>
  )
}
