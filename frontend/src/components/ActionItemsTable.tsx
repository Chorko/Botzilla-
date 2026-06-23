import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
  high:   { label: 'High',   icon: '●', color: 'var(--red)',   bg: 'var(--red-bg)',   border: 'rgba(239,68,68,0.2)' },
  medium: { label: 'Medium', icon: '●', color: 'var(--gold)',  bg: 'var(--gold-bg)',  border: 'rgba(245,158,11,0.2)' },
  low:    { label: 'Low',    icon: '●', color: 'var(--green)', bg: 'var(--green-bg)', border: 'rgba(16,185,129,0.2)' },
}

export default function ActionItemsTable({ items }: { items: ActionItem[] }) {
  const [filter, setFilter] = useState<'all'|'high'|'medium'|'low'>('all')

  const filtered = filter === 'all' ? items : items.filter(a => a.priority === filter)
  const highCount   = items.filter(a => a.priority === 'high').length
  const medCount    = items.filter(a => a.priority === 'medium').length
  const lowCount    = items.filter(a => a.priority === 'low').length

  return (
    <div className="action-items-wrapper">
      <div className="filter-row">
        <motion.button
          className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          All
          <span className="filter-count">{items.length}</span>
        </motion.button>
        {(['high','medium','low'] as const).map(p => (
          <motion.button
            key={p}
            className={`filter-pill filter-pill-${p} ${filter === p ? 'active' : ''}`}
            onClick={() => setFilter(p)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span style={{ color: PRI_CONFIG[p].color, fontSize: '0.6rem' }}>●</span>
            {PRI_CONFIG[p].label}
            <span className="filter-count">
              {p === 'high' ? highCount : p === 'medium' ? medCount : lowCount}
            </span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {filtered.length === 0 ? (
          <motion.div
            key="empty"
            className="empty-state"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            No {filter === 'all' ? '' : filter + '-priority '}action items
          </motion.div>
        ) : (
          <motion.div
            key="table"
            className="card"
            style={{ padding: 0, overflow: 'hidden' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '45%' }}>Task</th>
                  <th>Assignee</th>
                  <th>Due</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <motion.tbody>
                <AnimatePresence>
                  {filtered.map((a, idx) => {
                    const cfg = a.priority ? PRI_CONFIG[a.priority] : null
                    return (
                      <motion.tr
                        key={a.action_id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ delay: idx * 0.03, duration: 0.2 }}
                      >
                        <td style={{ color: 'var(--text)', fontWeight: 500 }}>{a.text}</td>
                        <td>
                          {a.assignee_name || a.assignee_id ? (
                            <span className="assignee-chip">{a.assignee_name || a.assignee_id}</span>
                          ) : (
                            <span style={{ color: 'var(--text-4)', fontStyle: 'italic', fontSize: '0.8rem' }}>Unassigned</span>
                          )}
                        </td>
                        <td>
                          {a.due_date ? (
                            <span className="due-chip">{a.due_date}</span>
                          ) : (
                            <span style={{ color: 'var(--text-4)' }}>—</span>
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
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              </motion.tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .action-items-wrapper { display: flex; flex-direction: column; gap: 14px; }
        .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .filter-pill {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 18px; border-radius: var(--r-full);
          background: var(--surface); border: 1px solid var(--border-2);
          font-size: 0.85rem; font-weight: 600; color: var(--text-2);
          box-shadow: var(--shadow-xs), var(--rim-light);
        }
        .filter-pill.active {
          background: var(--surface-2); border-color: var(--indigo);
          color: var(--indigo); box-shadow: var(--shadow-sm);
        }
        .filter-count {
          background: var(--indigo-bg); border-radius: var(--r-full);
          padding: 2px 8px; font-size: 0.7rem; font-weight: 700;
          font-family: var(--font-mono); color: var(--indigo);
        }
        .assignee-chip {
          display: inline-block; padding: 4px 12px;
          background: var(--surface-3); border: 1px solid var(--border);
          border-radius: var(--r-full); font-size: 0.8rem; color: var(--text);
          font-weight: 500;
        }
        .due-chip {
          font-family: var(--font-mono); font-size: 0.8rem;
          color: var(--gold); background: var(--gold-bg);
          border: 1px solid rgba(245,158,11,0.2);
          padding: 3px 10px; border-radius: var(--r-xs);
          font-weight: 600;
        }
        .priority-badge {
          font-size: 0.75rem; font-weight: 700;
          padding: 4px 12px; border-radius: var(--r-full);
          display: inline-flex; align-items: center; gap: 6px;
        }
        .empty-state {
          padding: 64px; text-align: center;
          color: var(--text-4); font-size: 1rem;
          border: 2px dashed var(--border-2); border-radius: var(--r-lg);
          background: var(--surface-2);
        }
      `}</style>
    </div>
  )
}
