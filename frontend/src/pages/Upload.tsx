import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
          <div key={s.key} className={`stage-item ${active ? 'active' : done ? 'done' : ''}`}>
            <div className="stage-dot">
              {done
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                : active
                  ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>{String(i + 1).padStart(2,'0')}</span>
              }
            </div>
            <span className="stage-icon" style={{ fontSize: '0.9rem' }}>{s.icon}</span>
            <span>{s.label}</span>
          </div>
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

  const accept = '.mp3,.mp4,.wav,.m4a,.flac,.mkv,.webm,.mov,.avi,.aac'

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
        // Filter out raw stage: messages from log display
        if (!msg.startsWith('stage:')) {
          setLogs(l => [...l.slice(-20), msg])
        }
        if (msg.startsWith('stage:')) {
          const s = msg.replace('stage:', '')
          if (s === 'complete') {
            es.close()
            setUploading(false)
            navigate(`/overview/${meeting_id}`)
          } else {
            setStage(s)
          }
        }
        if (msg.startsWith('done:')) {
          es.close()
          setUploading(false)
          navigate(`/overview/${meeting_id}`)
        }
        if (msg.startsWith('error:')) {
          setError(msg.replace('error:', '').trim())
          setUploading(false)
          es.close()
        }
      }
      es.onerror = () => {
        es.close()
        // Navigate to overview if we got a meeting_id (pipeline may have completed)
        if (mid) navigate(`/overview/${mid}`)
      }
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
      {/* Background */}
      <div className="grid-bg" />
      <div className="upload-bg">
        <div className="upload-orb orb-1" />
        <div className="upload-orb orb-2" />
        <div className="upload-orb orb-3" />
      </div>

      {/* Navbar */}
      <nav className="navbar">
        <span className="navbar-logo">
          <span className="navbar-logo-icon">⚡</span>
          Botzilla
        </span>
        <div className="navbar-actions">
          <span style={{ color: 'var(--t-3)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            AI Meeting Intelligence
          </span>
        </div>
      </nav>

      {/* Main content */}
      <main className="upload-main container">
        <div className="upload-hero fade-in">
          <div className="hero-badge">
            ✦ Gemini 2.5 Flash · WhisperX · pyannote
          </div>
          <h1 className="hero-title">
            Turn meetings into<br />
            <span className="gradient-text">structured intelligence</span>
          </h1>
          <p className="hero-sub">
            Upload any audio or video. Botzilla transcribes, identifies speakers,
            maps topics, generates a full summary, Word report, and smart chatbot — in minutes.
          </p>
        </div>

        {!uploading ? (
          <div className="drop-zone-wrapper fade-in fade-in-2">
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
              {file ? (
                <div className="file-preview">
                  <div className="file-icon">{file.type.startsWith('video') ? '🎬' : '🎵'}</div>
                  <div>
                    <div className="file-name">{file.name}</div>
                    <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
                    onClick={e => { e.stopPropagation(); setFile(null) }}
                  >✕ Remove</button>
                </div>
              ) : (
                <>
                  <div className="drop-icon">⬆</div>
                  <div className="drop-title">Drop your recording here</div>
                  <div className="drop-sub">or click to browse · MP3, MP4, WAV, M4A, MKV, FLAC, WEBM</div>
                </>
              )}
            </div>

            {file && (
              <button
                id="upload-btn"
                className="btn btn-primary upload-btn fade-in"
                onClick={handleUpload}
              >
                <span>⚡</span> Analyse with Botzilla
              </button>
            )}

            {error && (
              <div className="error-box fade-in">
                <span>⚠</span> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="processing-panel card fade-in">
            <div className="processing-header">
              <div style={{ position: 'relative', width: 40, height: 40 }}>
                <div style={{
                  width: 40, height: 40,
                  border: '2px solid rgba(99,102,241,0.15)',
                  borderTop: '2px solid var(--p)',
                  borderRight: '2px solid var(--a)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--t-0)' }}>
                  Processing your recording…
                </div>
                <div style={{ color: 'var(--t-3)', fontSize: '0.78rem', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                  ID: <span style={{ color: 'var(--a)' }}>{meetingId}</span>
                </div>
              </div>
            </div>
            <div className="divider" />
            <StageIndicator current={stage} />
            {logs.length > 0 && (
              <div className="log-box">
                {logs.slice(-8).map((l, i) => (
                  <div key={i} className="log-line">{l}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feature chips */}
        <div className="feature-chips fade-in fade-in-3">
          {FEATURES.map(([icon, label]) => (
            <div key={String(label)} className="feature-chip">
              <span>{icon}</span><span>{label}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
