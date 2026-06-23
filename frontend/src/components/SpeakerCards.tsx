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
  'linear-gradient(135deg,#6366F1,#8B5CF6)',
  'linear-gradient(135deg,#22D3EE,#0EA5E9)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#8B5CF6,#6366F1)',
  'linear-gradient(135deg,#F97316,#FB923C)',
  'linear-gradient(135deg,#14B8A6,#0EA5E9)',
]

const BAR_COLORS = [
  '#6366F1','#22D3EE','#F59E0B','#10B981','#EC4899','#8B5CF6','#F97316','#14B8A6',
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
          <div key={sp.speaker_id} className="speaker-card">
            {/* Glow accent line at top */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: gradient, borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
              opacity: 0.8,
            }} />

            {/* Header */}
            <div className="sc-header">
              <div className="speaker-avatar" style={{ background: gradient }}>
                {initials(sp.display_name)}
              </div>
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

            {/* Speaking bar */}
            {sp.speaking_time_seconds > 0 && (
              <div className="sc-time-row">
                <div className="speaking-bar-track" style={{ flex: 1 }}>
                  <div
                    className="speaking-bar-fill"
                    style={{
                      width: `${Math.min(sp.speaking_percentage, 100)}%`,
                      background: barColor,
                      color: barColor,
                    }}
                  />
                </div>
                <span className="sc-time-label">{fmtTime(sp.speaking_time_seconds)}</span>
              </div>
            )}

            {/* Stat chips */}
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
                    {highPri > 0 && <span style={{ color: 'var(--danger)', fontSize: '0.6rem', marginLeft: 2 }}>●</span>}
                  </span>
                  <span className="sc-stat-key">actions</span>
                </div>
              )}
            </div>

            {/* Key contributions */}
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

            {/* Action items */}
            {myActions.length > 0 && (
              <div className="sc-actions">
                <div className="section-label" style={{ marginBottom: 6 }}>Assigned Tasks</div>
                {myActions.slice(0, 4).map(a => (
                  <div key={a.action_id} className="sc-action-item">
                    <span style={{ color: a.priority === 'high' ? 'var(--danger)' : a.priority === 'medium' ? 'var(--warn)' : 'var(--success)', fontSize: '0.65rem' }}>●</span>
                    {a.text}
                  </div>
                ))}
                {myActions.length > 4 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--t-3)', marginTop: 4 }}>
                    +{myActions.length - 4} more
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      <style>{`
        .speaker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
        .sc-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; margin-top: 6px; }
        .sc-info { flex: 1; min-width: 0; }
        .sc-name { font-weight: 700; font-size: 0.95rem; color: var(--t-0); }
        .sc-role { font-size: 0.72rem; color: var(--t-3); text-transform: capitalize; margin-top: 2px; }
        .sc-pct  { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; }
        .sc-time-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .sc-time-label { font-size: 0.72rem; color: var(--t-3); white-space: nowrap; font-family: var(--font-mono); }
        .sc-stats {
          display: flex; gap: 0;
          background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm); overflow: hidden; margin-bottom: 14px;
        }
        .sc-stat {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          padding: 10px 4px; border-right: 1px solid var(--border-subtle);
        }
        .sc-stat:last-child { border-right: none; }
        .sc-stat-val { font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; color: var(--t-0); }
        .sc-stat-key { font-size: 0.62rem; color: var(--t-3); text-align: center; letter-spacing: 0.04em; margin-top: 1px; }
        .sc-contributions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .sc-contrib-item { display: flex; gap: 8px; font-size: 0.8rem; color: var(--t-2); align-items: flex-start; }
        .sc-contrib-dot { font-size: 0.65rem; margin-top: 4px; flex-shrink: 0; }
        .sc-actions { border-top: 1px solid var(--border-subtle); padding-top: 12px; margin-top: 4px; }
        .sc-action-item {
          display: flex; gap: 7px; align-items: flex-start;
          font-size: 0.78rem; color: var(--t-2); padding: 4px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .sc-action-item:last-of-type { border-bottom: none; }
      `}</style>
    </div>
  )
}
