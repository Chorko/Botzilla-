import { motion } from 'framer-motion'

interface Slide {
  slide_id: string
  timestamp: number
  topic_id: string
  ocr_text: string
  frame_path: string
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SlideViewer({ slides, topics }: { slides: Slide[], topics: any[] }) {
  if (!slides || slides.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border-2)' }}>
        No slides detected in this meeting.
      </div>
    )
  }

  return (
    <div className="slide-grid">
      {slides.map((s, i) => {
        const topic = topics.find(t => t.topic_id === s.topic_id)
        return (
          <motion.div
            key={s.slide_id}
            className="slide-card"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.16,1,0.3,1] }}
            whileHover={{ y: -6, scale: 1.02 }}
          >
            <div className="slide-img-wrap">
              <img
                src={`/api/media/${s.frame_path.split('/').pop()}`}
                alt={`Slide at ${fmtTime(s.timestamp)}`}
                className="slide-img"
                loading="lazy"
              />
              <div className="slide-ts-badge">{fmtTime(s.timestamp)}</div>
            </div>

            <div className="slide-card-body">
              <div className="slide-topic">
                <span style={{ color: 'var(--indigo)' }}>◈</span> {topic?.title || 'Unknown Topic'}
              </div>

              {s.ocr_text && (
                <div className="slide-ocr">
                  {s.ocr_text.length > 120 ? s.ocr_text.slice(0, 120) + '…' : s.ocr_text}
                </div>
              )}
            </div>
          </motion.div>
        )
      })}

      <style>{`
        .slide-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }
        .slide-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-md);
          overflow: hidden;
          box-shadow: var(--shadow-sm), var(--rim-light);
          display: flex; flex-direction: column;
        }
        .slide-card:hover { box-shadow: var(--shadow-lg), 0 0 0 2px var(--indigo-bg-2); }
        .slide-img-wrap { position: relative; background: #000; padding-top: 56.25%; /* 16:9 */ }
        .slide-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; }
        .slide-ts-badge {
          position: absolute; bottom: 10px; right: 10px;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
          color: #fff; font-size: 0.75rem; font-family: var(--font-mono); font-weight: 600;
          padding: 4px 10px; border-radius: var(--r-sm);
        }
        .slide-card-body { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .slide-topic { font-size: 0.85rem; font-weight: 600; color: var(--text); }
        .slide-ocr { font-size: 0.78rem; color: var(--text-3); line-height: 1.5; font-family: var(--font-mono); }
      `}</style>
    </div>
  )
}
