import { forwardRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { peso, fmtDateTime } from '../utils/helpers'

const Receipt = forwardRef(function Receipt({ txn, role }, ref) {
  if(!txn) return null
  const qrData = JSON.stringify({ id:String(txn.id).padStart(4,'0'), date:txn.createdAt, total:txn.total, shop:'Gapuz POS' })
  return (
    <div id="receipt-printable" ref={ref} style={{ background:'#fff', color:'#000', fontFamily:"'Courier New',monospace", fontSize:11, padding:20, width:300, margin:'0 auto' }}>
      <div style={{textAlign:'center',paddingBottom:10,borderBottom:'1px dashed #ccc',marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700}}>GAPUZ COMPUTER</div>
        <div style={{fontWeight:700}}>SERVICES & ACCESSORIES</div>
        <div style={{fontSize:10,color:'#555'}}>Door 2 NGAP Building, Purok 3</div>
        <div style={{fontSize:10,color:'#555'}}>Tablon, Cagayan de Oro City</div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#555',marginBottom:10}}>
        <span>#{String(txn.id).padStart(4,'0')}</span>
        <span>{fmtDateTime(txn.createdAt)}</span>
      </div>
      <div style={{fontSize:10,color:'#555',marginBottom:10}}>
        Cashier: {txn.cashierName||role} · Customer: {txn.customerName||'Walk-in'}
      </div>
      <div style={{borderTop:'1px dashed #ccc',borderBottom:'1px dashed #ccc',padding:'8px 0',marginBottom:8}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,fontWeight:700,color:'#888',marginBottom:4}}><span>ITEM</span><span>QTY</span><span>AMOUNT</span></div>
        {(txn.items||[]).map((item,i)=>(
          <div key={i} style={{marginBottom:2}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
              <span style={{flex:1}}>{item.name}</span><span style={{margin:'0 8px'}}>x{item.qty}</span><span>{peso(item.price*item.qty)}</span>
            </div>
            {item.serials?.length>0&&<div style={{fontSize:8.5,color:'#888',paddingLeft:4}}>SN: {item.serials.join(', ')}</div>}
            {item.notes&&<div style={{fontSize:8.5,color:'#888',paddingLeft:4,fontStyle:'italic'}}>{item.notes}</div>}
          </div>
        ))}
      </div>
      <div style={{fontSize:10,marginBottom:8}}>
        <div style={{display:'flex',justifyContent:'space-between',color:'#555'}}><span>Subtotal</span><span>{peso(txn.subtotal)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',color:'#555'}}><span>VAT (12%)</span><span>{peso(txn.vat)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',fontWeight:700,fontSize:13,borderTop:'1px solid #ccc',paddingTop:4,marginTop:4}}><span>TOTAL</span><span>{peso(txn.total)}</span></div>
        {txn.payment==='Cash'&&txn.cashGiven>0&&<>
          <div style={{display:'flex',justifyContent:'space-between',color:'#555'}}><span>Cash Given</span><span>{peso(txn.cashGiven)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',fontWeight:600}}><span>Change</span><span>{peso(txn.cashGiven-txn.total)}</span></div>
        </>}
        <div style={{marginTop:4,color:'#555'}}>Payment: {txn.payment}</div>
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',marginBottom:10}}>
        <QRCodeSVG value={qrData} size={80}/>
        <div style={{fontSize:9,color:'#888',marginTop:4}}>Scan for digital receipt</div>
      </div>
      <div style={{textAlign:'center',fontSize:9,color:'#888',borderTop:'1px dashed #ccc',paddingTop:8}}>
        <div>Thank you for shopping at Gapuz!</div>
        <div>Items are non-refundable after 7 days.</div>
        <div style={{marginTop:4}}>Powered by Gapuz POS v3.0</div>
      </div>
    </div>
  )
})
export default Receipt
