import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
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

/** Floating stat card with 3D depth */
function StatCard({ value, label, icon, color = 'var(--p)' }: {
  value: string | number
  label: string
  icon: string
  color?: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ color }}>{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  )
}

export default function Overview() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  const [summary,   setSummary]   = useState<any>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview'|'topics'|'speakers'|'slides'>('overview')

  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/summary/${meetingId}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status} – ${r.statusText}`); return r.json() })
      .then(d => { setSummary(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [meetingId])

  if (loading) return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <div style={{
          width: 56, height: 56,
          border: '3px solid rgba(99,102,241,0.1)',
          borderTop: '3px solid var(--p)',
          borderRight: '3px solid var(--a)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
      <p style={{ color: 'var(--t-3)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
        Loading summary…
      </p>
    </div>
  )

  if (error || !summary) return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: '2.5rem' }}>⚠</div>
      <p style={{ color: 'var(--danger)' }}>Failed to load: {error}</p>
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
    { id: 'overview',  label: 'Overview',                  icon: '◈' },
    { id: 'topics',    label: `Topics · ${topics.length}`, icon: '◉' },
    { id: 'speakers',  label: `Speakers · ${speakers.length}`, icon: '◎' },
    ...(slides.length ? [{ id: 'slides', label: `Slides · ${slides.length}`, icon: '▣' }] : []),
  ] as { id: string; label: string; icon: string }[]

  return (
    <div className="page">
      {/* Grid background */}
      <div className="grid-bg" />

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
            ↓ Download Report
          </a>
        </div>
      </nav>

      {/* Header */}
      <div className="overview-header">
        <div className="container">
          <div className="overview-meta-row fade-in">
            <span className="badge badge-primary">{meta.meeting_type?.replace(/_/g,' ') || 'Meeting'}</span>
            <span className="badge badge-muted">{meta.tone || 'semi-formal'}</span>
            {meta.is_multilingual && <span className="badge badge-accent">Multilingual</span>}
            {summary.has_slides   && <span className="badge badge-accent">📊 Slides</span>}
            {overview.outcome && (
              <span className={`badge outcome-${overview.outcome}`}>
                {overview.outcome === 'productive' ? '✅' :
                 overview.outcome === 'action-heavy' ? '🎯' : 'ℹ️'} {overview.outcome}
              </span>
            )}
          </div>

          <h1 className="overview-title fade-in fade-in-1">
            {meta.title || 'Meeting Summary'}
          </h1>

          <div className="overview-stats fade-in fade-in-2">
            {meta.duration_formatted && (
              <div className="stat-chip">⏱ {meta.duration_formatted}</div>
            )}
            {meta.participant_count > 0 && (
              <div className="stat-chip">👥 {meta.participant_count} Participants</div>
            )}
            {meta.date && <div className="stat-chip">📅 {meta.date}</div>}
            {meta.language_primary && (
              <div className="stat-chip">🌐 {meta.language_primary.toUpperCase()}</div>
            )}
          </div>

          {/* Bento stat row */}
          <div className="bento-stats fade-in fade-in-3">
            <StatCard value={topics.length}      label="Topics"       icon="◉" color="var(--p-2)" />
            <StatCard value={actionItems.length}  label="Actions"      icon="▶" color="var(--a)" />
            <StatCard value={decisions.length}    label="Decisions"    icon="◈" color="var(--g)" />
            <StatCard value={keyPoints.length}    label="Key Points"   icon="✦" color="var(--success)" />
            <StatCard value={speakers.length}     label="Speakers"     icon="◎" color="var(--p-3)" />
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
                onClick={() => setActiveTab(id as any)}
              >
                <span style={{ opacity: 0.7 }}>{icon}</span> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="container overview-content" style={{ position: 'relative', zIndex: 1 }}>

        {activeTab === 'overview' && (
          <div className="tab-panel">
            {/* Executive Summary */}
            {overview.executive_summary && (
              <section className="content-section">
                <div className="section-label">Executive Summary</div>
                <div className="exec-summary card">
                  <p style={{ color: 'var(--t-1)', lineHeight: 1.85, fontSize: '0.96rem' }}>
                    {overview.executive_summary}
                  </p>
                </div>
              </section>
            )}

            {/* Two-column grid: Highlights + Decisions */}
            <div className="overview-grid-2">
              {overview.highlights?.length > 0 && (
                <section>
                  <div className="section-label">Highlights</div>
                  <div className="highlight-box card">
                    <ul className="highlights-list">
                      {overview.highlights.map((h: string, i: number) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {decisions.length > 0 && (
                <section>
                  <div className="section-label">Decisions Made ({decisions.length})</div>
                  <div className="decisions-list">
                    {decisions.map((d: any) => (
                      <div key={d.decision_id} className="decision-item">
                        <div className="decision-text">{d.text}</div>
                        {(d.decided_by_name || d.decided_by_id) && (
                          <div className="decision-by">
                            <span className="ts-chip">{fmtTs(d.timestamp)}</span>
                            <span>by <strong style={{ color: 'var(--t-1)' }}>{d.decided_by_name || d.decided_by_id}</strong></span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Action Items */}
            {actionItems.length > 0 && (
              <section className="content-section">
                <div className="section-label">Action Items ({actionItems.length})</div>
                <ActionItemsTable items={actionItems} />
              </section>
            )}
          </div>
        )}

        {activeTab === 'topics' && (
          <div className="tab-panel">
            <TopicAccordion topics={topics} keyPoints={keyPoints} />
          </div>
        )}

        {activeTab === 'speakers' && (
          <div className="tab-panel">
            <SpeakerCards speakers={speakers} actionItems={actionItems} />
          </div>
        )}

        {activeTab === 'slides' && (
          <div className="tab-panel">
            <SlideViewer slides={slides} topics={topics} />
          </div>
        )}
      </main>

      <style>{`
        .bento-stats {
          display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px;
        }
        .stat-card {
          display: flex; flex-direction: column; align-items: center;
          gap: 4px; padding: 14px 22px;
          background: var(--glass-dark);
          backdrop-filter: blur(20px);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--s-sm), var(--rim);
          min-width: 90px;
          transition: all 0.2s var(--ease-expo);
        }
        .stat-card:hover {
          transform: translateY(-3px);
          border-color: var(--border-strong);
          box-shadow: var(--s-md), var(--s-p);
        }
        .stat-card-icon  { font-size: 1rem; }
        .stat-card-value { font-family: var(--font-display); font-size: 1.6rem; font-weight: 700; color: var(--t-0); line-height: 1; }
        .stat-card-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-3); }
        .overview-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
        @media (max-width: 768px) { .overview-grid-2 { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
