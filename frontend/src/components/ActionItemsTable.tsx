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

const PRI_CONFIG = {
  high:   { label: 'High',   icon: '●', color: 'var(--danger)',  bg: 'var(--d-dim)',  border: 'rgba(244,63,94,0.2)' },
  medium: { label: 'Medium', icon: '●', color: 'var(--warn)',    bg: 'var(--g-dim)',  border: 'rgba(245,158,11,0.2)' },
  low:    { label: 'Low',    icon: '●', color: 'var(--success)', bg: 'var(--s-dim)',  border: 'rgba(16,185,129,0.2)' },
}

export default function ActionItemsTable({ items }: { items: ActionItem[] }) {
  const [filter, setFilter] = useState<'all'|'high'|'medium'|'low'>('all')

  const filtered = filter === 'all' ? items : items.filter(a => a.priority === filter)
  const highCount   = items.filter(a => a.priority === 'high').length
  const medCount    = items.filter(a => a.priority === 'medium').length
  const lowCount    = items.filter(a => a.priority === 'low').length

  return (
    <div className="action-items-wrapper">
      {/* Filter pills */}
      <div className="filter-row">
        <button
          className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
          <span className="filter-count">{items.length}</span>
        </button>
        {(['high','medium','low'] as const).map(p => (
          <button
            key={p}
            className={`filter-pill filter-pill-${p} ${filter === p ? 'active' : ''}`}
            onClick={() => setFilter(p)}
          >
            <span style={{ color: PRI_CONFIG[p].color, fontSize: '0.5rem' }}>●</span>
            {PRI_CONFIG[p].label}
            <span className="filter-count">
              {p === 'high' ? highCount : p === 'medium' ? medCount : lowCount}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          No {filter === 'all' ? '' : filter + '-priority '}action items
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '45%' }}>Task</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, idx) => {
                const cfg = a.priority ? PRI_CONFIG[a.priority] : null
                return (
                  <tr key={a.action_id}>
                    <td style={{ color: 'var(--t-1)', fontWeight: 500 }}>{a.text}</td>
                    <td>
                      {a.assignee_name || a.assignee_id ? (
                        <span className="assignee-chip">{a.assignee_name || a.assignee_id}</span>
                      ) : (
                        <span style={{ color: 'var(--t-4)', fontStyle: 'italic', fontSize: '0.8rem' }}>Unassigned</span>
                      )}
                    </td>
                    <td>
                      {a.due_date ? (
                        <span className="due-chip">{a.due_date}</span>
                      ) : (
                        <span style={{ color: 'var(--t-4)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {cfg ? (
                        <span className="priority-badge" style={{
                          color: cfg.color,
                          background: cfg.bg,
                          border: `1px solid ${cfg.border}`,
                        }}>
                          {cfg.icon} {cfg.label}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .action-items-wrapper { display: flex; flex-direction: column; gap: 12px; }
        .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .filter-pill {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 7px 16px; border-radius: var(--r-full);
          background: var(--glass-dark); border: 1px solid var(--border-subtle);
          font-size: 0.8rem; font-weight: 600; color: var(--t-2);
          transition: all 0.18s var(--ease-expo);
          backdrop-filter: blur(12px);
        }
        .filter-pill:hover:not(.active) {
          border-color: var(--border-default);
          color: var(--t-0);
          transform: translateY(-1px);
        }
        .filter-pill.active {
          background: var(--p-dim); border-color: var(--border-strong);
          color: var(--p-2); box-shadow: 0 0 16px rgba(99,102,241,0.2);
        }
        .filter-count {
          background: rgba(255,255,255,0.06); border-radius: var(--r-full);
          padding: 1px 7px; font-size: 0.68rem; font-weight: 700;
          font-family: var(--font-mono);
        }
        .assignee-chip {
          display: inline-block; padding: 3px 10px;
          background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle);
          border-radius: var(--r-full); font-size: 0.78rem; color: var(--t-1);
        }
        .due-chip {
          font-family: var(--font-mono); font-size: 0.78rem;
          color: var(--warn); background: var(--g-dim);
          border: 1px solid rgba(245,158,11,0.2);
          padding: 2px 8px; border-radius: var(--r-xs);
        }
        .priority-badge {
          font-size: 0.75rem; font-weight: 700;
          padding: 3px 10px; border-radius: var(--r-full);
          display: inline-flex; align-items: center; gap: 5px;
        }
        .empty-state {
          padding: 48px; text-align: center;
          color: var(--t-3); font-size: 0.875rem;
          border: 1px dashed var(--border-subtle); border-radius: var(--r-lg);
          background: rgba(255,255,255,0.01);
        }
      `}</style>
    </div>
  )
}
