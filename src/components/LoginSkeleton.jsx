import { useLoginMobile } from '../utils/helpers'

const Bar = ({ w='100%', h=12, r=6, style={} }) => (
  <div className="skeleton" style={{ width:w, height:h, borderRadius:r, ...style }}/>
)

export default function LoginSkeleton() {
  const isMobile = useLoginMobile()

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:isMobile?'column':'row', background:'var(--bg)', overflow:isMobile?'visible':'hidden' }}>

      {/* Left panel — branding, mirrors Login.jsx (hidden entirely below 768px) */}
      {!isMobile && (
        <div style={{
          flex:'7', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:26,
          background:'linear-gradient(155deg, var(--accent) 0%, var(--accent2) 100%)',
          padding:48,
        }}>
          <div style={{ width:198, height:198, borderRadius:'50%', background:'rgba(0,0,0,0.1)' }}/>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <Bar w={220} h={22} style={{ background:'rgba(0,0,0,0.12)' }}/>
            <Bar w={140} h={22} style={{ background:'rgba(0,0,0,0.12)' }}/>
            <Bar w={100} h={11} style={{ background:'rgba(0,0,0,0.1)', marginTop:6 }}/>
          </div>
        </div>
      )}

      {/* Right panel — login form, mirrors Login.jsx */}
      <div style={{
        width: isMobile ? '100%' : undefined, flex: isMobile ? 1 : '3',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        background:'var(--bg2)', padding: isMobile ? '32px 16px' : 48,
      }}>
        <div style={{ width:'100%', maxWidth:360 }}>
          <div style={{ marginBottom:14 }}>
            <div style={{ width:30, height:42, borderRadius:8, background:'var(--bg4)' }}/>
          </div>

          <div style={{ marginBottom:28 }}>
            <Bar w="55%" h={20} style={{ marginBottom:8 }}/>
            <Bar w="75%" h={11}/>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:20 }}>
            <div>
              <Bar w={60} h={9} style={{ marginBottom:8 }}/>
              <Bar h={44} r={6}/>
            </div>
            <div>
              <Bar w={70} h={9} style={{ marginBottom:8 }}/>
              <Bar h={44} r={6}/>
            </div>
          </div>

          <Bar h={44} r={6}/>
        </div>
      </div>
    </div>
  )
}
