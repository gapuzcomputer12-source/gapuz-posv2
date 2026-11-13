import { useRef, useState, useEffect } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Banknote, Smartphone, CreditCard, Zap, ShoppingCart, Package, AlertTriangle, Mail, Printer, Check, PauseCircle, X } from 'lucide-react'
import { useCartStore, useAuthStore, useTransactionStore, useProductStore, useCustomerStore } from '../store'
import { supabase } from '../lib/supabaseClient'
import { peso, fmtTxnId, useT, useBreakpoint } from '../utils/helpers'
import { useToast } from '../utils/toast'
import Receipt from './Receipt'
import ProductThumb from './ProductThumb'
import Modal from './Modal'

const PAY = [{id:'Cash',label:'Cash',icon:Banknote},{id:'GCash',label:'GCash',icon:Smartphone},{id:'Card',label:'Card',icon:CreditCard}]

export default function Cart({ products, customers, onHold }) {
  const { items, discount, payMethod, customerId, splitMode, split1Pay, split2Pay, split1Amt,
          removeItem, removeSerialFromItem, setQty, clearCart, setDiscount, setPayMethod, setCustomer,
          setSplitMode, setSplit1Pay, setSplit2Pay, setSplit1Amt, getTotals } = useCartStore()
  const { user, role } = useAuthStore()
  const addTransaction = useTransactionStore(s=>s.addTransaction)
  const deductStock    = useProductStore(s=>s.deductStock)
  const addPoints      = useCustomerStore(s=>s.addPoints)
  const toast = useToast()
  const t     = useT()
  const { isMobile } = useBreakpoint()

  const [cashGiven,   setCashGiven]   = useState('')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [step,        setStep]        = useState('method') // 'method' | 'processing' | 'success'
  const [changeDue,   setChangeDue]   = useState(0)
  const [changeAcked, setChangeAcked] = useState(false)
  const [lastTxn,     setLastTxn]     = useState(null)
  const [emailReceipt, setEmailReceipt] = useState(false)
  const [customerEmail, setCustomerEmail] = useState('')
  const receiptRef = useRef()
  const handlePrint = useReactToPrint({content:()=>receiptRef.current})

  const { subtotal, discAmt, vat, total, totalInt } = getTotals()
  const change = cashGiven ? parseFloat(cashGiven)-totalInt : 0
  const totalItems = items.reduce((s,i)=>s+i.qty,0)
  const cust = customers.find(c=>c.id===customerId)

  const [checkingOut, setCheckingOut] = useState(false)

  const openCheckout = () => { if(!items.length) return; setStep('method'); setCheckoutOpen(true) }
  const cancelCheckout = () => setCheckoutOpen(false)

  const handleCompletePayment = async () => {
    if(checkingOut) return
    if(!splitMode&&payMethod==='Cash'){
      if(!cashGiven.trim()){toast('Please enter the cash given','error');return}
      if(parseFloat(cashGiven)<totalInt){toast('Cash given is less than total!','error');return}
    }
    // Defensive: every serialized line's unit count must come from scanned
    // serials, never a bare qty — addSerialItem/removeSerialFromItem keep
    // these in sync, so this should never actually fire.
    const badLine = items.find(i=>i.hasSerial && (i.serials?.length||0)!==i.qty)
    if(badLine){ toast(`${badLine.name} is missing a scanned serial for one of its units`,'error'); return }

    setCheckingOut(true)
    setStep('processing')
    const payDesc = splitMode?`${split1Pay}+${split2Pay}`:payMethod
    const [txn] = await Promise.all([
      addTransaction({
        customerName: cust?cust.name:'Walk-in',
        customerId:   customerId||null,
        payment:      payDesc,
        subtotal, discAmt, vat, total:totalInt,
        cashGiven:    payMethod==='Cash'?parseFloat(cashGiven):0,
        status:       'Completed',
        cashierName:  user?.user_metadata?.name||'Cashier',
        items:        [...items],
      }),
      new Promise(r=>setTimeout(r,650)),
    ])
    if(!txn) { setCheckingOut(false); toast('Checkout failed — please try again','error'); setStep('method'); return }

    // Serials are stamped Sold BEFORE stock is deducted — if this fails,
    // the sale never actually happened, so it's voided and nothing else
    // (stock, loyalty points) should run.
    const serializedItems = items.filter(i=>i.hasSerial && i.serials?.length)
    if(serializedItems.length){
      const { error: serialErr } = await supabase.rpc('mark_serials_sold', {
        p_transaction_id: txn.id,
        p_items: serializedItems.map(i=>({ product_id:i.id, serials:i.serials })),
      })
      if(serialErr){
        await supabase.rpc('void_failed_sale', { p_transaction_id: txn.id })
        setCheckingOut(false)
        toast(`Checkout failed: ${serialErr.message}`,'error')
        setStep('method')
        return
      }
    }

    setCheckingOut(false)
    deductStock(items)
    if(cust) addPoints(cust.id, totalInt)
    setLastTxn({...txn})
    toast(`${t('payment_success')} ${fmtTxnId(txn.id)} — ${peso(totalInt)}`,'success')
    if(!splitMode&&payMethod==='Cash'&&change>0){ setChangeDue(change); setChangeAcked(false) }
    else { setReceiptPrinted(false); setChangeAcked(true) }
    setStep('success')
  }

  const [receiptPrinted, setReceiptPrinted] = useState(false)
  const [actionsVisible, setActionsVisible] = useState(false)
  const confirmChangeGiven = () => { setReceiptPrinted(false); setChangeAcked(true) }

  useEffect(() => {
    if(step==='success' && changeAcked){
      setActionsVisible(true)
      setReceiptPrinted(true)
    }
  }, [step, changeAcked])

  const finishTransaction = () => {
    setCheckoutOpen(false)
    setStep('method')
    clearCart(); setCashGiven(''); setSplitMode(false); setSplit1Amt(''); setEmailReceipt(false); setCustomerEmail('')
    setChangeAcked(false); setLastTxn(null)
  }

  const [sendingReceipt, setSendingReceipt] = useState(false)
  const sendEmailReceipt = async () => {
    if(!customerEmail || sendingReceipt) return
    setSendingReceipt(true)
    const { error } = await supabase.functions.invoke('send-receipt', { body: { email: customerEmail, txn: lastTxn } })
    setSendingReceipt(false)
    if(error) toast('Failed to send receipt email','error')
    else toast(`Receipt sent to ${customerEmail}`,'success')
  }
  const border = '1px solid var(--border)'

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg2)',borderLeft:isMobile?'none':border,borderTop:isMobile?border:'none'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:border,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:15,fontWeight:700}}>{t('cart')}</span>
          {totalItems>0&&<span style={{background:'var(--accent)',color:'#0a0a0a',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:99,fontFamily:"'JetBrains Mono',monospace"}}>{totalItems}</span>}
        </div>
        <div style={{display:'flex',gap:6}}>
          {onHold&&items.length>0&&<button onClick={onHold} style={{padding:'4px 10px',borderRadius:7,border:'1px solid var(--border2)',background:'var(--bg3)',color:'var(--text2)',cursor:'pointer',fontSize:11,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5}}><PauseCircle size={12}/>Hold</button>}
          {items.length>0&&<button onClick={clearCart} style={{padding:'4px 10px',borderRadius:7,border:'1px solid rgba(239,68,68,0.25)',background:'rgba(239,68,68,0.08)',color:'var(--red)',cursor:'pointer',fontSize:11,fontWeight:600}}>{t('clear')}</button>}
        </div>
      </div>

      {/* Items */}
      <div style={{flex:1,overflowY:'auto',padding:10}}>
        {items.length===0
          ? <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text3)',gap:8}}><ShoppingCart size={36} style={{opacity:.2}}/><span>{t('empty_cart')}</span><span style={{fontSize:11}}>{t('click_to_add')}</span></div>
          : items.map(item=>{
            const prod = products.find(p=>p.id===item.id)
            return (
              <div key={item.id} style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',marginBottom:6}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      <ProductThumb image={item.image} icon={item.icon} category={item.category} size={24} radius={6}/>
                      <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{item.name}</span>
                    </div>
                    <div style={{fontSize:10,color:'var(--text3)',fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{peso(item.price)} each</div>
                  </div>
                  <button onClick={()=>removeItem(item.id)} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18,lineHeight:1}} onMouseEnter={e=>e.target.style.color='var(--red)'} onMouseLeave={e=>e.target.style.color='var(--text3)'}>×</button>
                </div>
                {item.hasSerial ? (
                  <div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:6}}>
                      {(item.serials||[]).map(sn=>(
                        <span key={sn} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10.5,fontFamily:"'JetBrains Mono',monospace",fontWeight:600,padding:'3px 5px 3px 8px',borderRadius:99,background:'var(--bg4)',border:'1px solid var(--border2)',color:'var(--text2)'}}>
                          {sn}
                          <button onClick={()=>removeSerialFromItem(item.id,sn)} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',display:'flex',padding:1}} onMouseEnter={e=>e.currentTarget.style.color='var(--red)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text3)'}><X size={10}/></button>
                        </span>
                      ))}
                    </div>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>{item.qty} unit{item.qty===1?'':'s'}</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:'var(--accent)'}}>{peso(item.price*item.qty)}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      {[-1,1].map(d=>{
                        const isMinus = d<0
                        return (
                          <button key={d} onClick={()=>setQty(item.id,item.qty+d,prod?.stock||99)} style={{order:isMinus?0:2,width:26,height:26,borderRadius:7,border:'1px solid var(--border2)',background:'var(--bg4)',color:'var(--text2)',cursor:'pointer',fontSize:14,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',transition:'all .12s'}} onMouseEnter={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='#0a0a0a';e.currentTarget.style.borderColor='var(--accent)'}} onMouseLeave={e=>{e.currentTarget.style.background='var(--bg4)';e.currentTarget.style.color='var(--text2)';e.currentTarget.style.borderColor='var(--border2)'}}>{isMinus?'−':'+'}</button>
                        )
                      })}
                      <input type="number" min="1" max={prod?.stock||99} value={item.qty} className="qty-input"
                        onChange={e=>{ const v=parseInt(e.target.value); setQty(item.id, isNaN(v)?1:v, prod?.stock||99) }}
                        onFocus={e=>e.target.select()}
                        style={{order:1,width:48,height:26,textAlign:'center',fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,border:'1px solid var(--border2)',borderRadius:7,background:'var(--bg4)',color:'var(--text)',padding:'0 2px',outline:'none',flexShrink:0}}/>
                    </div>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:'var(--accent)'}}>{peso(item.price*item.qty)}</span>
                  </div>
                )}
              </div>
            )
          })
        }
      </div>

      {/* Customer */}
      <div style={{padding:'8px 12px',borderTop:border,flexShrink:0}}>
        <select className="select-field" style={{fontSize:12}} value={customerId||''} onChange={e=>setCustomer(e.target.value?parseInt(e.target.value):null)}>
          <option value="">{t('walk_in')}</option>
          {customers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.points} pts)</option>)}
        </select>
      </div>

      {/* Totals & payment */}
      <div style={{padding:'10px 14px 14px',borderTop:border,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
        {/* Discount */}
        <div style={{display:'flex',gap:6}}>
          <input type="number" min="0" className="input-field" style={{fontSize:12,padding:'7px 10px'}} placeholder={t('discount')} value={discount.value||''} onChange={e=>setDiscount(parseFloat(e.target.value)||0,discount.type)}/>
          <select className="select-field" style={{width:64,fontSize:12,padding:'7px 8px'}} value={discount.type} onChange={e=>setDiscount(discount.value,e.target.value)}>
            <option value="pct">%</option>
            <option value="fixed">₱</option>
          </select>
        </div>

        {/* Summary */}
        <div style={{fontSize:12,display:'flex',flexDirection:'column',gap:4}}>
          <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>{t('subtotal')}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(subtotal)}</span></div>
          {discAmt>0&&<div style={{display:'flex',justifyContent:'space-between',color:'var(--red)'}}><span>{t('discount')}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>-{peso(discAmt)}</span></div>}
          <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>{t('vat')}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(vat)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontWeight:700,fontSize:16,borderTop:'1px solid var(--border)',paddingTop:7,marginTop:3}}>
            <span>{t('total')}</span>
            <span style={{fontFamily:"'JetBrains Mono',monospace",color:'var(--accent)'}}>{peso(totalInt)}</span>
          </div>
        </div>

        {/* Checkout */}
        <button onClick={openCheckout} disabled={items.length===0} style={{width:'100%',padding:13,borderRadius:10,border:'none',background:items.length===0?'var(--bg4)':'var(--accent)',color:items.length===0?'var(--text3)':'var(--accent-dark)',fontWeight:800,fontSize:14,cursor:items.length===0?'not-allowed':'pointer',fontFamily:'inherit',transition:'all .18s'}}>
          {t('checkout')} — {peso(totalInt)}
        </button>
      </div>

      {/* ══════════ CHECKOUT MODAL ══════════ */}
      {checkoutOpen&&(
        <Modal open onClose={cancelCheckout} closeOnBackdrop={false} closeOnEsc={false}>

          {/* STEP 1 — Payment method */}
          {step==='method'&&(
            <div className="card animate-scale-in" style={{width:'min(440px,94vw)',maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 50px rgba(0,0,0,0.25)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 20px',borderBottom:border,flexShrink:0}}>
                <div style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>Checkout</div>
                <button onClick={cancelCheckout} aria-label="Close" style={{width:28,height:28,borderRadius:8,border:'none',background:'var(--bg3)',color:'var(--text3)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
              </div>

              <div style={{overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:16}}>
                {/* Order summary — totals only; the itemized receipt only appears on the success step */}
                <div>
                  <div className="section-title" style={{marginBottom:8}}>Order Summary</div>
                  <div style={{border,borderRadius:10,overflow:'hidden'}}>
                    <div style={{padding:'10px 12px',background:'var(--bg3)',fontSize:12.5,display:'flex',flexDirection:'column',gap:4}}>
                      <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>{totalItems} item{totalItems===1?'':'s'}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(subtotal)}</span></div>
                      {discAmt>0&&<div style={{display:'flex',justifyContent:'space-between',color:'var(--red)'}}><span>{t('discount')}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>-{peso(discAmt)}</span></div>}
                      <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>{t('vat')}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(vat)}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,fontSize:16,borderTop:'1px solid var(--border2)',paddingTop:7,marginTop:3}}>
                        <span>{t('total')}</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:'var(--accent)'}}>{peso(totalInt)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment method cards */}
                <div>
                  <div className="section-title" style={{marginBottom:8}}>Payment Method</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                    {[...PAY,{id:'Split',label:'Split Payment',icon:Zap}].map(m=>{
                      const active = m.id==='Split' ? splitMode : (!splitMode&&payMethod===m.id)
                      return (
                        <button key={m.id} onClick={()=>m.id==='Split'?setSplitMode(true):(setSplitMode(false),setPayMethod(m.id))}
                          style={{padding:'12px 10px',borderRadius:10,border:'1.5px solid',fontSize:12.5,fontWeight:700,cursor:'pointer',transition:'all .15s',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:7,
                            ...(active?{borderColor:'var(--accent)',background:'var(--accent-tint)',color:'var(--accent)'}:{borderColor:'var(--border)',background:'transparent',color:'var(--text2)'})}}>
                          <m.icon size={15}/>{m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Method-specific details */}
                {splitMode ? (
                  <div>
                    <div className="section-title" style={{marginBottom:8}}>Split Between</div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      <div style={{display:'flex',gap:8}}>
                        <select className="select-field" style={{width:110,fontSize:12.5}} value={split1Pay} onChange={e=>setSplit1Pay(e.target.value)}>{['Cash','GCash','Card'].map(m=><option key={m}>{m}</option>)}</select>
                        <input type="number" className="input-field" style={{fontFamily:"'JetBrains Mono',monospace"}} placeholder="Amount (₱)" value={split1Amt} onChange={e=>setSplit1Amt(e.target.value)}/>
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <select className="select-field" style={{width:110,fontSize:12.5}} value={split2Pay} onChange={e=>setSplit2Pay(e.target.value)}>{['GCash','Cash','Card'].map(m=><option key={m}>{m}</option>)}</select>
                        <div className="input-field" style={{fontFamily:"'JetBrains Mono',monospace",color:'var(--text2)',display:'flex',alignItems:'center'}}>{peso(Math.max(0,totalInt-(parseFloat(split1Amt)||0)))}</div>
                      </div>
                    </div>
                  </div>
                ) : payMethod==='Cash' ? (
                  <div>
                    <div className="section-title" style={{marginBottom:8}}>Cash Payment</div>
                    <input type="number" className="input-field" style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,marginBottom:10}} placeholder={t('cash_given')} value={cashGiven} onChange={e=>setCashGiven(e.target.value)}/>
                    <div style={{background:'var(--bg3)',border,borderRadius:10,padding:'10px 14px',display:'flex',flexDirection:'column',gap:5,fontSize:13}}>
                      <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>Total Amount</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:'var(--text)'}}>{peso(totalInt)}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',color:'var(--text2)'}}><span>Cash Received</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:'var(--text)'}}>{cashGiven?peso(parseFloat(cashGiven)||0):'—'}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,borderTop:'1px solid var(--border2)',paddingTop:6,marginTop:1}}>
                        <span style={{color:'var(--text)'}}>Change</span>
                        <span style={{fontFamily:"'JetBrains Mono',monospace",color:cashGiven&&change<0?'var(--red)':'var(--green)'}}>{cashGiven?peso(Math.max(0,change)):'—'}</span>
                      </div>
                    </div>
                    {cashGiven&&change<0&&<div style={{marginTop:8,fontSize:11.5,color:'var(--red)',fontWeight:600,display:'flex',alignItems:'center',gap:5}}><AlertTriangle size={13}/>Cash received is less than the total amount.</div>}
                  </div>
                ) : payMethod==='GCash' ? (
                  <div style={{textAlign:'center',background:'var(--bg3)',border,borderRadius:10,padding:'20px 16px'}}>
                    <Smartphone size={28} style={{marginBottom:8,color:'var(--text2)'}}/>
                    <div style={{fontWeight:700,fontSize:13.5,color:'var(--text)',marginBottom:4}}>Confirm GCash Payment</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>Verify the customer's GCash payment of <strong style={{color:'var(--text2)'}}>{peso(totalInt)}</strong> before completing.</div>
                  </div>
                ) : (
                  <div style={{textAlign:'center',background:'var(--bg3)',border,borderRadius:10,padding:'20px 16px'}}>
                    <CreditCard size={28} style={{marginBottom:8,color:'var(--text2)'}}/>
                    <div style={{fontWeight:700,fontSize:13.5,color:'var(--text)',marginBottom:4}}>Confirm Card Payment</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>Verify the card payment of <strong style={{color:'var(--text2)'}}>{peso(totalInt)}</strong> before completing.</div>
                  </div>
                )}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr',gap:10,padding:'16px 20px',borderTop:border,flexShrink:0}}>
                <button onClick={cancelCheckout} className="btn-secondary" style={{padding:12}}>Cancel</button>
                {(() => {
                  const cashRequired = !splitMode && payMethod==='Cash' && (!cashGiven.trim() || change<0)
                  const blocked = cashRequired || checkingOut
                  return (
                    <button onClick={handleCompletePayment} disabled={blocked} className="btn-primary" style={{padding:12,opacity:blocked?0.5:1,cursor:blocked?'not-allowed':'pointer'}}>
                      Complete Payment — {peso(totalInt)}
                    </button>
                  )
                })()}
              </div>
            </div>
          )}

          {/* STEP 2 — Processing */}
          {step==='processing'&&(
            <div className="card animate-scale-in" style={{width:'min(320px,92vw)',padding:'40px 28px',textAlign:'center'}}>
              <svg className="animate-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" style={{margin:'0 auto 18px'}}>
                <circle cx="12" cy="12" r="10" stroke="var(--border2)" strokeWidth="3"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <div style={{fontWeight:700,fontSize:15,color:'var(--text)'}}>Processing Payment…</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Please wait a moment</div>
            </div>
          )}

          {/* STEP 3 — Success + Receipt */}
          {step==='success'&&(
            <div className="animate-scale-in" style={{width: isMobile || !changeAcked ? 'min(380px,94vw)' : 'min(700px,94vw)', maxHeight:'90vh',overflowY:'auto',margin:'0 auto'}}>
              <div style={{display:'grid',gridTemplateColumns:isMobile||!changeAcked?'1fr':'1fr 300px',gap:isMobile?20:28,alignItems:'start'}}>

                {/* LEFT — success info + actions (this column's content swaps; layout size never jumps) */}
                <div className="card" style={{padding:20}}>
                  <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:20}}>
                    <div className="animate-pop" style={{width:52,height:52,flexShrink:0,borderRadius:'50%',background:'var(--accent-tint)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div>
                      <div style={{fontWeight:800,fontSize:17,color:'var(--text)'}}>Payment Successful!</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:24,color:'var(--accent)'}}>{peso(totalInt)}</div>
                    </div>
                  </div>

                  {!changeAcked ? (
                    <div>
                      <div className="animate-pop" style={{
                          padding:'22px 18px', borderRadius:16, textAlign:'center', marginBottom:16,
                          background:'linear-gradient(155deg, rgba(245,158,11,0.16), rgba(245,158,11,0.05))',
                          border:'1.5px solid rgba(245,158,11,0.4)',
                          boxShadow:'0 8px 28px rgba(245,158,11,0.18)',
                        }}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:11,fontWeight:800,color:'var(--yellow)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:8}}>
                          <Banknote size={15}/> Change Due to Customer
                        </div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:44,fontWeight:800,color:'var(--yellow)',lineHeight:1,textShadow:'0 2px 12px rgba(245,158,11,0.35)'}}>{peso(changeDue)}</div>
                        <div style={{fontSize:11.5,color:'var(--text3)',marginTop:10}}>Please hand this amount back to the customer</div>
                      </div>
                      <button onClick={confirmChangeGiven} className="btn-primary" style={{width:'100%',padding:12,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Check size={15}/>Change Given — Continue</button>
                    </div>
                  ) : (
                    /* Email + actions — revealed once the receipt finishes printing */
                    <div style={{opacity:actionsVisible?1:0,transition:'opacity .4s ease',pointerEvents:actionsVisible?'auto':'none'}}>
                      {/* Email receipt option */}
                      <div style={{padding:'10px 12px',borderRadius:10,border,background:'var(--bg3)'}}>
                        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12.5,fontWeight:600,color:'var(--text)'}}>
                          <input type="checkbox" checked={emailReceipt} onChange={e=>setEmailReceipt(e.target.checked)} style={{width:15,height:15,accentColor:'var(--accent)',cursor:'pointer'}}/>
                          <Mail size={13} style={{verticalAlign:-2,marginRight:2}}/>Email this receipt to the customer
                        </label>
                        {emailReceipt&&(
                          <div style={{display:'flex',gap:6,marginTop:10}}>
                            <input type="email" className="input-field" style={{fontSize:12,padding:'8px 10px'}} placeholder="customer@gmail.com" value={customerEmail} onChange={e=>setCustomerEmail(e.target.value)}/>
                            <button onClick={sendEmailReceipt} disabled={!customerEmail||sendingReceipt} className="btn-secondary" style={{padding:'8px 14px',fontSize:12,opacity:customerEmail&&!sendingReceipt?1:.5,cursor:customerEmail&&!sendingReceipt?'pointer':'not-allowed'}}>{sendingReceipt?'Sending…':'Send'}</button>
                          </div>
                        )}
                      </div>

                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}>
                        <button onClick={finishTransaction} className="btn-secondary" style={{padding:10}}>{t('close')}</button>
                        <button onClick={handlePrint} className="btn-secondary" style={{padding:10,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Printer size={14}/>{t('print')}</button>
                      </div>
                      <button onClick={finishTransaction} className="btn-primary" style={{width:'100%',padding:12,marginTop:8}}>New Transaction</button>
                    </div>
                  )}
                </div>

                {/* RIGHT — printed receipt. Only takes up grid space once the change has been
                    acknowledged, so the pending "Change Due" box stays centered in a single column. */}
                {changeAcked&&(
                  <div key={lastTxn?.id} className="animate-fade-up" style={{display:'flex',flexDirection:'column',justifySelf:isMobile?'stretch':'center'}}>
                    <div className="receipt-slot"/>
                    <div className={`receipt-printer${receiptPrinted?' open':''}`}>
                      <div className="receipt-printer-inner">
                        <div className="receipt-paper">
                          <Receipt ref={receiptRef} txn={lastTxn} role={role}/>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
