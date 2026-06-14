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
}

const AVATAR_COLORS = [
  'avatar-0','avatar-1','avatar-2','avatar-3',
  'avatar-4','avatar-5','avatar-6','avatar-7',
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

  // Sort by speaking time desc
  const sorted = [...speakers].sort((a, b) => b.speaking_time_seconds - a.speaking_time_seconds)

  return (
    <div className="speaker-grid">
      {sorted.map((sp, i) => {
        const avatarClass = AVATAR_COLORS[i % AVATAR_COLORS.length]
        const myActions = aiByAssignee[sp.speaker_id] || []

        return (
          <div key={sp.speaker_id} className="speaker-card">
            {/* Header */}
            <div className="sc-header">
              <div className={`speaker-avatar ${avatarClass}`}>{initials(sp.display_name)}</div>
              <div className="sc-info">
                <div className="sc-name">{sp.display_name}</div>
                <div className="sc-role">{sp.role || 'participant'}</div>
              </div>
              {sp.speaking_percentage > 0 && (
                <div className="sc-pct">{sp.speaking_percentage.toFixed(0)}%</div>
              )}
            </div>

            {/* Speaking time bar */}
            {sp.speaking_time_seconds > 0 && (
              <div className="sc-time-row">
                <div className="speaking-bar-track">
                  <div
                    className="speaking-bar-fill"
                    style={{
                      width: `${Math.min(sp.speaking_percentage, 100)}%`,
                      background: `var(--c-${avatarClass.replace('avatar-', '')} , var(--c-primary))`,
                      background: i % 3 === 0 ? 'var(--c-primary)' : i % 3 === 1 ? 'var(--c-accent)' : 'var(--c-warn)',
                    }}
                  />
                </div>
                <span className="sc-time-label">{fmtTime(sp.speaking_time_seconds)}</span>
              </div>
            )}

            {/* Stats row */}
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
                  <span className="sc-stat-val">{myActions.length}</span>
                  <span className="sc-stat-key">action items</span>
                </div>
              )}
            </div>

            {/* Key contributions */}
            {sp.key_contributions.length > 0 && (
              <div className="sc-contributions">
                {sp.key_contributions.slice(0, 3).map((c, ci) => (
                  <div key={ci} className="sc-contrib-item">
                    <span className="sc-contrib-dot">✦</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Action items */}
            {myActions.length > 0 && (
              <div className="sc-actions">
                <div className="section-label" style={{ marginBottom: 6 }}>Assigned Tasks</div>
                {myActions.map(a => (
                  <div key={a.action_id} className="sc-action-item">→ {a.text}</div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <style>{`
        .speaker-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
        .sc-header { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
        .sc-info { flex:1; min-width:0; }
        .sc-name { font-weight:700; font-size:0.95rem; color:var(--c-text); }
        .sc-role { font-size:0.75rem; color:var(--c-text-subtle); text-transform:capitalize; margin-top:1px; }
        .sc-pct  { font-size:1.3rem; font-weight:800; color:var(--c-text-subtle); }
        .sc-time-row { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
        .sc-time-label { font-size:0.75rem; color:var(--c-text-subtle); white-space:nowrap; }
        .sc-stats { display:flex; gap:0; border:1px solid var(--c-border); border-radius:8px; overflow:hidden; margin-bottom:14px; }
        .sc-stat {
          flex:1; display:flex; flex-direction:column; align-items:center;
          padding:8px 4px; border-right:1px solid var(--c-border);
        }
        .sc-stat:last-child { border-right:none; }
        .sc-stat-val { font-size:1.1rem; font-weight:800; color:var(--c-text); }
        .sc-stat-key { font-size:0.67rem; color:var(--c-text-subtle); text-align:center; }
        .sc-contributions { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
        .sc-contrib-item { display:flex; gap:8px; font-size:0.8rem; color:var(--c-text-muted); align-items:flex-start; }
        .sc-contrib-dot { color:var(--c-accent); font-size:0.6rem; margin-top:4px; flex-shrink:0; }
        .sc-actions { border-top:1px solid var(--c-border); padding-top:12px; margin-top:4px; }
        .sc-action-item { font-size:0.8rem; color:var(--c-text-muted); padding:4px 0; }
      `}</style>
    </div>
  )
}
