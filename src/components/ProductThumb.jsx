import { useCategoryStore } from '../store'
import { categoryIcon, ICON_MAP, BADGE_SWATCHES } from '../utils/helpers'

// Photo if one was uploaded, else the product's emoji icon, else the
// category's manually-pinned icon (set by an admin for categories the
// keyword guess doesn't fit), else a keyword-matched icon, else a generic
// blank box — used anywhere a product shows up by name/thumbnail.
export default function ProductThumb({ image, icon, category, size = 28, radius = 7 }) {
  const categories = useCategoryStore(s => s.categories)
  const catObj = categories.find(c => c.name === category)
  const hex = BADGE_SWATCHES.find(s => s.cls === catObj?.badgeColor)?.hex || '#34d399'
  const content = image || icon

  if (content && (content.startsWith('data:') || content.startsWith('http'))) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', border: '1px solid var(--border2)', flexShrink: 0 }}>
        <img src={content} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }
  if (content) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius, background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.5), flexShrink: 0 }}>
        {content}
      </div>
    )
  }
  const CatIcon = (catObj?.icon && ICON_MAP[catObj.icon]) || categoryIcon(category)
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: `${hex}1a`, border: `1px solid ${hex}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: hex, flexShrink: 0 }}>
      <CatIcon size={Math.round(size * 0.45)} />
    </div>
  )
}
