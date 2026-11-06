import { Medal, Award, Crown } from 'lucide-react'

// Single source of truth for loyalty tiers — icon, color, and point
// thresholds — so the customers table badge and the purchase history
// modal's tier progress card always agree. Thresholds match the formula
// used everywhere stats are earned/reversed (src/store/index.js
// addPoints/revertPurchase): 10 pts/transaction + 1 pt per ₱100 spent.
export const TIERS = [
  { key: 'bronze',   label: 'Bronze',   min: 0,    max: 500,      icon: Medal,  color: '#b45309', bg: 'rgba(180,83,9,0.12)'  },
  { key: 'silver',   label: 'Silver',   min: 500,  max: 1500,     icon: Medal,  color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
  { key: 'gold',     label: 'Gold',     min: 1500, max: 3000,     icon: Award,  color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  { key: 'platinum', label: 'Platinum', min: 3000, max: Infinity, icon: Crown,  color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
]

export const getTier = (points) => {
  const p = points || 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (p >= TIERS[i].min) return TIERS[i]
  }
  return TIERS[0]
}

// Null once the customer has reached the top tier (Platinum) — nothing left to progress toward.
export const getNextTier = (points) => {
  const idx = TIERS.findIndex(t => t.key === getTier(points).key)
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null
}
