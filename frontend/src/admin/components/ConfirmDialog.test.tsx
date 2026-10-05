import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog state={{ open: false, title: '' }} busy={false} error={null} onConfirm={() => undefined} onClose={() => undefined} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('requires a reason of at least 10 characters before confirming', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        state={{ open: true, title: 'Блокировка пользователя', requireReason: true, confirmLabel: 'Заблокировать', danger: true }}
        busy={false}
        error={null}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    )

    const confirmBtn = screen.getByRole('button', { name: 'Заблокировать' })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: 'кратко' } })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: 'Нарушение правил 12' } })
    expect(confirmBtn).toBeEnabled()

    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith('Нарушение правил 12')
  })

  it('confirms immediately when no reason is required', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        state={{ open: true, title: 'Разблокировка', confirmLabel: 'Разблокировать' }}
        busy={false}
        error={null}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Разблокировать' }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <ConfirmDialog state={{ open: true, title: 'Тест' }} busy={false} error={null} onConfirm={() => undefined} onClose={onClose} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
