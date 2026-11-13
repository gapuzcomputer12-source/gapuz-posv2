import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, X, RotateCcw, AlertTriangle } from 'lucide-react'
import { compressImage } from '../utils/compressImage'
import { uploadEvidencePhoto, deleteEvidencePhoto } from '../store'
import { useToast } from '../utils/toast'
import ImagePreviewModal from './ImagePreviewModal'
import CameraCaptureModal from './CameraCaptureModal'

const MAX_PHOTOS = 3

const fmtSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

let nextLocalId = 0

// Up-to-3 evidence photos for a Return (damaged item, mismatched serial,
// missing parts, etc.) — a single dashed drop zone covers "Take Photo"
// (live camera, CameraCaptureModal), "Upload Files" (file picker), and
// drag-and-drop, all funneling into the same addOrReplacePhoto pipeline:
// compress (utils/compressImage.js) then upload to a per-mount "draft"
// folder, reporting the list of successfully-uploaded storage paths
// upward via onChange. Remount this component (e.g. with a changing
// `key`) to reset it for a new wizard pass.
export default function EvidencePhotoPicker({ onChange }) {
  const toast = useToast()
  const draftId = useRef(crypto.randomUUID())
  const [photos, setPhotos] = useState([]) // {id, previewUrl, status, originalSize, compressedSize, path}
  const photosRef = useRef(photos)
  const galleryInputRef = useRef(null)
  const retakeIdRef = useRef(null)
  const removedIdsRef = useRef(new Set())
  const [viewerIndex, setViewerIndex] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const cameraTargetIdRef = useRef(null) // set when the camera is opened to retake one specific photo
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => { photosRef.current = photos }, [photos])
  // Revoke every still-live object URL on unmount, not on every change —
  // individual removals/retakes already revoke their own URL immediately.
  useEffect(() => () => { photosRef.current.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }, [])

  useEffect(() => { onChange?.(photos.filter(p => p.status === 'done').map(p => p.path)) }, [photos]) // eslint-disable-line

  const processFile = async (file, id) => {
    try {
      const blob = await compressImage(file)
      if (removedIdsRef.current.has(id)) return
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, status: 'uploading', compressedSize: blob.size } : p))

      const path = `${draftId.current}/${Date.now()}-${id}.jpg`
      const { error } = await uploadEvidencePhoto(path, blob)
      if (removedIdsRef.current.has(id)) { if (!error) deleteEvidencePhoto(path); return }
      if (error) { setPhotos(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p)); toast('Failed to upload photo', 'error'); return }
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, status: 'done', path } : p))
    } catch (err) {
      if (removedIdsRef.current.has(id)) return
      setPhotos(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p))
      toast(err.message || 'Could not process that photo', 'error')
    }
  }

  // Shared by the file picker, drag-and-drop, and the live camera
  // ("Take Photo" / "Retake") — forId set = replace that existing photo;
  // unset = append a new one. compressImage validates type/size itself,
  // so no need to duplicate that check here.
  const addOrReplacePhoto = (fileOrBlob, forId) => {
    const previewUrl = URL.createObjectURL(fileOrBlob)
    const isReplacing = forId && photosRef.current.some(p => p.id === forId)

    if (isReplacing) {
      removedIdsRef.current.delete(forId)
      setPhotos(prev => {
        const old = prev.find(p => p.id === forId)
        if (old?.previewUrl) URL.revokeObjectURL(old.previewUrl)
        if (old?.status === 'done' && old.path) deleteEvidencePhoto(old.path)
        return prev.map(p => p.id === forId ? { id: forId, previewUrl, status: 'compressing', originalSize: fileOrBlob.size, compressedSize: null, path: null } : p)
      })
      processFile(fileOrBlob, forId)
    } else {
      const id = `p${nextLocalId++}`
      setPhotos(prev => [...prev, { id, previewUrl, status: 'compressing', originalSize: fileOrBlob.size, compressedSize: null, path: null }])
      processFile(fileOrBlob, id)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type?.startsWith('image/')) { toast('Please choose an image file', 'error'); return }
    const forId = retakeIdRef.current
    retakeIdRef.current = null
    if (!forId && photos.length >= MAX_PHOTOS) { toast(`You can attach up to ${MAX_PHOTOS} photos`, 'error'); return }
    addOrReplacePhoto(file, forId)
  }

  const openGallery = (forId) => { retakeIdRef.current = forId || null; galleryInputRef.current?.click() }
  const openCamera = (forId) => { cameraTargetIdRef.current = forId || null; setCameraOpen(true) }

  const handleCameraCapture = (blob) => {
    const forId = cameraTargetIdRef.current
    if (!forId && photosRef.current.length >= MAX_PHOTOS) return // camera's own maxCaptures already prevents this
    addOrReplacePhoto(blob, forId)
  }

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = () => setDragOver(false)
  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type?.startsWith('image/'))
    if (!files.length) return
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) { toast(`You can attach up to ${MAX_PHOTOS} photos`, 'error'); return }
    files.slice(0, remaining).forEach(f => addOrReplacePhoto(f, null))
  }

  const removePhoto = (id) => {
    removedIdsRef.current.add(id)
    setPhotos(prev => {
      const p = prev.find(x => x.id === id)
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
      if (p?.status === 'done' && p.path) deleteEvidencePhoto(p.path)
      return prev.filter(x => x.id !== id)
    })
  }

  // Retaking one specific photo is always a single shot; adding new
  // photos from scratch allows a short multi-capture session, capped so
  // it can never push the total past MAX_PHOTOS.
  const cameraMaxCaptures = cameraTargetIdRef.current ? 1 : Math.max(1, MAX_PHOTOS - photos.length)

  return (
    <div>
      <input ref={galleryInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />

      {photos.length < MAX_PHOTOS && (
        <>
          <div
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 10, minHeight: 120,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16,
              background: dragOver ? 'var(--accent-tint)' : 'var(--bg3)', transition: 'background .15s, border-color .15s',
            }}
          >
            <Camera size={22} style={{ color: 'var(--text3)' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>Take a photo or upload</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => openCamera(null)} className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Camera size={13} />Take Photo
              </button>
              <button onClick={() => openGallery(null)} className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Upload size={13} />Upload Files
              </button>
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 6, lineHeight: 1.5 }}>
            Show the item, the defect, and the serial number sticker. Max {MAX_PHOTOS} photos.
          </div>
        </>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${MAX_PHOTOS}, 1fr)`, gap: 8, marginTop: photos.length < MAX_PHOTOS ? 10 : 0 }}>
          {photos.map((p, i) => (
            <div key={p.id}>
              <div onClick={() => setViewerIndex(i)} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)', background: 'var(--bg3)', cursor: 'pointer' }}>
                <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: p.status === 'done' ? 1 : 0.5 }} />
                {(p.status === 'compressing' || p.status === 'uploading') && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
                  </div>
                )}
                {p.status === 'error' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.3)' }}>
                    <AlertTriangle size={16} color="#fff" />
                  </div>
                )}
                <button onClick={e => { e.stopPropagation(); openCamera(p.id) }} aria-label="Retake" title="Retake" style={{ position: 'absolute', top: 3, left: 3, width: 20, height: 20, borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RotateCcw size={11} /></button>
                <button onClick={e => { e.stopPropagation(); removePhoto(p.id) }} aria-label="Remove" title="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'center', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.status === 'done' && p.compressedSize != null ? `${fmtSize(p.originalSize)} → ${fmtSize(p.compressedSize)}` : p.status === 'error' ? 'Upload failed' : p.status === 'uploading' ? 'Uploading…' : 'Compressing…'}
              </div>
            </div>
          ))}
        </div>
      )}

      <ImagePreviewModal open={viewerIndex != null} onClose={() => setViewerIndex(null)} startIndex={viewerIndex || 0} images={photos.map(p => p.previewUrl)} />
      <CameraCaptureModal open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={handleCameraCapture} maxCaptures={cameraMaxCaptures} />
    </div>
  )
}
