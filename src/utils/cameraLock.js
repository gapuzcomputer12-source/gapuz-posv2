// Coordinates access to the device camera for evidence-photo capture.
// Acquiring the lock stops whichever capture currently holds it, so the
// browser never has two getUserMedia streams open on the same camera.
let activeRelease = null

export function acquireCamera(stopFn) {
  if (activeRelease && activeRelease !== stopFn) activeRelease()
  activeRelease = stopFn
}

export function releaseCamera(stopFn) {
  if (activeRelease === stopFn) activeRelease = null
}
