// Only one feature in this app can hold the device camera at a time — the
// barcode scanner's live preview (ScanInput.jsx) or the evidence-photo
// capture modal (CameraCaptureModal.jsx). Acquiring the lock forcibly
// stops whichever one held it before, so the browser never has two
// getUserMedia streams open on the same camera at once.
let activeRelease = null

export function acquireCamera(stopFn) {
  if (activeRelease && activeRelease !== stopFn) activeRelease()
  activeRelease = stopFn
}

export function releaseCamera(stopFn) {
  if (activeRelease === stopFn) activeRelease = null
}
