import { useState } from 'react'

interface ActionItem {
  action_id: string
  text: string
  topic_id: string
  assignee_id: string | null
  assignee_name: string | null
  due_date: string | null
  priority: 'high' | 'medium' | 'low' | null
  status: string
  timestamp: number
}

const PRIORITY_ICONS: Record<string, string> = {
  high: '🔴', medium: '🟡', low: '🟢',
}

export default function ActionItemsTable({ items }: { items: ActionItem[] }) {
  const [filter, setFilter] = useState<'all'|'high'|'medium'|'low'>('all')

  const filtered = filter === 'all' ? items : items.filter(a => a.priority === filter)

  return (
    <div className="action-items-wrapper">
      {/* Filter pills */}
      <div className="filter-row">
        {(['all','high','medium','low'] as const).map(p => {
          const count = p === 'all' ? items.length : items.filter(a => a.priority === p).length
          return (
            <button
              key={p}
              className={`filter-pill ${filter === p ? 'active' : ''}`}
              onClick={() => setFilter(p)}
            >
              {p !== 'all' && PRIORITY_ICONS[p]} {p.charAt(0).toUpperCase() + p.slice(1)}
              <span className="filter-count">{count}</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No {filter === 'all' ? '' : filter + ' priority '}action items</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.action_id}>
                  <td style={{ color: 'var(--c-text)', fontWeight: 500, maxWidth: 380 }}>
                    {a.text}
                  </td>
                  <td>
                    {a.assignee_name || a.assignee_id ? (
                      <span className="assignee-chip">
                        {a.assignee_name || a.assignee_id}
                      </span>
                    ) : (
                      <span style={{ color:'var(--c-text-subtle)', fontStyle:'italic' }}>Unassigned</span>
                    )}
                  </td>
                  <td>
                    {a.due_date ? (
                      <span className="due-chip">{a.due_date}</span>
                    ) : (
                      <span style={{ color:'var(--c-text-subtle)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {a.priority ? (
                      <span className={`priority-badge priority-${a.priority}`}>
                        {PRIORITY_ICONS[a.priority]} {a.priority}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .action-items-wrapper { display:flex; flex-direction:column; gap:14px; }
        .filter-row { display:flex; gap:8px; flex-wrap:wrap; }
        .filter-pill {
          display:inline-flex; align-items:center; gap:6px;
          padding:6px 14px; border-radius:var(--radius-full);
          background:var(--c-surface); border:1px solid var(--c-border);
          font-size:0.8rem; color:var(--c-text-muted);
          transition:all 0.18s;
        }
        .filter-pill.active {
          background:var(--c-primary-dim); border-color:var(--c-primary);
          color:var(--c-primary); font-weight:600;
        }
        .filter-pill:hover:not(.active) { background:var(--c-surface-2); }
        .filter-count {
          background:var(--c-surface-2); border-radius:var(--radius-full);
          padding:1px 7px; font-size:0.7rem; font-weight:700;
        }
        .assignee-chip {
          display:inline-block; padding:2px 10px;
          background:var(--c-surface-2); border-radius:var(--radius-full);
          font-size:0.8rem; color:var(--c-text);
        }
        .due-chip {
          font-family:monospace; font-size:0.8rem;
          color:var(--c-warn); background:var(--c-warn-dim);
          padding:2px 8px; border-radius:var(--radius-sm);
        }
        .priority-badge {
          font-size:0.78rem; font-weight:600;
          padding:2px 8px; border-radius:var(--radius-sm);
          display:inline-flex; align-items:center; gap:4px;
        }
        .priority-badge.priority-high   { background:rgba(255,77,109,0.12); color:var(--c-danger); }
        .priority-badge.priority-medium { background:var(--c-warn-dim);     color:var(--c-warn); }
        .priority-badge.priority-low    { background:var(--c-accent-dim);   color:var(--c-accent); }
        .empty-state {
          padding:32px; text-align:center;
          color:var(--c-text-subtle); font-size:0.875rem;
          border:1px dashed var(--c-border); border-radius:var(--radius-md);
        }
      `}</style>
    </div>
  )
}
