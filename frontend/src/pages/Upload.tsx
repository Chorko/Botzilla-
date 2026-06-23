import { useState, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ThreeCanvas from '../components/ThreeCanvas'
import './Upload.css'

const STAGES = [
  { key: 'audio_engine', label: 'Transcribing & diarizing audio', icon: '🎙' },
  { key: 'cleaner',      label: 'Cleaning transcript',             icon: '✨' },
  { key: 'slides',       label: 'Extracting slides & frames',      icon: '🖼' },
  { key: 'summary',      label: 'Generating AI summary',           icon: '🧠' },
  { key: 'docx',         label: 'Building Word document',          icon: '📄' },
]

function StageIndicator({ current }: { current: string | null }) {
  return (
    <div className="stage-list">
      {STAGES.map((s, i) => {
        const idx    = STAGES.findIndex(x => x.key === current)
        const done   = idx > i
        const active = s.key === current
        return (
          <motion.div
            key={s.key}
            className={`stage-item ${active ? 'active' : done ? 'done' : ''}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
          >
            <div className="stage-dot">
              {done
                ? <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M2 5.5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                : active
                  ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
              }
            </div>
            <span style={{ fontSize: '0.85rem' }}>{s.icon}</span>
            <span>{s.label}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

export default function Upload() {
  const navigate = useNavigate()
  const [dragging,  setDragging]  = useState(false)
  const [file,      setFile]      = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [stage,     setStage]     = useState<string | null>(null)
  const [logs,      setLogs]      = useState<string[]>([])
  const [error,     setError]     = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const accept   = '.mp3,.mp4,.wav,.m4a,.flac,.mkv,.webm,.mov,.avi,.aac'

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }, [])

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setLogs([])
    setStage(null)

    const form = new FormData()
    form.append('file', file)
    let mid: string | null = null

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const { meeting_id } = await res.json()
      mid = meeting_id
      setMeetingId(meeting_id)

      const es = new EventSource(`/api/progress/${meeting_id}`)
      es.onmessage = (ev) => {
        const msg = ev.data as string
        if (!msg.startsWith('stage:')) setLogs(l => [...l.slice(-20), msg])
        if (msg.startsWith('stage:')) {
          const s = msg.replace('stage:', '').trim()
          if (s === 'complete') { es.close(); setUploading(false); navigate(`/overview/${meeting_id}`) }
          else setStage(s)
        }
        if (msg.startsWith('done:')) { es.close(); setUploading(false); navigate(`/overview/${meeting_id}`) }
        if (msg.startsWith('error:')) { setError(msg.replace('error:', '').trim()); setUploading(false); es.close() }
      }
      es.onerror = () => { es.close(); if (mid) navigate(`/overview/${mid}`) }
    } catch (err: any) {
      setError(err.message)
      setUploading(false)
    }
  }

  const FEATURES = [
    ['🎙', 'WhisperX large-v3'],
    ['👥', 'pyannote 3.1'],
    ['🧠', 'Gemini 2.5 Flash'],
    ['📄', 'Word Report'],
    ['💬', 'Smart Chatbot'],
    ['🖼', 'Slide Extraction'],
  ]

  return (
    <div className="page upload-page">
      {/* Three.js 3D background */}
      <ThreeCanvas />

      {/* Navbar */}
      <nav className="navbar">
        <span className="navbar-logo">
          <span className="navbar-logo-icon">⚡</span>
          Botzilla
        </span>
        <div className="navbar-actions">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
            AI Meeting Intelligence
          </span>
        </div>
      </nav>

      <main className="upload-main container">
        {/* Hero */}
        <motion.div
          className="upload-hero"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="hero-eyebrow">
            ✦ Powered by Gemini 2.5 Flash & WhisperX
          </div>
          <h1 className="hero-title">
            Turn meetings into<br />
            <span className="gradient-text">structured intelligence</span>
          </h1>
          <p className="hero-sub">
            Upload any audio or video. Botzilla transcribes, identifies speakers,
            extracts topics, generates a full AI summary, Word report, and chatbot — in minutes.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!uploading ? (
            <motion.div
              key="dropzone"
              className="drop-zone-wrapper"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16, scale: 0.97 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            >
              <div
                id="drop-zone"
                className={`${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => !file && inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={accept}
                  style={{ display: 'none' }}
                  onChange={e => e.target.files?.[0] && setFile(e.target.files[0])}
                />
                <AnimatePresence mode="wait">
                  {file ? (
                    <motion.div
                      key="file"
                      className="file-preview"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="file-icon">{file.type.startsWith('video') ? '🎬' : '🎵'}</div>
                      <div>
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={e => { e.stopPropagation(); setFile(null) }}
                      >✕</button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="drop-icon-wrap">⬆</div>
                      <div className="drop-title">Drop your recording here</div>
                      <div className="drop-sub">or click to browse · MP3, MP4, WAV, M4A, MKV, FLAC, WEBM</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence>
                {file && (
                  <motion.button
                    id="upload-btn"
                    className="btn btn-primary upload-btn"
                    onClick={handleUpload}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    ⚡ Analyse with Botzilla
                  </motion.button>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <motion.div
                    className="error-box"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    ⚠ {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              className="processing-panel card"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="processing-header">
                <div style={{ position: 'relative', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {/* Pulsing ring */}
                  <div style={{
                    position: 'absolute', inset: -6,
                    border: '2px solid var(--indigo-4)',
                    borderRadius: '50%',
                    animation: 'spin 2s linear infinite',
                    opacity: 0.4,
                  }} />
                  <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' }}>
                    Processing your recording…
                  </div>
                  <div style={{ color: 'var(--text-4)', fontSize: '0.78rem', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    ID: <span style={{ color: 'var(--indigo-2)' }}>{meetingId}</span>
                  </div>
                </div>
              </div>
              <div className="divider" />
              <StageIndicator current={stage} />
              {logs.length > 0 && (
                <motion.div
                  className="log-box"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {logs.slice(-8).map((l, i) => (
                    <div key={i} className="log-line">{l}</div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Feature chips */}
        <motion.div
          className="feature-chips"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
        >
          {FEATURES.map(([icon, label], i) => (
            <motion.div
              key={String(label)}
              className="feature-chip"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06, duration: 0.4 }}
              whileHover={{ y: -3 }}
            >
              <span>{icon}</span><span>{label}</span>
            </motion.div>
          ))}
        </motion.div>
      </main>
    </div>
  )
}
