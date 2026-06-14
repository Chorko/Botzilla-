import { useState } from 'react'

interface Topic {
  topic_id: string
  title: string
  summary: string
  topic_type: string
  start_time: number
  end_time: number
  duration_seconds: number
  speakers_involved: string[]
  key_point_ids?: string[]
  decision_ids?: string[]
  action_item_ids?: string[]
}

interface KeyPoint {
  point_id: string
  text: string
  speaker_id: string
  speaker_name: string | null
  timestamp: number
  importance: 'high' | 'medium' | 'low'
  topic_id: string
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const TYPE_COLORS: Record<string, string> = {
  technical:     'var(--c-primary)',
  strategic:     'var(--c-accent)',
  decision:      'var(--c-warn)',
  administrative:'var(--c-text-subtle)',
  social:        '#a78bfa',
  planning:      '#06b6d4',
  review:        '#f59e0b',
  other:         'var(--c-text-subtle)',
}

export default function TopicAccordion({ topics, keyPoints }: {
  topics: Topic[]
  keyPoints: KeyPoint[]
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  const kpByTopic = keyPoints.reduce<Record<string, KeyPoint[]>>((acc, kp) => {
    acc[kp.topic_id] = acc[kp.topic_id] || []
    acc[kp.topic_id].push(kp)
    return acc
  }, {})

  return (
    <div className="topic-accordion">
      {topics.map((t, i) => {
        const isOpen = openIdx === i
        const kps = kpByTopic[t.topic_id] || []
        const typeColor = TYPE_COLORS[t.topic_type] || 'var(--c-text-subtle)'
        const dur = Math.round(t.duration_seconds / 60)

        return (
          <div key={t.topic_id} className={`accordion-item ${isOpen ? 'open' : ''}`}>
            <div
              className="accordion-header"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              role="button"
              aria-expanded={isOpen}
            >
              <div className="topic-header-left">
                <div
                  className="topic-index"
                  style={{ background: typeColor + '22', color: typeColor, borderColor: typeColor + '44' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div>
                  <div className="topic-title">{t.title}</div>
                  <div className="topic-sub-info">
                    <span className="ts-chip">{fmtTime(t.start_time)} – {fmtTime(t.end_time)}</span>
                    <span style={{ color: 'var(--c-text-subtle)', fontSize: '0.75rem' }}>~{dur}m</span>
                    <span className="badge badge-muted" style={{ borderColor: typeColor + '44', color: typeColor }}>
                      {t.topic_type}
                    </span>
                    {kps.length > 0 && (
                      <span className="badge badge-primary">{kps.length} key point{kps.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </div>
              <svg className="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <div className="accordion-body">
              <p className="topic-summary">{t.summary}</p>

              {kps.length > 0 && (
                <div className="key-points-list">
                  <div className="section-label" style={{ marginTop: 16 }}>Key Points</div>
                  {kps.map(kp => (
                    <div key={kp.point_id} className={`kp-item kp-${kp.importance}`}>
                      <div className="kp-dot" />
                      <div className="kp-content">
                        <p className="kp-text">{kp.text}</p>
                        <div className="kp-meta">
                          <span className="ts-chip">{fmtTime(kp.timestamp)}</span>
                          {(kp.speaker_name || kp.speaker_id) && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--c-text-subtle)' }}>
                              {kp.speaker_name || kp.speaker_id}
                            </span>
                          )}
                          <span className={`badge badge-${kp.importance === 'high' ? 'warn' : kp.importance === 'medium' ? 'accent' : 'muted'}`}>
                            {kp.importance}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <style>{`
        .topic-accordion { display:flex; flex-direction:column; gap:0; }
        .topic-header-left { display:flex; gap:14px; align-items:flex-start; flex:1; min-width:0; }
        .topic-index {
          width:34px; height:34px; border-radius:8px;
          border:1px solid; display:flex; align-items:center; justify-content:center;
          font-size:0.72rem; font-weight:800; flex-shrink:0; font-family:monospace;
        }
        .topic-title  { font-weight:600; font-size:0.95rem; color:var(--c-text); }
        .topic-sub-info {
          display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:5px;
        }
        .topic-summary { color:var(--c-text-muted); font-size:0.9rem; line-height:1.75; }
        .key-points-list { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
        .kp-item { display:flex; gap:12px; padding:10px 14px; border-radius:8px; background:var(--c-surface-2); }
        .kp-dot {
          width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:6px;
        }
        .kp-high .kp-dot   { background:var(--c-warn); }
        .kp-medium .kp-dot { background:var(--c-accent); }
        .kp-low .kp-dot    { background:var(--c-text-subtle); }
        .kp-content { flex:1; min-width:0; }
        .kp-text { color:var(--c-text); font-size:0.875rem; margin-bottom:6px; }
        .kp-meta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      `}</style>
    </div>
  )
}
