import { useState } from 'react'

interface Slide {
  slide_id: string
  topic_id: string
  timestamp: number
  image_path: string
  ocr_text: string
  relevance_score: number
}

interface Topic {
  topic_id: string
  title: string
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function imgSrc(path: string): string {
  // Convert local path to API-served URL
  // e.g. D:/ai-meeting-summarizer/Botzilla-/output/abc123/slides/ctx_001_slide_01.png
  // → /output/abc123/slides/ctx_001_slide_01.png
  const parts = path.replace(/\\/g, '/').split('/output/')
  if (parts.length > 1) return `/output/${parts[1]}`
  return path
}

export default function SlideViewer({ slides, topics }: {
  slides: Slide[]
  topics: Topic[]
}) {
  const [selected, setSelected] = useState<Slide | null>(slides[0] || null)
  const [lightbox, setLightbox]  = useState(false)

  const topicMap = topics.reduce<Record<string, string>>((acc, t) => {
    acc[t.topic_id] = t.title; return acc
  }, {})

  if (!slides.length) return (
    <div style={{
      padding: '48px', textAlign: 'center',
      border: '1px dashed var(--c-border)', borderRadius: 'var(--radius-md)',
      color: 'var(--c-text-subtle)', fontSize: '0.9rem'
    }}>
      No slides extracted for this meeting.
    </div>
  )

  return (
    <div className="slide-viewer">
      {/* Main preview */}
      {selected && (
        <div className="slide-main-preview card">
          <img
            src={imgSrc(selected.image_path)}
            alt={`Slide at ${fmtTime(selected.timestamp)}`}
            className="slide-main-img"
            onClick={() => setLightbox(true)}
            style={{ cursor: 'zoom-in' }}
          />
          <div className="slide-main-meta">
            <div className="slide-meta-left">
              <span className="ts-chip">{fmtTime(selected.timestamp)}</span>
              {topicMap[selected.topic_id] && (
                <span className="badge badge-primary">{topicMap[selected.topic_id]}</span>
              )}
              <span className="badge badge-muted">
                score: {(selected.relevance_score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          {selected.ocr_text && (
            <details className="slide-ocr">
              <summary>OCR Text</summary>
              <pre>{selected.ocr_text}</pre>
            </details>
          )}
        </div>
      )}

      {/* Thumbnail strip */}
      <div className="slide-strip">
        {slides.map(s => (
          <div
            key={s.slide_id}
            className={`slide-thumb ${selected?.slide_id === s.slide_id ? 'active' : ''}`}
            onClick={() => setSelected(s)}
          >
            <img src={imgSrc(s.image_path)} alt={`Slide ${s.slide_id}`} />
            <div className="slide-thumb-caption">{fmtTime(s.timestamp)}</div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && selected && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightbox(false)}>✕</button>
            <img src={imgSrc(selected.image_path)} alt="Slide fullscreen" />
          </div>
        </div>
      )}

      <style>{`
        .slide-viewer { display:flex; flex-direction:column; gap:16px; }
        .slide-main-preview { padding:0; overflow:hidden; }
        .slide-main-img { width:100%; max-height:480px; object-fit:contain; background:var(--c-bg); }
        .slide-main-meta {
          display:flex; align-items:center; justify-content:space-between;
          padding:12px 16px; border-top:1px solid var(--c-border);
        }
        .slide-meta-left { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .slide-ocr {
          border-top:1px solid var(--c-border); padding:12px 16px;
          font-size:0.8rem;
        }
        .slide-ocr summary { cursor:pointer; color:var(--c-text-subtle); margin-bottom:8px; }
        .slide-ocr pre {
          white-space:pre-wrap; word-break:break-word;
          color:var(--c-text-muted); font-size:0.78rem; line-height:1.6;
          max-height:200px; overflow-y:auto;
        }
        .slide-strip {
          display:flex; gap:10px; overflow-x:auto; padding-bottom:4px;
        }
        .slide-strip .slide-thumb {
          flex-shrink:0; width:140px; cursor:pointer; border-radius:8px;
          border:2px solid var(--c-border); overflow:hidden;
          transition:all 0.18s; background:var(--c-surface-2);
        }
        .slide-strip .slide-thumb.active { border-color:var(--c-primary); }
        .slide-strip .slide-thumb:hover  { border-color:var(--c-border-2); transform:scale(1.03); }
        .slide-strip .slide-thumb img { width:100%; height:80px; object-fit:cover; }
        .slide-strip .slide-thumb-caption {
          padding:4px 8px; font-size:0.7rem; color:var(--c-text-subtle); text-align:center;
        }
        .lightbox {
          position:fixed; inset:0; background:rgba(0,0,0,0.85);
          display:flex; align-items:center; justify-content:center; z-index:1000;
          backdrop-filter:blur(8px);
        }
        .lightbox-inner {
          position:relative; max-width:90vw; max-height:90vh;
        }
        .lightbox-inner img { max-width:90vw; max-height:90vh; border-radius:12px; }
        .lightbox-close {
          position:absolute; top:-36px; right:0;
          background:transparent; border:none;
          color:#fff; font-size:1.2rem; cursor:pointer;
        }
      `}</style>
    </div>
  )
}
