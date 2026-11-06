import { useState, useRef, useCallback } from 'react'
import { Package, PauseCircle } from 'lucide-react'
import { useCartStore, useHoldStore, useProductStore, useCustomerStore, useAppStore, useCategoryStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, useKeyboardShortcuts, useBreakpoint, peso, stockStatus, categoryIcon, BADGE_SWATCHES } from '../utils/helpers'
import Cart from '../components/Cart'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

function ProductCard({ product, onAdd, isLight, bodyText, catColor }) {
  const { stock, name, image, icon, price, category } = product
  const isOut = stock === 0
  const isLow = stock > 0 && stock <= 3
  const mutedText = isLight ? '#4b5563' : 'var(--text3)'

  return (
    <div onClick={()=>!isOut&&onAdd(product)} style={{
      background:'var(--bg2)', border:`1px solid ${isLow&&!isOut?'rgba(245,158,11,0.3)':'var(--border)'}`,
      borderRadius:12, padding:14, cursor:isOut?'not-allowed':'pointer',
      transition:'all .15s', position:'relative', userSelect:'none', overflow:'hidden', opacity:isOut?.5:1,
    }}
    onMouseEnter={e=>{ if(!isOut){e.currentTarget.style.borderColor='rgba(52,211,153,0.4)';e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.3)'}}}
    onMouseLeave={e=>{ e.currentTarget.style.borderColor=isLow?'rgba(245,158,11,0.3)':'var(--border)';e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none'}}
    onMouseDown={e=>{ if(!isOut) e.currentTarget.style.transform='scale(.97)'}}
    onMouseUp={e=>{ if(!isOut) e.currentTarget.style.transform='translateY(-2px)'}}>
      {isLow&&!isOut&&<div style={{position:'absolute',top:8,right:8,background:'rgba(245,158,11,0.12)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:99,fontSize:9,fontWeight:700,padding:'2px 6px',color:'var(--yellow)'}}>LOW</div>}
      {isOut&&<div style={{position:'absolute',inset:0,borderRadius:12,background:'rgba(10,10,10,0.75)',display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:11,fontWeight:700,color:'var(--red)',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.25)',padding:'4px 12px',borderRadius:99}}>OUT OF STOCK</span></div>}
      <div style={{width:'100%', height:80, background:'var(--bg3)', borderRadius:8, marginBottom:10, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', border:'1px solid var(--border2)'}}>
        {image && (image.startsWith('data:') || image.startsWith('http')) ? (
          <img src={image} style={{width:'100%', height:'100%', objectFit:'cover'}} alt=""/>
        ) : image || icon ? (
          <span style={{fontSize:32}}>{image || icon}</span>
        ) : (() => {
          const CatIcon = categoryIcon(category)
          return <CatIcon size={28} color={catColor}/>
        })()}
      </div>
      <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:6,lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',minHeight:34}}>{name}</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,color:bodyText}}>{peso(price)}</div>
      <div style={{display:'inline-flex',alignItems:'baseline',gap:5,marginTop:6,padding:'3px 9px 3px 7px',borderRadius:99,
        background:isOut?'rgba(239,68,68,0.1)':isLow?'rgba(245,158,11,0.1)':'rgba(52,211,153,0.1)',
        border:`1px solid ${isOut?'rgba(239,68,68,0.22)':isLow?'rgba(245,158,11,0.22)':'rgba(52,211,153,0.2)'}`}}>
        <span style={{width:6,height:6,borderRadius:'50%',background:isOut?'var(--red)':isLow?'var(--yellow)':'var(--green)',flexShrink:0,alignSelf:'center'}}/>
        {!isOut&&<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:800,color:isLow?'var(--yellow)':'var(--green)',lineHeight:1}}>{stock}</span>}
        <span style={{fontSize:10,fontWeight:600,color:isOut?'var(--red)':isLow?'var(--yellow)':mutedText,letterSpacing:'.01em'}}>{isOut?'Out of stock':isLow?'left':'in stock'}</span>
      </div>
    </div>
  )
}

export default function POS() {
  useDocumentTitle('POS')
  const products   = useProductStore(s=>s.products)
  const loading    = useProductStore(s=>s.loading)
  const customers  = useCustomerStore(s=>s.customers)
  const categories = useCategoryStore(s=>s.categories)
  const CATEGORIES = ['All', ...categories.map(c=>c.name)]
  const catHex = (name) => BADGE_SWATCHES.find(s=>s.cls===(categories.find(c=>c.name===name)?.badgeColor||'badge-accent'))?.hex || '#34d399'
  const { theme }    = useAppStore()
  const { items, addItem, clearCart, setCustomer } = useCartStore()
  const { holds, removeHold, saveHold } = useHoldStore()
  const holdsPg = usePagination(holds)
  const toast = useToast()
  const t     = useT()
  const { isMobile } = useBreakpoint()

  const isLight = theme === 'light'
  const mutedText = isLight ? '#4b5563' : '#d1d5db'
  const bodyText = isLight ? '#374151' : '#ffffff'

  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('All')
  const [sortBy,    setSortBy]    = useState('')
  const [showHolds, setShowHolds] = useState(false)
  const searchRef = useRef()

  const handleAdd = useCallback(product => {
    const ok = addItem(product)
    if(ok) toast(product.name+' added','success')
    else   toast(t('out_of_stock'),'error')
  },[addItem,toast,t])

  const handleHold = () => {
    if(!items.length) return
    const label = window.prompt(t('hold_label'),`Hold ${holds.length+1}`)
    if(label!==null){saveHold(label,items,null);clearCart();toast(t('order_held')+' '+label,'info')}
  }

  const restoreHold = hold => {
    hold.items.forEach(item=>addItem({...item,qty:item.qty-1}))
    if(hold.customerId) setCustomer(hold.customerId)
    removeHold(hold.id)
    setShowHolds(false)
    toast('Order restored','success')
  }

  const filtered = products
    .filter(p=>(category==='All'||p.category===category)&&(!search||p.name.toLowerCase().includes(search.toLowerCase())||(p.barcode||'').toLowerCase().includes(search.toLowerCase())))
    .sort((a,b)=>{ if(sortBy==='price-asc') return a.price-b.price; if(sortBy==='price-desc') return b.price-a.price; if(sortBy==='name') return a.name.localeCompare(b.name); if(sortBy==='stock') return b.stock-a.stock; return 0 })

  useKeyboardShortcuts([
    {key:'/',fn:()=>searchRef.current?.focus()},
    {key:'Escape',fn:()=>setSearch('')},
  ])

  return (
    <div style={{display:'flex',flexDirection:isMobile?'column':'row',height:'100%',overflow:'hidden'}}>
      {/* LEFT */}
      <div style={{flex:isMobile?'0 0 56%':1,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden',padding:isMobile?'12px':16,gap:12}}>
        {/* Search row */}
        <div style={{display:'flex',gap:8,flexShrink:0}}>
          <div style={{flex:1,position:'relative'}}>
            <div style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',pointerEvents:'none',display:'flex',alignItems:'center',opacity:0.6}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
            </div>
            <input ref={searchRef} className="input-field" style={{paddingLeft:40}} placeholder={t('search_product')+'  (/ to focus)'} value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <select className="select-field" style={{width:140}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="">Sort by…</option>
            <option value="name">Name A–Z</option>
            <option value="price-asc">Price ↑</option>
            <option value="price-desc">Price ↓</option>
            <option value="stock">Stock</option>
          </select>
          <button onClick={()=>setShowHolds(true)} style={{padding:'9px 14px',borderRadius:8,border:'1px solid var(--border2)',background:holds.length?'rgba(52,211,153,0.08)':'var(--bg3)',color:holds.length?'var(--accent)':'var(--text2)',cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
            Holds {holds.length>0&&<span style={{background:'var(--accent)',color:'#000',fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:99}}>{holds.length}</span>}
          </button>
        </div>

        {/* Categories */}
        <div style={{display:'flex',gap:6,overflowX:'auto',flexShrink:0,scrollbarWidth:'none'}}>
          {CATEGORIES.map(cat=>(
            <button key={cat} onClick={()=>setCategory(cat)} style={{padding:'6px 14px',borderRadius:99,border:'1px solid',fontSize:12,fontWeight:500,whiteSpace:'nowrap',cursor:'pointer',transition:'all .15s',fontFamily:'inherit',...(category===cat?{background:'#072b7d',borderColor:'#072b7d',color:'#ffffff',fontWeight:700}:{background:'transparent',borderColor:'var(--border)',color:'var(--text2)'})}}>{cat}</button>
          ))}
        </div>

        {/* Products grid */}
        <div style={{flex:1,overflowY:'auto'}}>
          {loading
            ? <div style={{display:'grid',gap:10,gridTemplateColumns:`repeat(auto-fill,minmax(${isMobile?120:148}px,1fr))`,alignContent:'start'}}>
                {Array.from({length:isMobile?8:15}).map((_,i)=>(
                  <div key={i} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:12,padding:14}}>
                    <div className="skeleton" style={{width:'100%',height:80,borderRadius:8,marginBottom:10}}/>
                    <div className="skeleton" style={{height:11,marginBottom:6}}/>
                    <div className="skeleton" style={{width:'60%',height:11,marginBottom:6}}/>
                    <div className="skeleton" style={{width:'40%',height:9}}/>
                  </div>
                ))}
              </div>
          : filtered.length===0
            ? <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',color:mutedText,gap:8}}><Package size={36} style={{opacity:.2}}/><span>{t('no_data')}</span></div>
            : <div style={{display:'grid',gap:10,gridTemplateColumns:`repeat(auto-fill,minmax(${isMobile?120:148}px,1fr))`,alignContent:'start'}}>
                {filtered.map(p=><ProductCard key={p.id} product={p} onAdd={handleAdd} isLight={isLight} bodyText={bodyText} catColor={catHex(p.category)}/>)}
              </div>
          }
        </div>

        {/* Footer */}
        <div style={{display:'flex',justifyContent:'space-between',flexShrink:0}}>
          <span style={{fontSize:11,color:mutedText}}>{t('showing')} {filtered.length} {t('of')} {products.length}</span>
          <div style={{display:'flex',gap:10}}>
            {[['/',t('search')],['Esc','Reset']].map(([k,l])=>(
              <span key={k} style={{display:'flex',alignItems:'center',gap:4,fontSize:10,color:mutedText}}>
                <code style={{background:'var(--bg3)',border:'1px solid var(--border)',padding:'1px 5px',borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:9}}>{k}</code>{l}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Cart */}
      <div style={isMobile
        ? {flex:'1 1 44%',minHeight:0,width:'100%',overflow:'hidden'}
        : {width:340,flexShrink:0,height:'100%',overflow:'hidden'}}>
        <Cart products={products} customers={customers}  onHold={handleHold}/>
      </div>

      {/* Holds Modal */}
      {showHolds&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.85)'}} onClick={e=>e.target===e.currentTarget&&setShowHolds(false)}>
          <div className="card animate-scale-in" style={{width:'min(420px,92vw)',padding:24,maxHeight:'70vh',display:'flex',flexDirection:'column'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:15,display:'flex',alignItems:'center',gap:6}}><PauseCircle size={15} style={{color:'var(--yellow)'}}/>Held Orders</div>
              <button onClick={()=>setShowHolds(false)} style={{background:'none',border:'none',color:mutedText,cursor:'pointer',fontSize:20}}>×</button>
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {holds.length===0
                ? <div style={{textAlign:'center',color:mutedText,padding:32}}><PauseCircle size={30} style={{opacity:.2,marginBottom:8}}/><div>No held orders</div></div>
                : holdsPg.pageItems.map(h=>(
                  <div key={h.id} className="card-surface" style={{padding:14,marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13}}>{h.label}</div>
                      <div style={{fontSize:11,color:mutedText,marginTop:2}}>{h.items.length} items</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--accent)',marginTop:3,fontWeight:600}}>{peso(h.items.reduce((s,i)=>s+i.price*i.qty,0))}</div>
                    </div>
                    <button onClick={()=>restoreHold(h)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid rgba(52,211,153,0.3)',background:'rgba(52,211,153,0.08)',color:'var(--accent)',cursor:'pointer',fontSize:12,fontWeight:600}}>Restore</button>
                    <button onClick={()=>{removeHold(h.id);toast('Hold removed','info')}} style={{padding:'6px 10px',borderRadius:8,border:'1px solid rgba(239,68,68,0.3)',background:'rgba(239,68,68,0.08)',color:'var(--red)',cursor:'pointer',fontSize:12}}>×</button>
                  </div>
                ))
              }
            </div>
            <Pagination {...holdsPg}/>
          </div>
        </div>
      )}
    </div>
  )
}
