import React from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Plans from './pages/Plans'
import Onboarding from './pages/Onboarding'
import WorkoutStart from './pages/WorkoutStart'
import AdminApp from './admin/AdminApp'

function ClientApp() {
  return (
    <>
      <header>
        <nav>
          <Link to="/">Dashboard</Link> | <Link to="/plans">Plans</Link> | <Link to="/login">Login</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/start/:workoutId" element={<WorkoutStart />} />
          <Route path="/workouts/:workoutId" element={<WorkoutStart />} />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<ClientApp />} />
      </Routes>
    </BrowserRouter>
  )
}
