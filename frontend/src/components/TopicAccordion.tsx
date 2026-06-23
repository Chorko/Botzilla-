import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
  technical:      { color: '#6366F1', icon: '⚙' },
  strategic:      { color: '#06B6D4', icon: '◈' },
  decision:       { color: '#F59E0B', icon: '◉' },
  administrative: { color: '#6B6A8A', icon: '▣' },
  social:         { color: '#8B5CF6', icon: '◎' },
  planning:       { color: '#0EA5E9', icon: '▶' },
  review:         { color: '#F97316', icon: '↺' },
  brainstorm:     { color: '#10B981', icon: '✦' },
  other:          { color: '#9B9AB0', icon: '·' },
}

const IMP_META = {
  high:   { color: 'var(--red)',   bg: 'var(--red-bg)',   label: 'High' },
  medium: { color: 'var(--gold)',  bg: 'var(--gold-bg)',  label: 'Med' },
  low:    { color: 'var(--green)', bg: 'var(--green-bg)', label: 'Low' },
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
          <motion.div
            key={t.topic_id}
            className={`accordion-item ${isOpen ? 'open' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div
              className="accordion-header"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              role="button"
              aria-expanded={isOpen}
            >
              <div className="topic-header-left">
                {/* Number badge */}
                <div className="topic-num" style={{ background: meta.color + '12', borderColor: meta.color + '30' }}>
                  <span style={{ color: meta.color, fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="topic-title">{t.title}</div>
                  <div className="topic-meta-row">
                    <span className="ts-chip">{fmtTime(t.start_time)} – {fmtTime(t.end_time)}</span>
                    <span className="topic-type-tag" style={{ color: meta.color, borderColor: meta.color + '30', background: meta.color + '0C' }}>
                      {meta.icon} {t.topic_type}
                    </span>
                    {kps.length > 0 && <span className="badge badge-primary">{kps.length} pts</span>}
                    {t.sentiment && <span className="badge badge-muted">{t.sentiment}</span>}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                      ~{durMins}m
                    </span>
                  </div>
                  {/* Duration bar */}
                  <div className="topic-dur-bar">
                    <motion.div
                      className="topic-dur-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${durPct}%` }}
                      transition={{ duration: 1, delay: 0.2 + i * 0.05, ease: [0.16,1,0.3,1] }}
                      style={{ background: meta.color }}
                    />
                  </div>
                </div>
              </div>

              <motion.svg
                className="accordion-chevron"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: [0.16,1,0.3,1] }}
              >
                <polyline points="6 9 12 15 18 9" />
              </motion.svg>
            </div>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  className="accordion-body-wrap"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16,1,0.3,1] }}
                >
                  <div className="accordion-body-inner">
                    <p className="topic-summary">{t.summary}</p>

                    {kps.length > 0 && (
                      <div className="kp-section">
                        <div className="section-label" style={{ marginTop: 18 }}>Key Points</div>
                        <div className="kp-list">
                          {kps.map((kp, kpi) => {
                            const imp = IMP_META[kp.importance] || IMP_META.low
                            return (
                              <motion.div
                                key={kp.point_id}
                                className="kp-item"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 + kpi * 0.04 }}
                                whileHover={{ scale: 1.005, x: 2 }}
                              >
                                <div className="kp-dot" style={{ background: imp.color, boxShadow: `0 0 8px ${imp.color}60` }} />
                                <div className="kp-body">
                                  <div className="kp-text" style={{ fontWeight: kp.importance === 'high' ? 600 : 400 }}>
                                    {kp.text}
                                  </div>
                                  <div className="kp-meta">
                                    <span className="ts-chip">{fmtTime(kp.timestamp)}</span>
                                    {(kp.speaker_name || kp.speaker_id) && (
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                                        {kp.speaker_name || kp.speaker_id}
                                      </span>
                                    )}
                                    <span style={{
                                      fontSize: '0.67rem', fontWeight: 700, padding: '1px 7px',
                                      background: imp.bg, color: imp.color, borderRadius: 'var(--r-full)',
                                    }}>{imp.label}</span>
                                  </div>
                                </div>
                              </motion.div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}

      <style>{`
        .topic-accordion { display: flex; flex-direction: column; gap: 8px; }
        .topic-header-left { display: flex; gap: 14px; align-items: flex-start; flex: 1; min-width: 0; }
        .topic-num {
          width: 38px; height: 38px; border-radius: var(--r-sm); border: 1px solid;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          box-shadow: var(--shadow-sm);
        }
        .topic-title  { font-family: var(--font-display); font-weight: 700; font-size: 1rem; color: var(--text); margin-bottom: 5px; }
        .topic-meta-row { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .topic-type-tag {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 9px; border-radius: var(--r-full); border: 1px solid;
          font-size: 0.67rem; font-weight: 700; letter-spacing: 0.04em;
        }
        .topic-dur-bar { height: 3px; background: rgba(15,14,43,0.05); border-radius: var(--r-full); overflow: hidden; }
        .topic-dur-fill { height: 100%; border-radius: var(--r-full); }
        .accordion-body-wrap { overflow: hidden; }
        .accordion-body-inner { padding: 0 20px 24px; border-top: 1px solid var(--border); margin-top: 4px; padding-top: 18px; }
        .topic-summary { color: var(--text-2); font-size: 0.92rem; line-height: 1.8; }
        .kp-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .kp-item {
          display: flex; gap: 12px; padding: 12px 16px;
          background: var(--surface-2); border: 1px solid var(--border);
          border-radius: var(--r-md); transition: all 0.2s;
        }
        .kp-item:hover { background: var(--surface); border-color: var(--border-2); box-shadow: var(--shadow-sm); }
        .kp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 7px; }
        .kp-body { flex: 1; min-width: 0; }
        .kp-text { color: var(--text); font-size: 0.875rem; line-height: 1.55; margin-bottom: 6px; }
        .kp-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      `}</style>
    </div>
  )
}
