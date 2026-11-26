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

// Single shared calculation for "how far into the CURRENT tier is this
// customer" — every tier-progress bar/line/text in the app must read off
// this, not recompute its own percentage, so the number on screen (e.g.
// "379 / 1,000 pts to Gold") always agrees with wherever a bar/line is
// drawn from the same `percent`. Progress is measured from the current
// tier's own floor, not from 0 — reaching Silver always starts that tier's
// bar back at 0%, same as a game XP bar resetting each level.
export const getTierProgress = (points) => {
  const p = points || 0
  const tier = getTier(p)
  const nextTier = getNextTier(p)
  if (!nextTier) {
    // Platinum (or any future top tier) — nothing left to progress toward.
    return { tier, nextTier: null, currentTierMin: tier.min, nextTierMin: null, progressInTier: 0, tierRange: 0, percent: 100, pointsToNext: 0 }
  }
  const currentTierMin = tier.min
  const nextTierMin = nextTier.min
  const progressInTier = p - currentTierMin
  const tierRange = nextTierMin - currentTierMin
  const percent = Math.min(100, Math.max(0, (progressInTier / tierRange) * 100))
  const pointsToNext = nextTierMin - p
  return { tier, nextTier, currentTierMin, nextTierMin, progressInTier, tierRange, percent, pointsToNext }
}
