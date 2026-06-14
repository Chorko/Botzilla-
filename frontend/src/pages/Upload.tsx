import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './Upload.css'

const STAGES = [
  { key: 'audio_engine', label: 'Transcribing & diarizing audio' },
  { key: 'cleaner',      label: 'Cleaning transcript (LLM #1)' },
  { key: 'slides',       label: 'Extracting slides' },
  { key: 'summary',      label: 'Generating summary (LLM #2)' },
  { key: 'docx',         label: 'Building Word document' },
]

function StageIndicator({ current }: { current: string | null }) {
  return (
    <div className="stage-list">
      {STAGES.map((s, i) => {
        const idx  = STAGES.findIndex(x => x.key === current)
        const done = idx > i
        const active = s.key === current
        return (
          <div key={s.key} className={`stage-item ${active ? 'active' : done ? 'done' : ''}`}>
            <div className="stage-dot">
              {done ? '✓' : active ? <span className="spinner" style={{ width: 10, height: 10 }} /> : i + 1}
            </div>
            <span>{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Upload() {
  const navigate = useNavigate()
  const [dragging, setDragging]     = useState(false)
  const [file, setFile]             = useState<File | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [meetingId, setMeetingId]   = useState<string | null>(null)
  const [stage, setStage]           = useState<string | null>(null)
  const [logs, setLogs]             = useState<string[]>([])
  const [error, setError]           = useState<string | null>(null)
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

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const { meeting_id } = await res.json()
      setMeetingId(meeting_id)

      // Subscribe to SSE progress
      const es = new EventSource(`/api/progress/${meeting_id}`)
      es.onmessage = (ev) => {
        const msg = ev.data as string
        setLogs(l => [...l, msg])

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
        if (msg.startsWith('error:')) {
          setError(msg.replace('error:', ''))
          setUploading(false)
          es.close()
        }
      }
      es.onerror = () => {
        if (meetingId) navigate(`/overview/${meeting_id}`)
        es.close()
      }
    } catch (err: any) {
      setError(err.message)
      setUploading(false)
    }
  }

  return (
    <div className="page upload-page">
      {/* Ambient background */}
      <div className="upload-bg">
        <div className="upload-orb orb-1" />
        <div className="upload-orb orb-2" />
        <div className="upload-orb orb-3" />
      </div>

      {/* Navbar */}
      <nav className="navbar">
        <span className="navbar-logo">⚡ Botzilla</span>
        <div className="navbar-actions">
          <span style={{ color: 'var(--c-text-subtle)', fontSize: '0.8rem' }}>
            AI Meeting Summarizer
          </span>
        </div>
      </nav>

      {/* Hero */}
      <main className="upload-main container">
        <div className="upload-hero fade-in">
          <div className="hero-badge badge badge-primary">✦ Now with Gemini 2.5 Flash</div>
          <h1 className="hero-title">
            Turn meetings into<br />
            <span className="gradient-text">structured intelligence</span>
          </h1>
          <p className="hero-sub">
            Upload any audio or video recording. Botzilla transcribes, diarizes speakers,
            groups topics, generates a structured summary, a Word report, and a smart chatbot —
            automatically.
          </p>
        </div>

        {!uploading ? (
          <div className="drop-zone-wrapper fade-in fade-in-2">
            <div
              id="drop-zone"
              className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
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
                    <div className="file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    onClick={e => { e.stopPropagation(); setFile(null) }}
                  >✕</button>
                </div>
              ) : (
                <div className="drop-prompt">
                  <div className="drop-icon">↑</div>
                  <div className="drop-title">Drop your recording here</div>
                  <div className="drop-sub">or click to browse · MP3, MP4, WAV, MKV, M4A, FLAC…</div>
                </div>
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
              <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Processing your recording…</div>
                <div style={{ color: 'var(--c-text-subtle)', fontSize: '0.8rem', marginTop: 2 }}>
                  Meeting ID: <code style={{ color: 'var(--c-accent)' }}>{meetingId}</code>
                </div>
              </div>
            </div>
            <div className="divider" />
            <StageIndicator current={stage} />
            {logs.length > 0 && (
              <div className="log-box">
                {logs.slice(-6).map((l, i) => (
                  <div key={i} className="log-line">{l}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feature chips */}
        <div className="feature-chips fade-in fade-in-3">
          {[
            ['🎙', 'WhisperX large-v3'],
            ['👥', 'pyannote 3.1 diarization'],
            ['🧠', 'Gemini 2.5 Flash'],
            ['📄', 'Word Document'],
            ['💬', 'Smart Chatbot'],
            ['🖼', 'Slide Extraction'],
          ].map(([icon, label]) => (
            <div key={label as string} className="feature-chip">
              <span>{icon}</span><span>{label}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
