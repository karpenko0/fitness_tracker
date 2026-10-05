import { useEffect, useRef, type ReactNode} from 'react'
import { statusLabel } from '../format'

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>
}

export function statusTone(s: string | null | undefined): string {
  switch (s) {
    case 'ACTIVE':
    case 'PAID':
    case 'SUCCESS':
    case 'PUBLISHED':
    case 'APPROVED':
    case 'READY':
    case 'SENT':
      return 'green'
    case 'DRAFT':
    case 'PENDING':
    case 'PROCESSING':
    case 'SCHEDULED':
    case 'IDLE':
      return 'gray'
    case 'IN_REVIEW':
    case 'PROCESSING':
      return 'blue'
    case 'BLOCKED':
    case 'FAILED':
    case 'DENIED':
    case 'REJECTED':
      return 'red'
    case 'REFUNDED':
    case 'UNPUBLISHED':
    case 'EXPIRED':
    case 'REVOKED':
    case 'CANCELLED':
    case 'IGNORED':
      return 'amber'
    default:
      return 'gray'
  }
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
}

export function ErrorBanner({ error }: { error: { code?: string; message: string } | null }) {
  if (!error) return null
  return (
    <div role="alert" className="admin-banner admin-banner-error">
      <span className="admin-banner-title">Ошибка:</span> {error.message}
      {error.code && <span className="admin-banner-code"> ({error.code})</span>}
    </div>
  )
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="admin-banner admin-banner-info" role="status">
      {children}
    </div>
  )
}

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <p className="admin-loading" role="status">
      {label}
    </p>
  )
}

export function EmptyState({ children = 'Нет данных' }: { children?: ReactNode }) {
  return <p className="admin-empty">{children}</p>
}

export function Field({
  id,
  label,
  required,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="admin-field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="admin-req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="admin-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav className="admin-pagination" aria-label="Постраничная навигация">
      <button type="button" className="admin-btn admin-btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Назад
      </button>
      <span aria-live="polite">
        Стр. {page} из {pages} (всего {total})
      </span>
      <button
        type="button"
        className="admin-btn admin-btn-secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Вперёд →
      </button>
    </nav>
  )
}

export function SearchBox({
  value,
  onChange,
  onSearch,
  placeholder = 'Поиск…',
  label = 'Поиск',
}: {
  value: string
  onChange: (v: string) => void
  onSearch?: () => void
  placeholder?: string
  label?: string
}) {
  return (
    <form
      className="admin-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch?.()
      }}
    >
      <label className="admin-visually-hidden" htmlFor={`search-${label}`}>
        {label}
      </label>
      <input
        id={`search-${label}`}
        className="admin-input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="submit" className="admin-btn admin-btn-secondary">
        Найти
      </button>
    </form>
  )
}

/** Modal dialog with basic focus management (WCAG 2.1 AA): Esc closes, initial focus inside. */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    // Move focus into the dialog
    const el = ref.current?.querySelector<HTMLElement>('button, input, textarea, [tabindex]')
    el?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        // Simple focus trap
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, a[href], [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])

  return (
    <div className="admin-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`modal-title-${title.replace(/\s+/g, '-')}`}
        className={`admin-modal${wide ? ' admin-modal-wide' : ''}`}
      >
        <div className="admin-modal-head">
          <h2 id={`modal-title-${title.replace(/\s+/g, '-')}`}>{title}</h2>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} aria-label="Закрыть окно">
            ✕
          </button>
        </div>
        <div className="admin-modal-body">{children}</div>
      </div>
    </div>
  )
}
