import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuthStore, useAppStore } from './store'
import { ToastProvider } from './utils/toast'
import Login     from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Layout    from './components/Layout'
import AppSkeleton from './components/AppSkeleton'
import LoginSkeleton from './components/LoginSkeleton'
import POS       from './pages/POS'
import Dashboard from './pages/Dashboard'
import Products  from './pages/Products'
import Reports   from './pages/Reports'
import Customers from './pages/Customers'
import Refunds   from './pages/Refunds'
import Returns   from './pages/Returns'
import Staff     from './pages/Staff'
import ActivityLog from './pages/ActivityLog'

function Guard({ children, adminOnly=false }) {
  const { user, role } = useAuthStore()
  if (!user) return <Navigate to="/login" replace/>
  if (adminOnly && role !== 'admin') return <Navigate to="/pos" replace/>
  return children
}

export default function App() {
  const { theme } = useAppStore()
  const init = useAuthStore(s=>s.init)
  const initialized = useAuthStore(s=>s.initialized)
  const [minDelayDone, setMinDelayDone] = useState(false)
  useEffect(()=>{ document.documentElement.classList.toggle('light', theme==='light') },[theme])
  useEffect(()=>{ init() },[init])
  useEffect(()=>{ const t = setTimeout(()=>setMinDelayDone(true), 350); return ()=>clearTimeout(t) },[])

  if (!initialized || !minDelayDone) {
    return window.location.pathname === '/login' ? <LoginSkeleton/> : <AppSkeleton/>
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login/>}/>
          <Route path="/reset-password" element={<ResetPassword/>}/>
          <Route path="/" element={<Guard><Layout/></Guard>}>
            <Route index element={<Navigate to="/pos" replace/>}/>
            <Route path="pos"       element={<POS/>}/>
            <Route path="dashboard" element={<Dashboard/>}/>
            <Route path="products"  element={<Guard adminOnly><Products/></Guard>}/>
            <Route path="reports"   element={<Guard adminOnly><Reports/></Guard>}/>
            <Route path="customers" element={<Customers/>}/>
            <Route path="refunds"   element={<Refunds/>}/>
            <Route path="returns"   element={<Returns/>}/>
            <Route path="staff"     element={<Guard adminOnly><Staff/></Guard>}/>
            <Route path="activity-log" element={<Guard adminOnly><ActivityLog/></Guard>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
