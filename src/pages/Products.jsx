import { useState, useEffect } from 'react'
import { Package, Plus, Pencil, AlertTriangle, TrendingUp, Tags, X, Check, Sparkles } from 'lucide-react'
import { useProductStore, useAppStore, useCategoryStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, stockStatus, genBarcode, categoryIcon, resizeImage, ICON_MAP, ICON_OPTIONS, BADGE_SWATCHES } from '../utils/helpers'
import ProductThumb from '../components/ProductThumb'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const EMPTY = { name:'', category:'', price:'', costPrice:'', stock:'', barcode:'', image:'' }

// Shared by the "new category" form and each category's inline editor —
// "Auto" (empty value) means fall back to categoryIcon()'s keyword guess.
function IconPicker({ value, onChange, mutedText }) {
  return (
    <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
      <button type="button" onClick={()=>onChange('')} title="Auto-detect" style={{width:26,height:26,borderRadius:7,border:value===''?'2px solid var(--accent)':'1px solid var(--border2)',background:'var(--bg3)',color:value===''?'var(--accent)':mutedText,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Sparkles size={13}/>
      </button>
      {ICON_OPTIONS.map(key=>{
        const Icon = ICON_MAP[key]
        return (
          <button type="button" key={key} onClick={()=>onChange(key)} title={key} style={{width:26,height:26,borderRadius:7,border:value===key?'2px solid var(--accent)':'1px solid var(--border2)',background:'var(--bg3)',color:value===key?'var(--accent)':mutedText,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Icon size={14}/>
          </button>
        )
      })}
    </div>
  )
}

export default function Products() {
  useDocumentTitle('Inventory')
  const { products, loading, addProduct, updateProduct, deleteProduct, restockProduct } = useProductStore()
  const { categories, addCategory, updateCategory, deleteCategory } = useCategoryStore()
  const [search,    setSearch]    = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [sortBy,    setSortBy]    = useState('name')
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(EMPTY)
  const [selected,  setSelected]  = useState(null)
  const [restockQty,setRestockQty]= useState('')
  const [lossConfirm,setLossConfirm]= useState(null)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor,setNewCatColor]= useState(BADGE_SWATCHES[0].cls)
  const [newCatIcon, setNewCatIcon] = useState('')
  const [editingCatId,setEditingCatId]=useState(null)
  const [editColor,  setEditColor]  = useState(BADGE_SWATCHES[0].cls)
  const [editIcon,   setEditIcon]   = useState('')
  const { theme } = useAppStore()
  const toast = useToast()
  const t     = useT()

  const isLight = theme === 'light'
  const mutedText = isLight ? '#4b5563' : '#d1d5db'
  const bodyText = isLight ? '#374151' : '#ffffff'

  const CATEGORIES = ['All', ...categories.map(c=>c.name)]
  const catBadge = (name) => categories.find(c=>c.name===name)?.badgeColor || 'badge-accent'

  const openAdd   = () => { setForm({...EMPTY,category:categories[0]?.name||'',barcode:genBarcode()}); setModal('add') }
  const openEdit  = p  => { setForm({name:p.name,category:p.category,price:p.price,costPrice:p.costPrice||'',stock:p.stock,barcode:p.barcode||'',image:p.image||''}); setSelected(p); setModal('edit') }
  const openRestock = p => { setSelected(p); setRestockQty(''); setModal('restock') }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await resizeImage(file)
      setForm(f => ({ ...f, image: dataUrl }))
    } catch {
      toast('Could not read that image','error')
    }
  }

  const handleSave = () => {
    if(!form.name.trim()) return toast('Product name is required','error')
    if(!form.price) return toast('Price is required','error')
    if(!form.costPrice) return toast('Cost price is required','error')
    if(!form.stock||parseInt(form.stock)<=0) return toast('Stock must be greater than 0','error')
    const priceNum = parseFloat(form.price), costNum = parseFloat(form.costPrice)
    const data = { name:form.name.trim(), category:form.category, price:priceNum, costPrice:costNum||0, stock:parseInt(form.stock)||0, barcode:form.barcode||genBarcode(), image:form.image }
    if(costNum>priceNum){
      const lossPct = (((costNum-priceNum)/priceNum)*100).toFixed(1)
      setLossConfirm({ data, lossPct })
      return
    }
    saveProduct(data)
  }

  const saveProduct = (data) => {
    if(modal==='add') { addProduct(data); toast(t('product_added'),'success') }
    else { updateProduct(selected.id,data); toast(t('product_updated'),'success') }
    setModal(null)
    setLossConfirm(null)
  }

  const handleRestock = () => {
    if(!restockQty||parseInt(restockQty)<=0) return toast('Enter a valid quantity','error')
    restockProduct(selected.id,parseInt(restockQty))
    toast(t('restocked'),'success')
    setModal(null)
  }

  const handleDelete = (p) => {
    if(!window.confirm(t('confirm_delete'))) return
    deleteProduct(p.id)
    toast(t('product_deleted'),'info')
  }

  const handleAddCategory = async () => {
    const name = newCatName.trim()
    if(!name) return toast('Category name is required','error')
    if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())) return toast('That category already exists','error')
    const added = await addCategory(name, newCatColor, newCatIcon)
    if(!added) return toast('Failed to add category','error')
    toast('Category added','success')
    setNewCatName(''); setNewCatIcon('')
    catPg.setPage(Math.max(1, Math.ceil((categories.length+1)/8)))
  }

  const handleDeleteCategory = async (cat) => {
    const inUse = products.filter(p=>p.category===cat.name).length
    if(inUse>0) return toast(`${inUse} product(s) still use "${cat.name}" — reassign them first`,'error')
    if(!window.confirm(`Delete category "${cat.name}"?`)) return
    const ok = await deleteCategory(cat.id)
    if(ok) toast('Category deleted','info')
  }

  const openEditCat  = (c) => { setEditingCatId(c.id); setEditColor(c.badgeColor); setEditIcon(c.icon||'') }
  const closeEditCat = () => setEditingCatId(null)
  const handleSaveCatEdit = async (cat) => {
    const ok = await updateCategory(cat.id, { badgeColor:editColor, icon:editIcon })
    if(!ok) return toast('Failed to update category','error')
    toast('Category updated','success')
    closeEditCat()
  }

  const filtered = products
    .filter(p=>(catFilter==='All'||p.category===catFilter)&&(!search||p.name.toLowerCase().includes(search.toLowerCase())||(p.barcode||'').toLowerCase().includes(search.toLowerCase())))
    .sort((a,b)=>{ if(sortBy==='name') return a.name.localeCompare(b.name); if(sortBy==='price-asc') return a.price-b.price; if(sortBy==='price-desc') return b.price-a.price; if(sortBy==='stock') return b.stock-a.stock; if(sortBy==='sold') return (b.sold||0)-(a.sold||0); return 0 })

  const pg = usePagination(filtered)
  useEffect(()=>{ pg.setPage(1) }, [search, catFilter, sortBy])

  const catPg = usePagination(categories)

  const totalValue = products.reduce((s,p)=>s+p.price*p.stock,0)
  const outCount   = products.filter(p=>p.stock===0).length
  const lowCount   = products.filter(p=>p.stock>0&&p.stock<=3).length

  return (
    <div style={{height:'100%',overflow:'hidden',display:'flex',flexDirection:'column',padding:20,gap:16}}>
      <div className="page-header">
        <div>
          <div className="page-title" style={{display:'flex',alignItems:'center',gap:10}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
              <path d="m3.3 7 8.7 5 8.7-5"/>
              <path d="M12 22V12"/>
            </svg>
            {t('products')}
          </div>
          <div style={{fontSize:12,color:mutedText,marginTop:2}}>{t('showing')} {filtered.length} {t('of')} {products.length}</div>
        </div>
        <button onClick={openAdd} className="btn-primary">+ {t('add_product')}</button>
      </div>

      <div style={{display:'flex',gap:8,flexShrink:0,flexWrap:'wrap'}}>
        <div style={{position:'relative', maxWidth:280, minWidth:180, flex:1}}>
          <div style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',pointerEvents:'none',display:'flex',alignItems:'center',opacity:0.6}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
          </div>
          <input className="input-field" style={{paddingLeft:40, width:'100%'}} placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="select-field" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        <select className="select-field" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="name">Name A–Z</option><option value="price-asc">Price ↑</option><option value="price-desc">Price ↓</option><option value="stock">Stock</option><option value="sold">Best Selling</option>
        </select>
        <button onClick={()=>{catPg.setPage(1);setEditingCatId(null);setModal('categories')}} className="btn-secondary" style={{fontSize:12,display:'flex',alignItems:'center',gap:6}}><Tags size={14}/>Categories</button>
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        <div className="tbl-wrap">
          <table>
            <thead><tr>{['','Product','Category','Price','Cost','Profit','Stock','Sold','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading?<tr><td colSpan={9} style={{textAlign:'center',padding:40,color:mutedText}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-9-9"/>
                  </svg>
                  Loading products…
                </div>
              </td></tr>
              :filtered.length===0?<tr><td colSpan={9} style={{textAlign:'center',padding:40,color:mutedText}}>{t('no_data')}</td></tr>
              :pg.pageItems.map(p=>{
                const profit=p.costPrice?((p.price-p.costPrice)/p.price*100).toFixed(1):'—'
                const ss=stockStatus(p.stock)
                return(<tr key={p.id}>
                  <td style={{width:56}}>
                    {p.image && (p.image.startsWith('data:') || p.image.startsWith('http')) ? (
                      <div style={{width:44,height:44,borderRadius:8,overflow:'hidden',border:'1px solid var(--border2)',flexShrink:0}}>
                        <img src={p.image} style={{display:'block',width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                      </div>
                    ) : p.image || p.icon ? (
                      <div style={{width:44,height:44,borderRadius:8,background:'var(--bg3)',border:'1px solid var(--border2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,color:mutedText}}>{p.image || p.icon}</div>
                    ) : (() => {
                      const CatIcon = categoryIcon(p.category)
                      const hex = BADGE_SWATCHES.find(s=>s.cls===catBadge(p.category))?.hex || '#34d399'
                      return (
                        <div style={{width:44,height:44,borderRadius:8,background:`${hex}1a`,border:`1px solid ${hex}40`,display:'flex',alignItems:'center',justifyContent:'center',color:hex}}>
                          <CatIcon size={19}/>
                        </div>
                      )
                    })()}
                  </td>
                  <td><div style={{fontWeight:600,fontSize:13,color:'var(--text)'}}>{p.name}</div><div style={{fontSize:11.5,color:'var(--text2)',fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{p.barcode}</div></td>
                  <td><span className={`badge ${catBadge(p.category)}`} style={{fontSize:10}}>{p.category}</span></td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:bodyText,fontWeight:600}}>{peso(p.price)}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:bodyText}}>{p.costPrice?peso(p.costPrice):'—'}</td>
                  <td style={{fontSize:11,color:p.costPrice?'var(--green)':mutedText}}>{profit}{p.costPrice?'%':''}</td>
                  <td>
                    <div style={{display:'flex',flexDirection:'row',alignItems:'center',gap:6}}>
                      <span style={{display:'inline-flex',alignItems:'baseline',gap:5,width:'fit-content',padding:'3px 9px 3px 7px',borderRadius:99,background:ss.bg,border:`1px solid ${ss.border}`}}>
                        <span style={{width:6,height:6,borderRadius:'50%',background:ss.color,flexShrink:0,alignSelf:'center'}}/>
                        {p.stock>0&&<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:800,color:ss.color,lineHeight:1}}>{p.stock}</span>}
                        <span style={{fontSize:10,fontWeight:600,color:ss.color,letterSpacing:'.01em'}}>{p.stock===0?'Out of stock':p.stock<=3?'left':'in stock'}{(() => {
                          const now = new Date()
                          const added = p.createdAt ? new Date(p.createdAt) : null
                          const lastSold = p.lastSoldAt ? new Date(p.lastSoldAt) : null
                          const daysSinceAdded = added ? Math.floor((now-added)/(1000*60*60*24)) : 0
                          const daysSinceLastSold = lastSold ? Math.floor((now-lastSold)/(1000*60*60*24)) : 999
                          if(daysSinceAdded <= 30) return ' (New)'
                          if(daysSinceLastSold > 90) return ' (Old)'
                          return ''
                        })()}</span>
                      </span>
                    </div>
                  </td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:mutedText}}>{p.sold||0}</td>
                  <td><div style={{display:'flex',gap:5}}>
                    <button onClick={()=>openRestock(p)} className="btn-success" style={{fontSize:10,padding:'4px 8px'}}>+Stock</button>
                    <button onClick={()=>openEdit(p)} className="btn-secondary" style={{fontSize:10,padding:'4px 8px'}}>{t('edit')}</button>
                    <button onClick={()=>handleDelete(p)} className="btn-danger" style={{fontSize:10,padding:'4px 8px'}}>{t('delete')}</button>
                  </div></td>
                </tr>)
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...pg}/>
      {(modal==='add'||modal==='edit')&&(
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.9)'}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="card animate-scale-in" style={{width:'min(480px,92vw)',padding:28,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:20,display:'flex',alignItems:'center',gap:6}}>{modal==='add'?<><Plus size={14} style={{color:'var(--green)'}}/>{t('add_product')}</>:<><Pencil size={14} style={{color:'var(--blue)'}}/>{t('edit_product')}</>}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14}}>
              <div style={{gridColumn:'span 2'}}><label style={{fontSize:10,color:mutedText,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('product_name')} *</label><input className="input-field" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. AMD Ryzen 5 5600X"/></div>
              <div><label style={{fontSize:10,color:mutedText,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('category')}</label><select className="select-field" style={{width:'100%'}} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{categories.map(c=><option key={c.id}>{c.name}</option>)}</select></div>
              <div>
                <label style={{fontSize:10,color:mutedText,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('product_image')}</label>
                <label style={{
                  display:'flex', alignItems:'center', gap:10, padding:'6px 12px', borderRadius:10, 
                  background:'var(--bg3)', border:'1px solid var(--border2)', cursor:'pointer', transition:'all .15s'
                }} onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
                  <ProductThumb image={form.image} category={form.category} size={28} radius={6}/>
                  <div style={{flex:1, fontSize:11, fontWeight:700, color:form.image?'var(--text)':'var(--text3)'}}>
                    {form.image ? 'Change Image' : 'Upload Image'}
                  </div>
                  {form.image && (
                    <div onClick={e=>{e.preventDefault(); setForm(f=>({...f,image:''}))}} style={{fontSize:16, color:'var(--red)', padding:'0 4px', fontWeight:700}}>×</div>
                  )}
                  <input type="file" accept="image/*" hidden onChange={handleFileChange}/>
                </label>
              </div>
              {[['price',t('price'),'0.00'],['costPrice',t('cost_price'),'0.00'],['stock',t('stock'),'0']].map(([key,label,ph])=>(
                <div key={key}><label style={{fontSize:10,color:mutedText,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{label} *</label><input className="input-field" type="number" min="0" value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph}/></div>
              ))}
              <div><label style={{fontSize:10,color:mutedText,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('barcode')}</label><div style={{display:'flex',gap:6}}><input className="input-field" value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder="BC-..."/><button onClick={()=>setForm(f=>({...f,barcode:genBarcode()}))} style={{padding:'9px 10px',borderRadius:8,border:'1px solid var(--border2)',background:'var(--bg3)',color:bodyText,cursor:'pointer',fontSize:11}}>Gen</button></div></div>
            </div>
            {form.price&&form.costPrice&&(() => {
              const marginPct = ((parseFloat(form.price)-parseFloat(form.costPrice))/parseFloat(form.price))*100
              const isLoss = marginPct < 0
              const color = isLoss ? 'var(--red)' : 'var(--green)'
              const rgb = isLoss ? '239,68,68' : '34,197,94'
              return (
                <div style={{marginTop:12,padding:10,background:`rgba(${rgb},0.08)`,border:`1px solid rgba(${rgb},0.3)`,borderRadius:8,fontSize:12,fontWeight:700,color,display:'flex',alignItems:'center',gap:6}}>
                  {isLoss ? <AlertTriangle size={14}/> : <TrendingUp size={14}/>} {isLoss ? 'Loss' : 'Profit'}: {marginPct.toFixed(1)}%
                </div>
              )
            })()}
            <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'flex-end'}}><button onClick={()=>setModal(null)} className="btn-secondary">{t('cancel')}</button><button onClick={handleSave} className="btn-primary">{t('save')}</button></div>
          </div>
        </div>
      )}
      {modal==='restock'&&(
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.9)'}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="card animate-scale-in" style={{width:'min(340px,92vw)',padding:28}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8,display:'flex',alignItems:'center',gap:6}}><Package size={14} style={{color:'var(--blue)'}}/>{t('add_stock')}</div>
            <div style={{fontSize:13,color:bodyText,marginBottom:16}}>{selected?.name}</div>
            <div style={{fontSize:11,color:mutedText,marginBottom:6}}>Current stock: <strong style={{color:'var(--text)'}}>{selected?.stock}</strong></div>
            <input className="input-field" type="number" min="1" value={restockQty} onChange={e=>setRestockQty(e.target.value)} placeholder={t('qty_to_add')} onKeyDown={e=>e.key==='Enter'&&handleRestock()}/>
            {restockQty&&parseInt(restockQty)>0&&<div style={{marginTop:8,fontSize:12,color:'var(--green)'}}>New stock: {selected.stock+parseInt(restockQty)}</div>}
            <div style={{display:'flex',gap:10,marginTop:20}}><button onClick={()=>setModal(null)} className="btn-secondary" style={{flex:1}}>{t('cancel')}</button><button onClick={handleRestock} className="btn-primary" style={{flex:1}}>{t('restock')}</button></div>
          </div>
        </div>
      )}
      {modal==='categories'&&(
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.9)'}} onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="card animate-scale-in" style={{width:'min(420px,92vw)',padding:28,maxHeight:'85vh',display:'flex',flexDirection:'column'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:6}}><Tags size={14} style={{color:'var(--accent)'}}/>Manage Categories</div>

            <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:6,marginBottom:8,minHeight:8*38}}>
              {categories.length===0?<div style={{color:mutedText,fontSize:12,textAlign:'center',padding:20}}>No categories yet.</div>
              :catPg.pageItems.map(c=>{
                const count = products.filter(p=>p.category===c.name).length
                const hex = BADGE_SWATCHES.find(s=>s.cls===c.badgeColor)?.hex || '#34d399'
                const CatIcon = (c.icon && ICON_MAP[c.icon]) || categoryIcon(c.name)
                if(editingCatId===c.id) return (
                  <div key={c.id} style={{padding:10,borderRadius:8,background:'var(--bg3)',border:'1px solid var(--border2)'}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--text)'}}>{c.name}</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {BADGE_SWATCHES.map(s=>(
                        <button key={s.cls} type="button" onClick={()=>setEditColor(s.cls)} style={{width:20,height:20,borderRadius:'50%',background:s.hex,border:editColor===s.cls?'2px solid var(--text)':'2px solid transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                          {editColor===s.cls&&<Check size={10} color="#fff"/>}
                        </button>
                      ))}
                    </div>
                    <IconPicker value={editIcon} onChange={setEditIcon} mutedText={mutedText}/>
                    <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end'}}>
                      <button onClick={closeEditCat} className="btn-secondary" style={{fontSize:11,padding:'5px 12px'}}>{t('cancel')}</button>
                      <button onClick={()=>handleSaveCatEdit(c)} className="btn-primary" style={{fontSize:11,padding:'5px 12px'}}>{t('save')}</button>
                    </div>
                  </div>
                )
                return (
                  <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,background:'var(--bg3)'}}>
                    <div style={{width:24,height:24,borderRadius:6,background:`${hex}1a`,border:`1px solid ${hex}40`,display:'flex',alignItems:'center',justifyContent:'center',color:hex,flexShrink:0}}><CatIcon size={13}/></div>
                    <div style={{flex:1,minWidth:0,fontSize:12,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                    <div style={{fontSize:10,color:mutedText,flexShrink:0}}>{count} product{count===1?'':'s'}</div>
                    <button onClick={()=>openEditCat(c)} style={{background:'none',border:'none',color:mutedText,cursor:'pointer',padding:2,display:'flex',flexShrink:0}}><Pencil size={13}/></button>
                    <button onClick={()=>handleDeleteCategory(c)} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',padding:2,display:'flex',flexShrink:0}}><X size={14}/></button>
                  </div>
                )
              })}
            </div>
            <Pagination {...catPg}/>

            <div style={{borderTop:'1px solid var(--border)',paddingTop:16}}>
              <label style={{fontSize:10,color:mutedText,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>New Category</label>
              <input className="input-field" value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="e.g. Monitors" onKeyDown={e=>e.key==='Enter'&&handleAddCategory()}/>
              <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                {BADGE_SWATCHES.map(s=>(
                  <button key={s.cls} onClick={()=>setNewCatColor(s.cls)} style={{width:22,height:22,borderRadius:'50%',background:s.hex,border:newCatColor===s.cls?'2px solid var(--text)':'2px solid transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                    {newCatColor===s.cls&&<Check size={12} color="#fff"/>}
                  </button>
                ))}
              </div>
              <IconPicker value={newCatIcon} onChange={setNewCatIcon} mutedText={mutedText}/>
              <div style={{display:'flex',gap:10,marginTop:16,justifyContent:'flex-end'}}>
                <button onClick={()=>setModal(null)} className="btn-secondary">{t('close')||'Close'}</button>
                <button onClick={handleAddCategory} className="btn-primary">Add Category</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {lossConfirm&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)'}} onClick={e=>e.target===e.currentTarget&&setLossConfirm(null)}>
          <div className="card animate-scale-in" style={{width:'min(360px,92vw)',padding:28,textAlign:'center'}}>
            <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(239,68,68,0.12)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',color:'var(--red)'}}><AlertTriangle size={22}/></div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>This product will sell at a loss</div>
            <div style={{fontSize:12.5,color:bodyText,lineHeight:1.5}}>The cost price is higher than the selling price — you'll lose <strong style={{color:'var(--red)'}}>{lossConfirm.lossPct}%</strong> per unit sold. Save it anyway?</div>
            <div style={{display:'flex',gap:10,marginTop:20}}>
              <button onClick={()=>setLossConfirm(null)} className="btn-secondary" style={{flex:1}}>{t('cancel')}</button>
              <button onClick={()=>saveProduct(lossConfirm.data)} className="btn-primary" style={{flex:1,background:'var(--red)',borderColor:'var(--red)'}}>Save Anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
