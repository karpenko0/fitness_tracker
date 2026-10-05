import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import { ADMIN_STEP_UP_REQUIRED, ADMIN_UNAUTHORIZED, extractError } from './api'
import { adminLogin, adminMfaVerify, fetchMe, fetchRoleMatrix, AdminMe, RoleMatrix } from './auth'

export type StepUpState = { open: boolean }

type AdminContextValue = {
  me: AdminMe | null
  roles: RoleMatrix | null
  loading: boolean
  stepUpOpen: boolean
  closeStepUp: () => void
  can: (permission: string) => boolean
  refresh: () => Promise<void>
  /** Re-authenticate (password, + MFA code if the account requires it). Returns success. */
  stepUp: (password: string, mfaCode?: string) => Promise<boolean>
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function AdminProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null)
  const [roles, setRoles] = useState<RoleMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [stepUpOpen, setStepUpOpen] = useState(false)

  const loadMe = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([fetchMe(), fetchRoleMatrix().catch(() => null)])
      setMe(m)
      setRoles(r)
    } catch (e) {
      const err = extractError(e)
      if (err.status === 401) {
        window.dispatchEvent(new CustomEvent(ADMIN_UNAUTHORIZED, { detail: err }))
      }
      // 403 on /roles (CONTENT_MANAGER lacks roles:read) is fine — /me still loaded.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMe()
  }, [loadMe])

  // 401 anywhere -> full re-login
  useEffect(() => {
    const onUnauthorized = () => {
      if (!window.location.pathname.startsWith('/admin/login')) {
        window.location.assign('/admin/login')
      }
    }
    window.addEventListener(ADMIN_UNAUTHORIZED, onUnauthorized)
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED, onUnauthorized)
  }, [])

  // STEP_UP_REQUIRED -> open the re-auth dialog
  useEffect(() => {
    const onStepUp = () => setStepUpOpen(true)
    window.addEventListener(ADMIN_STEP_UP_REQUIRED, onStepUp)
    return () => window.removeEventListener(ADMIN_STEP_UP_REQUIRED, onStepUp)
  }, [])

  const can = useCallback(
    (permission: string) => (me ? me.permissions.includes(permission) : false),
    [me],
  )

  const stepUp = useCallback(
    async (password: string, mfaCode?: string): Promise<boolean> => {
      if (!me) return false
      try {
        const res = await adminLogin(me.email, password)
        if (res.mfa_required && res.challenge_id) {
          if (!mfaCode) return false
          await adminMfaVerify({
            email: me.email,
            password,
            challenge_id: res.challenge_id,
            code: mfaCode,
          })
        }
        setStepUpOpen(false)
        await loadMe()
        return true
      } catch {
        return false
      }
    },
    [me, loadMe],
  )

  const value = useMemo<AdminContextValue>(
    () => ({
      me,
      roles,
      loading,
      stepUpOpen,
      closeStepUp: () => setStepUpOpen(false),
      can,
      refresh: loadMe,
      stepUp,
    }),
    [me, roles, loading, stepUpOpen, can, loadMe, stepUp],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside <AdminProvider>')
  return ctx
}
