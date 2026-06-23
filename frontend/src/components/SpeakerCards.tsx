import { motion } from 'framer-motion'

interface SpeakerContrib {
  speaker_id: string
  name: string | null
  display_name: string
  role: string
  speaking_time_seconds: number
  speaking_percentage: number
  topics_led: string[]
  decisions_made: string[]
  action_items_assigned: string[]
  key_contributions: string[]
}

interface ActionItem {
  action_id: string
  text: string
  assignee_id: string | null
  priority?: string | null
}

const GRADIENTS = [
  'linear-gradient(135deg,#4F46E5,#7C3AED)',
  'linear-gradient(135deg,#06B6D4,#0EA5E9)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#8B5CF6,#6366F1)',
  'linear-gradient(135deg,#F97316,#FB923C)',
  'linear-gradient(135deg,#14B8A6,#0EA5E9)',
]

const BAR_COLORS = [
  '#4F46E5','#06B6D4','#F59E0B','#10B981','#EC4899','#8B5CF6','#F97316','#14B8A6',
]

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export default function SpeakerCards({ speakers, actionItems }: {
  speakers: SpeakerContrib[]
  actionItems: ActionItem[]
}) {
  const aiByAssignee = actionItems.reduce<Record<string, ActionItem[]>>((acc, a) => {
    if (a.assignee_id) { acc[a.assignee_id] = acc[a.assignee_id] || []; acc[a.assignee_id].push(a) }
    return acc
  }, {})

  const sorted = [...speakers].sort((a, b) => (b.speaking_percentage || 0) - (a.speaking_percentage || 0))

  return (
    <div className="speaker-grid">
      {sorted.map((sp, i) => {
        const gradient  = GRADIENTS[i % GRADIENTS.length]
        const barColor  = BAR_COLORS[i % BAR_COLORS.length]
        const myActions = aiByAssignee[sp.speaker_id] || []
        const highPri   = myActions.filter(a => a.priority === 'high').length

        return (
          <motion.div
            key={sp.speaker_id}
            className="speaker-card"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.16,1,0.3,1] }}
            whileHover={{ y: -6, scale: 1.01 }}
          >
            {/* Top accent line */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 3,
              background: gradient, borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
            }} />

            <div className="sc-header">
              <motion.div
                className="speaker-avatar"
                style={{ background: gradient }}
                whileHover={{ rotate: 5, scale: 1.05 }}
              >
                {initials(sp.display_name)}
              </motion.div>
              <div className="sc-info">
                <div className="sc-name">{sp.display_name}</div>
                <div className="sc-role">{sp.role || 'Participant'}</div>
              </div>
              {sp.speaking_percentage > 0 && (
                <div className="sc-pct" style={{ color: barColor }}>
                  {sp.speaking_percentage.toFixed(0)}%
                </div>
              )}
            </div>

            {sp.speaking_time_seconds > 0 && (
              <div className="sc-time-row">
                <div className="speaking-bar-track" style={{ flex: 1 }}>
                  <motion.div
                    className="speaking-bar-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(sp.speaking_percentage, 100)}%` }}
                    transition={{ duration: 1.2, delay: 0.3 + i * 0.1, ease: [0.16,1,0.3,1] }}
                    style={{ background: gradient }}
                  />
                </div>
                <span className="sc-time-label">{fmtTime(sp.speaking_time_seconds)}</span>
              </div>
            )}

            <div className="sc-stats">
              {sp.topics_led.length > 0 && (
                <div className="sc-stat">
                  <span className="sc-stat-val">{sp.topics_led.length}</span>
                  <span className="sc-stat-key">topics led</span>
                </div>
              )}
              {sp.decisions_made.length > 0 && (
                <div className="sc-stat">
                  <span className="sc-stat-val">{sp.decisions_made.length}</span>
                  <span className="sc-stat-key">decisions</span>
                </div>
              )}
              {myActions.length > 0 && (
                <div className="sc-stat">
                  <span className="sc-stat-val">
                    {myActions.length}
                    {highPri > 0 && <span style={{ color: 'var(--red)', fontSize: '0.6rem', marginLeft: 2 }}>●</span>}
                  </span>
                  <span className="sc-stat-key">actions</span>
                </div>
              )}
            </div>

            {sp.key_contributions.length > 0 && (
              <div className="sc-contributions">
                {sp.key_contributions.slice(0, 3).map((c, ci) => (
                  <div key={ci} className="sc-contrib-item">
                    <span className="sc-contrib-dot" style={{ color: barColor }}>▸</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            )}

            {myActions.length > 0 && (
              <div className="sc-actions">
                <div className="section-label" style={{ marginBottom: 6 }}>Assigned Tasks</div>
                {myActions.slice(0, 4).map(a => (
                  <div key={a.action_id} className="sc-action-item">
                    <span style={{ color: a.priority === 'high' ? 'var(--red)' : a.priority === 'medium' ? 'var(--gold)' : 'var(--green)', fontSize: '0.65rem' }}>●</span>
                    {a.text}
                  </div>
                ))}
                {myActions.length > 4 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-4)', marginTop: 4 }}>
                    +{myActions.length - 4} more
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )
      })}

      <style>{`
        .speaker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
        .sc-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; margin-top: 4px; }
        .sc-info { flex: 1; min-width: 0; }
        .sc-name { font-weight: 700; font-size: 1rem; color: var(--text); font-family: var(--font-display); letter-spacing: -0.01em; }
        .sc-role { font-size: 0.76rem; color: var(--text-3); text-transform: capitalize; margin-top: 2px; }
        .sc-pct  { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; letter-spacing: -0.03em; }
        .sc-time-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .sc-time-label { font-size: 0.72rem; color: var(--text-4); white-space: nowrap; font-family: var(--font-mono); }
        .sc-stats {
          display: flex; gap: 0;
          background: var(--surface-2); border: 1px solid var(--border);
          border-radius: var(--r-sm); overflow: hidden; margin-bottom: 16px;
        }
        .sc-stat {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          padding: 12px 4px; border-right: 1px solid var(--border);
        }
        .sc-stat:last-child { border-right: none; }
        .sc-stat-val { font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: var(--text); line-height: 1; margin-bottom: 3px; }
        .sc-stat-key { font-size: 0.65rem; color: var(--text-4); text-align: center; letter-spacing: 0.04em; }
        .sc-contributions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .sc-contrib-item { display: flex; gap: 10px; font-size: 0.85rem; color: var(--text-2); align-items: flex-start; line-height: 1.5; }
        .sc-contrib-dot { font-size: 0.7rem; margin-top: 4px; flex-shrink: 0; }
        .sc-actions { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 4px; }
        .sc-action-item {
          display: flex; gap: 8px; align-items: flex-start;
          font-size: 0.85rem; color: var(--text-2); padding: 5px 0;
          border-bottom: 1px solid var(--border); line-height: 1.5;
        }
        .sc-action-item:last-of-type { border-bottom: none; }
      `}</style>
    </div>
  )
}
