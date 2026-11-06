import { useEffect, useState } from 'react'
import {
  Cpu, CircuitBoard, MemoryStick, HardDrive, Laptop, Monitor, Keyboard, Mouse,
  Headphones, Webcam, Printer, Router, Usb, Cable, Fan, BatteryCharging,
  Gamepad2, Smartphone, Tablet, Wrench, Package, Banknote, CreditCard, SplitSquareHorizontal,
} from 'lucide-react'
import { translations } from '../i18n/translations'

export const peso = (n) => '₱' + Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
export const pesoCompact = (n) => { if(n>=1000000) return '₱'+(n/1000000).toFixed(1)+'M'; if(n>=1000) return '₱'+(n/1000).toFixed(1)+'K'; return '₱'+(n||0).toLocaleString() }
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
export const fmtDateTime = (d) => new Date(d).toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
export const fmtTxnId = (id) => '#'+String(id).padStart(4,'0')

// A sale's `payment` column is free text — "Cash", "GCash", "Card", or a
// "Cash+GCash"-style combo for a split payment (see schema.sql). Shared by
// anywhere a transaction's payment method shows as an icon+label chip
// (Dashboard, CustomerHistoryModal).
export const paymentDisplay = (payment) => {
  if (!payment) return { label: '—', Icon: Banknote }
  if (payment.includes('+')) return { label: 'Split', Icon: SplitSquareHorizontal }
  if (payment === 'GCash') return { label: payment, Icon: Smartphone }
  if (payment === 'Card')  return { label: payment, Icon: CreditCard }
  return { label: payment, Icon: Banknote }
}
export const genBarcode = () => 'BC-'+Date.now().toString(36).toUpperCase()

// Downscales + re-encodes an uploaded image before it's stored as a base64 data
// URL in the products table, so a raw phone-camera photo (often several MB)
// doesn't bloat the DB — Supabase's free tier only gives 500MB of database space.
export const resizeImage = (file, maxDim = 640, quality = 0.8) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => {
    const img = new Image()
    img.onerror = reject
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
})

export const stockStatus = (stock) => {
  if(stock===0)  return {label:'Out of stock',cls:'badge-red',   color:'var(--red)',   bg:'rgba(239,68,68,0.1)', border:'rgba(239,68,68,0.22)'}
  if(stock<=3)   return {label:`${stock} left`,cls:'badge-yellow',color:'var(--yellow)',bg:'rgba(245,158,11,0.1)', border:'rgba(245,158,11,0.22)'}
  return               {label:`${stock} in stock`,cls:'badge-green', color:'var(--green)', bg:'rgba(34,197,94,0.1)',border:'rgba(34,197,94,0.2)'}
}

export const getTier = (points) => {
  if(points>=3000) return {label:'Platinum',color:'#8b5cf6',icon:'💎'}
  if(points>=1500) return {label:'Gold',    color:'#eab308',icon:'🥇'}
  if(points>=500)  return {label:'Silver',  color:'#94a3b8',icon:'🥈'}
  return                  {label:'Bronze',  color:'#b45309',icon:'🥉'}
}

// Fallback icon shown for a product with no uploaded image/emoji — matched by
// keyword against the category name so custom categories still get a sensible
// icon instead of the generic box. Order matters: more specific rules first.
const CATEGORY_ICON_RULES = [
  [['processor','cpu'], Cpu],
  [['gpu','graphics','motherboard','mobo','circuit'], CircuitBoard],
  [['ram','memory'], MemoryStick],
  [['storage','ssd','hdd','drive'], HardDrive],
  [['laptop','notebook'], Laptop],
  [['monitor','display','screen'], Monitor],
  [['keyboard'], Keyboard],
  [['mouse','peripheral'], Mouse],
  [['headphone','headset','audio','speaker'], Headphones],
  [['webcam','camera'], Webcam],
  [['printer'], Printer],
  [['network','router','wifi'], Router],
  [['usb','flash'], Usb],
  [['cable','adapter','accessor'], Cable],
  [['fan','cooling','cooler'], Fan],
  [['battery','power','psu'], BatteryCharging],
  [['gaming','console','controller'], Gamepad2],
  [['phone','mobile'], Smartphone],
  [['tablet'], Tablet],
  [['service','repair'], Wrench],
]
export const categoryIcon = (categoryName) => {
  const name = (categoryName||'').toLowerCase()
  const match = CATEGORY_ICON_RULES.find(([keywords])=>keywords.some(k=>name.includes(k)))
  return match ? match[1] : Package
}

// Icon choices an admin can manually pin to a category (stored as the key,
// e.g. "Cpu") when the keyword-based categoryIcon() guess doesn't fit.
export const ICON_MAP = {
  Cpu, CircuitBoard, MemoryStick, HardDrive, Laptop, Monitor, Keyboard, Mouse,
  Headphones, Webcam, Printer, Router, Usb, Cable, Fan, BatteryCharging,
  Gamepad2, Smartphone, Tablet, Wrench, Package,
}
export const ICON_OPTIONS = Object.keys(ICON_MAP)

export const REFUND_REASONS =['Defective product','Wrong item delivered','Customer changed mind','Item not as described','Duplicate purchase','Other']

// Categories now live in the `categories` table (see useCategoryStore) so admins can
// add/remove them from the UI. This is just the picker palette for a new category's badge.
export const BADGE_SWATCHES = [
  { cls:'badge-blue',   hex:'#3b82f6' },
  { cls:'badge-purple', hex:'#8b5cf6' },
  { cls:'badge-accent', hex:'#34d399' },
  { cls:'badge-yellow', hex:'#eab308' },
  { cls:'badge-green',  hex:'#22c55e' },
  { cls:'badge-cyan',   hex:'#06b6d4' },
  { cls:'badge-orange', hex:'#f97316' },
  { cls:'badge-red',    hex:'#ef4444' },
]

export const useT = () => (key) => translations[key] || key

// Breakpoints: <=860px = mobile (stacked layouts, drawer nav), <=1180px = tablet (narrower panels)
// Dedicated breakpoint for the login page's left/right split (desktop-leaning
// 768px cutoff, narrower than the app-wide useBreakpoint's 860px).
export const useLoginMobile = () => {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = () => setNarrow(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return narrow
}

export const useBreakpoint = () => {
  const [width, setWidth] = useState(typeof window!=='undefined' ? window.innerWidth : 1280)
  useEffect(()=>{
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  },[])
  return { width, isMobile: width<=860, isTablet: width>860&&width<=1180 }
}

export const useKeyboardShortcuts = (shortcuts) => {
  useEffect(()=>{
    const h = (e) => {
      const tag = document.activeElement?.tagName
      const typing = tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'
      shortcuts.forEach(({key,allowInInput,fn})=>{ if(typing&&!allowInInput) return; if(e.key===key){e.preventDefault();fn()} })
    }
    window.addEventListener('keydown',h)
    return ()=>window.removeEventListener('keydown',h)
  },[shortcuts])
}
