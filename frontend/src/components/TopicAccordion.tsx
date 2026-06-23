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
  sentiment?: string
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

const TYPE_META: Record<string, { color: string; icon: string }> = {
  technical:      { color: '#818CF8', icon: '⚙' },
  strategic:      { color: '#22D3EE', icon: '◈' },
  decision:       { color: '#F59E0B', icon: '◉' },
  administrative: { color: '#94A3C4', icon: '▣' },
  social:         { color: '#A78BFA', icon: '◎' },
  planning:       { color: '#0EA5E9', icon: '▶' },
  review:         { color: '#F97316', icon: '↺' },
  brainstorm:     { color: '#10B981', icon: '✦' },
  other:          { color: '#4B5A7A', icon: '·' },
}

const IMP_META = {
  high:   { color: '#F43F5E', bg: 'rgba(244,63,94,0.1)',    label: 'High' },
  medium: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',   label: 'Med' },
  low:    { color: '#10B981', bg: 'rgba(16,185,129,0.1)',   label: 'Low' },
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

  const totalDur = topics.reduce((s, t) => s + (t.duration_seconds || 0), 0)

  return (
    <div className="topic-accordion">
      {topics.map((t, i) => {
        const isOpen   = openIdx === i
        const kps      = kpByTopic[t.topic_id] || []
        const meta     = TYPE_META[t.topic_type] || TYPE_META.other
        const durPct   = totalDur > 0 ? Math.round((t.duration_seconds / totalDur) * 100) : 0
        const durMins  = Math.round(t.duration_seconds / 60)

        return (
          <div key={t.topic_id} className={`accordion-item ${isOpen ? 'open' : ''}`}>
            <div
              className="accordion-header"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              role="button"
              aria-expanded={isOpen}
            >
              <div className="topic-header-left">
                {/* 3D number badge */}
                <div className="topic-num" style={{ background: meta.color + '18', borderColor: meta.color + '40' }}>
                  <span style={{ color: meta.color, fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="topic-title">{t.title}</div>
                  <div className="topic-meta-row">
                    <span className="ts-chip">{fmtTime(t.start_time)} – {fmtTime(t.end_time)}</span>
                    <span className="topic-type-tag" style={{ color: meta.color, borderColor: meta.color + '40', background: meta.color + '12' }}>
                      {meta.icon} {t.topic_type}
                    </span>
                    {kps.length > 0 && (
                      <span className="badge badge-primary">{kps.length} pts</span>
                    )}
                    {t.sentiment && (
                      <span className="badge badge-muted">{t.sentiment}</span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--t-3)', fontFamily: 'var(--font-mono)' }}>
                      ~{durMins}m
                    </span>
                  </div>
                  {/* Duration bar */}
                  <div className="topic-dur-bar">
                    <div className="topic-dur-fill" style={{ width: `${durPct}%`, background: meta.color }} />
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
                <div className="kp-section">
                  <div className="section-label" style={{ marginTop: 18 }}>Key Points</div>
                  <div className="kp-list">
                    {kps.map(kp => {
                      const imp = IMP_META[kp.importance] || IMP_META.low
                      return (
                        <div key={kp.point_id} className="kp-item">
                          <div className="kp-dot" style={{ background: imp.color, boxShadow: `0 0 8px ${imp.color}60` }} />
                          <div className="kp-body">
                            <div className="kp-text" style={{ fontWeight: kp.importance === 'high' ? 700 : 500 }}>
                              {kp.text}
                            </div>
                            <div className="kp-meta">
                              <span className="ts-chip">{fmtTime(kp.timestamp)}</span>
                              {(kp.speaker_name || kp.speaker_id) && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--t-3)' }}>
                                  {kp.speaker_name || kp.speaker_id}
                                </span>
                              )}
                              <span style={{
                                fontSize: '0.67rem', fontWeight: 700, padding: '1px 7px',
                                background: imp.bg, color: imp.color,
                                borderRadius: 'var(--r-full)',
                              }}>{imp.label}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <style>{`
        .topic-accordion { display: flex; flex-direction: column; gap: 6px; }
        .topic-header-left { display: flex; gap: 14px; align-items: flex-start; flex: 1; min-width: 0; }
        .topic-num {
          width: 36px; height: 36px; border-radius: 8px; border: 1px solid;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .topic-title  { font-weight: 700; font-size: 0.95rem; color: var(--t-0); margin-bottom: 5px; }
        .topic-meta-row { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
        .topic-type-tag {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 9px; border-radius: var(--r-full); border: 1px solid;
          font-size: 0.67rem; font-weight: 700; letter-spacing: 0.04em;
        }
        .topic-dur-bar {
          height: 2px; background: rgba(255,255,255,0.06); border-radius: var(--r-full); overflow: hidden;
        }
        .topic-dur-fill {
          height: 100%; border-radius: var(--r-full);
          transition: width 1s var(--ease-expo);
          box-shadow: 0 0 6px currentColor;
        }
        .topic-summary { color: var(--t-2); font-size: 0.9rem; line-height: 1.8; }
        .kp-section {}
        .kp-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .kp-item {
          display: flex; gap: 12px; padding: 12px 14px;
          background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle);
          border-radius: var(--r-md); transition: all 0.18s;
        }
        .kp-item:hover { background: rgba(255,255,255,0.04); border-color: var(--border-default); }
        .kp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 7px; }
        .kp-body { flex: 1; min-width: 0; }
        .kp-text { color: var(--t-1); font-size: 0.875rem; line-height: 1.55; margin-bottom: 6px; }
        .kp-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      `}</style>
    </div>
  )
}
