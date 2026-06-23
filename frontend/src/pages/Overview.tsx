import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import TopicAccordion from '../components/TopicAccordion'
import ActionItemsTable from '../components/ActionItemsTable'
import SpeakerCards from '../components/SpeakerCards'
import SlideViewer from '../components/SlideViewer'
import './Overview.css'

function fmtTs(sec: number): string {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2,'0')}`
}

function StatCard({ value, label, icon, delay = 0 }: {
  value: string | number; label: string; icon: string; delay?: number
}) {
  return (
    <motion.div
      className="stat-card"
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -5, scale: 1.03 }}
    >
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </motion.div>
  )
}

export default function Overview() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  const [summary,   setSummary]   = useState<any>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('overview')

  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/summary/${meetingId}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(d => { setSummary(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [meetingId])

  if (loading) return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{ width: 48, height: 48, border: '3px solid var(--indigo-4)', borderTopColor: 'var(--indigo)', borderRadius: '50%' }}
      />
      <p style={{ color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
        Loading summary…
      </p>
    </div>
  )

  if (error || !summary) return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: '2.5rem' }}>⚠</div>
      <p style={{ color: 'var(--red)' }}>Failed to load: {error}</p>
      <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back to Upload</button>
    </div>
  )

  const meta        = summary.metadata              || {}
  const overview    = summary.overview              || {}
  const topics      = summary.topics                || []
  const keyPoints   = summary.key_points            || []
  const decisions   = summary.decisions             || []
  const actionItems = summary.action_items          || []
  const speakers    = summary.speaker_contributions || []
  const slides      = summary.slides                || []

  const tabs = [
    { id: 'overview',  label: 'Overview',                       icon: '◈' },
    { id: 'topics',    label: `Topics (${topics.length})`,       icon: '◉' },
    { id: 'speakers',  label: `Speakers (${speakers.length})`,   icon: '◎' },
    ...(slides.length ? [{ id: 'slides', label: `Slides (${slides.length})`, icon: '▣' }] : []),
  ]

  return (
    <div className="page">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-logo">
          <span className="navbar-logo-icon">⚡</span>
          Botzilla
        </Link>
        <div className="navbar-actions">
          <Link to={`/chat/${meetingId}`} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.82rem' }}>
            💬 Ask AI
          </Link>
          <a href={`/api/docx/${meetingId}`} download className="btn btn-ghost" style={{ padding: '8px 16px', fontSize: '0.82rem' }}>
            ↓ Report
          </a>
        </div>
      </nav>

      {/* Header */}
      <div className="overview-header">
        <div className="container">
          <motion.div
            className="overview-meta-row"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="badge badge-primary">{meta.meeting_type?.replace(/_/g,' ') || 'Meeting'}</span>
            <span className="badge badge-muted">{meta.tone || 'semi-formal'}</span>
            {meta.is_multilingual && <span className="badge badge-accent">Multilingual</span>}
            {overview.outcome && (
              <span className={`badge outcome-${overview.outcome}`}>
                {overview.outcome === 'productive' ? '✅' : overview.outcome === 'action-heavy' ? '🎯' : 'ℹ️'} {overview.outcome}
              </span>
            )}
            {overview.sentiment && <span className="badge badge-muted">{overview.sentiment}</span>}
          </motion.div>

          <motion.h1
            className="overview-title"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5, ease: [0.16,1,0.3,1] }}
          >
            {meta.title || 'Meeting Summary'}
          </motion.h1>

          <motion.div
            className="overview-stats"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14, duration: 0.4 }}
          >
            {meta.duration_formatted && <div className="stat-chip">⏱ {meta.duration_formatted}</div>}
            {meta.participant_count > 0 && <div className="stat-chip">👥 {meta.participant_count} participants</div>}
            {meta.date && <div className="stat-chip">📅 {meta.date}</div>}
            {meta.language_primary && <div className="stat-chip">🌐 {meta.language_primary.toUpperCase()}</div>}
          </motion.div>

          {/* Bento stats */}
          <div className="bento-stats">
            <StatCard value={topics.length}      label="Topics"     icon="◉" delay={0.18} />
            <StatCard value={actionItems.length}  label="Actions"    icon="▶" delay={0.22} />
            <StatCard value={decisions.length}    label="Decisions"  icon="◈" delay={0.26} />
            <StatCard value={keyPoints.length}    label="Key Points" icon="✦" delay={0.30} />
            <StatCard value={speakers.length}     label="Speakers"   icon="◎" delay={0.34} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="overview-tabs">
        <div className="container">
          <div className="tab-list">
            {tabs.map(({ id, label, icon }) => (
              <button
                key={id}
                className={`tab-btn ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                <span style={{ opacity: 0.6 }}>{icon}</span> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="container overview-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="tab-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16,1,0.3,1] }}
          >
            {activeTab === 'overview' && (
              <>
                {overview.executive_summary && (
                  <section className="content-section">
                    <div className="section-label">Executive Summary</div>
                    <div className="exec-summary card">
                      <p>{overview.executive_summary}</p>
                    </div>
                  </section>
                )}

                <div className="overview-grid-2">
                  {overview.highlights?.length > 0 && (
                    <section>
                      <div className="section-label">Highlights</div>
                      <div className="highlight-box card">
                        <ul className="highlights-list">
                          {overview.highlights.map((h: string, i: number) => (
                            <motion.li
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                            >
                              {h}
                            </motion.li>
                          ))}
                        </ul>
                      </div>
                    </section>
                  )}

                  {decisions.length > 0 && (
                    <section>
                      <div className="section-label">Decisions Made ({decisions.length})</div>
                      <div className="decisions-list">
                        {decisions.map((d: any, i: number) => (
                          <motion.div
                            key={d.decision_id}
                            className="decision-item"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.06 }}
                          >
                            <div className="decision-text">{d.text}</div>
                            {(d.decided_by_name || d.decided_by_id) && (
                              <div className="decision-by">
                                <span className="ts-chip">{fmtTs(d.timestamp)}</span>
                                <span>by <strong style={{ color: 'var(--text-2)' }}>{d.decided_by_name || d.decided_by_id}</strong></span>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                {actionItems.length > 0 && (
                  <section className="content-section">
                    <div className="section-label">Action Items ({actionItems.length})</div>
                    <ActionItemsTable items={actionItems} />
                  </section>
                )}
              </>
            )}

            {activeTab === 'topics' && (
              <TopicAccordion topics={topics} keyPoints={keyPoints} />
            )}

            {activeTab === 'speakers' && (
              <SpeakerCards speakers={speakers} actionItems={actionItems} />
            )}

            {activeTab === 'slides' && (
              <SlideViewer slides={slides} topics={topics} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <style>{`
        .bento-stats {
          display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px;
        }
        .stat-card {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          padding: 14px 20px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-sm), var(--rim-light);
          min-width: 90px; cursor: default;
          transition: box-shadow 0.2s;
        }
        .stat-card-icon  { font-size: 1rem; color: var(--indigo); }
        .stat-card-value {
          font-family: var(--font-display);
          font-size: 1.7rem; font-weight: 700; color: var(--text); line-height: 1;
        }
        .stat-card-label {
          font-size: 0.64rem; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text-4);
        }
        .overview-grid-2 {
          display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px;
        }
        @media (max-width: 768px) { .overview-grid-2 { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
