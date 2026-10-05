import { useAdmin } from '../store'
import { roleLabel } from '../format'
import { ErrorBanner, Loading } from '../components/ui'

const ROLES = ['content_manager', 'admin', 'super_admin']

export default function RolesPage() {
  const { roles, loading, me } = useAdmin()

  if (loading) return <Loading />
  if (!roles) return <ErrorBanner error={{ code: 'NO_MATRIX', message: 'Матрица ролей недоступна' }} />

  const allPermissions: string[] =
    (roles as { allPermissions?: string[] }).allPermissions ||
    Array.from(new Set(roles.roles.flatMap((r) => r.permissions)))

  return (
    <section aria-label="Роли и права">
      <h1>Роли и права</h1>
      <p className="admin-muted">
        Модель RBAC с отказом по умолчанию: доступ проверяется на сервере при каждом запросе.
        Назначение ролей выполняется в карточке пользователя; повысить роль выше собственной нельзя,
        последний активный супер-администратор не может быть заблокирован или лишён роли.
        {me && (
          <>
            {' '}
            Ваша роль: <strong>{roleLabel(me.role)}</strong>.
          </>
        )}
      </p>
      <table className="admin-table">
        <caption className="admin-visually-hidden">Матрица ролей и прав</caption>
        <thead>
          <tr>
            <th scope="col">Право</th>
            {ROLES.map((r) => (
              <th key={r} scope="col">
                {roleLabel(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allPermissions.map((p) => (
            <tr key={p}>
              <th scope="row">
                <code>{p}</code>
              </th>
              {ROLES.map((r) => {
                const entry = roles!.roles.find((x) => x.role === r)
                const has = entry?.permissions.includes(p) ?? false
                return (
                  <td key={r} aria-label={`${p}: ${roleLabel(r)} ${has ? 'есть право' : 'нет права'}`}>
                    {has ? '✓' : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
