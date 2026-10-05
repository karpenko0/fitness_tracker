import { Route, Routes } from 'react-router-dom'
import './admin.css'
import { AdminProvider } from './store'
import AdminLayout from './components/AdminLayout'
import AdminLoginPage from './pages/AdminLoginPage'
import DashboardPage from './pages/DashboardPage'
import UsersPage from './pages/UsersPage'
import BillingPage from './pages/BillingPage'
import ExercisesPage from './pages/ExercisesPage'
import ProgramsPage from './pages/ProgramsPage'
import PromosPage from './pages/PromosPage'
import NotificationsPage from './pages/NotificationsPage'
import ChallengesPage from './pages/ChallengesPage'
import HabitsPage from './pages/HabitsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AuditPage from './pages/AuditPage'
import ExportsPage from './pages/ExportsPage'
import RolesPage from './pages/RolesPage'
import SettingsPage from './pages/SettingsPage'

export default function AdminApp() {
  return (
    <AdminProvider>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="billing/subscriptions" element={<BillingPage />} />
          <Route path="billing/payments" element={<BillingPage />} />
          <Route path="billing/webhooks" element={<BillingPage />} />
          <Route path="exercises" element={<ExercisesPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="promos" element={<PromosPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="challenges" element={<ChallengesPage />} />
          <Route path="habits" element={<HabitsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="audit-logs" element={<AuditPage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="admin-403">
                <h1>Страница не найдена</h1>
                <p>Раздел панели администратора не существует.</p>
              </div>
            }
          />
        </Route>
      </Routes>
    </AdminProvider>
  )
}
