// Tiny Web Audio beep generator for the POS scan pill (ScanResultPill) —
// plain oscillator tones, no audio asset, so this works offline and ships
// zero bytes. One shared AudioContext, created lazily on first use (most
// browsers refuse to start one before a user gesture, which a scan/submit
// action already is).
let ctx = null
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

function tone(freq, duration, startAt = 0) {
  const audioCtx = getCtx()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const t0 = audioCtx.currentTime + startAt
  gain.gain.setValueAtTime(0.16, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + duration)
}

// kind: 'success' (short high beep) | 'error' (low double beep). Anything
// else (e.g. the 'duplicate'/already-in-cart tone) is intentionally silent
// — only these two are specced.
export function playScanBeep(kind) {
  try {
    if (kind === 'success') tone(1200, 0.09)
    else if (kind === 'error') { tone(280, 0.09); tone(280, 0.09, 0.14) }
  } catch {
    // AudioContext blocked/unavailable (autoplay policy, unsupported
    // browser) — never let a beep failure interrupt the scan flow.
  }
}
