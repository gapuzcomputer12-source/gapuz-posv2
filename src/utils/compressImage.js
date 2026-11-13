// Compresses a photo client-side before it's uploaded as return evidence —
// no server-side processing involved, so this is the only place the file
// ever gets large or carries EXIF metadata (GPS, device info, etc. — the
// canvas re-encode strips all of that as a side effect, which is a privacy
// win we get for free).

const MAX_DIMENSION = 1280
const MAX_BYTES = 500 * 1024
const QUALITY_STEPS = [0.75, 0.6, 0.5]
const MAX_INPUT_BYTES = 10 * 1024 * 1024

// createImageBitmap(file, {imageOrientation:'from-image'}) both decodes the
// file AND applies its EXIF rotation (a phone photo is otherwise stored
// "sideways" with just an orientation flag) — supported in every current
// browser. The Image+FileReader fallback below is only for genuinely old
// browsers without createImageBitmap support, and does NOT correct EXIF
// rotation itself (that would need a hand-rolled EXIF parser) — an accepted
// gap for that rare path.
async function loadDrawable(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { drawable: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close?.() }
    } catch {
      // Some browsers support createImageBitmap but not the orientation
      // option, or choke on a particular file — fall through to the
      // Image-element path below rather than failing outright.
    }
  }
  return loadViaImageElement(file)
}

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read the image file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode the image file'))
      img.onload = () => resolve({ drawable: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => {} })
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Exported so CameraCaptureModal can turn its captured <canvas> frame into
// a Blob the same way, without reimplementing this.
export function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not encode the compressed image'))),
      'image/jpeg',
      quality
    )
  })
}

// Returns a compressed JPEG Blob — longest side capped at 1280px (never
// upscaled), re-encoded at quality 0.75, dropping to 0.6 then 0.5 only if
// still over 500KB. Whatever the 0.5 attempt produces is returned as-is
// even if still over 500KB (no further steps past that).
export async function compressImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Image is too large — please choose a file under 10 MB')
  }

  const { drawable, width, height, cleanup } = await loadDrawable(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    canvas.getContext('2d').drawImage(drawable, 0, 0, targetW, targetH)

    let blob
    for (const quality of QUALITY_STEPS) {
      blob = await canvasToBlob(canvas, quality)
      if (blob.size <= MAX_BYTES) break
    }
    return blob
  } finally {
    cleanup()
  }
}
