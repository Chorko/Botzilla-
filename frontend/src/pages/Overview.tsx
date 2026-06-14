import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import TopicAccordion from '../components/TopicAccordion'
import ActionItemsTable from '../components/ActionItemsTable'
import SpeakerCards from '../components/SpeakerCards'
import SlideViewer from '../components/SlideViewer'
import './Overview.css'

export default function Overview() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview'|'topics'|'speakers'|'slides'>('overview')

  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/summary/${meetingId}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(d => { setSummary(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [meetingId])

  if (loading) return (
    <div className="page" style={{ alignItems:'center', justifyContent:'center', gap:16 }}>
      <div className="spinner" style={{ width:40, height:40, borderWidth:4 }} />
      <p>Loading summary…</p>
    </div>
  )

  if (error || !summary) return (
    <div className="page" style={{ alignItems:'center', justifyContent:'center', gap:12 }}>
      <p style={{ color:'var(--c-danger)' }}>Failed to load summary: {error}</p>
      <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back to Upload</button>
    </div>
  )

  const meta = summary.metadata || {}
  const overview = summary.overview || {}
  const topics = summary.topics || []
  const keyPoints = summary.key_points || []
  const decisions = summary.decisions || []
  const actionItems = summary.action_items || []
  const speakers = summary.speaker_contributions || []
  const slides = summary.slides || []

  return (
    <div className="page">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-logo">⚡ Botzilla</Link>
        <div className="navbar-actions">
          <Link to={`/chat/${meetingId}`} className="btn btn-primary">
            💬 Ask Botzilla
          </Link>
          <a
            href={`/api/docx/${meetingId}`}
            download
            className="btn btn-ghost"
          >↓ Download Report</a>
        </div>
      </nav>

      {/* Meeting header */}
      <div className="overview-header">
        <div className="container">
          <div className="overview-meta-row fade-in">
            <span className="badge badge-primary">{meta.meeting_type?.replace('_',' ') || 'Meeting'}</span>
            <span className="badge badge-muted">{meta.tone || 'semi-formal'}</span>
            {meta.is_multilingual && <span className="badge badge-accent">Multilingual</span>}
            {summary.has_slides && <span className="badge badge-accent">📊 Slides</span>}
          </div>
          <h1 className="overview-title fade-in fade-in-1">{meta.title || 'Meeting Summary'}</h1>
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
            <div className={`stat-chip outcome-${overview.outcome}`}>
              {overview.outcome === 'productive' ? '✅' :
               overview.outcome === 'action-heavy' ? '🎯' :
               overview.outcome === 'informational' ? 'ℹ️' : '📋'} {overview.outcome}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="overview-tabs">
        <div className="container">
          <div className="tab-list">
            {([
              ['overview',  '📋 Overview'],
              ['topics',    `💬 Topics (${topics.length})`],
              ['speakers',  `👥 Speakers (${speakers.length})`],
              ...(slides.length ? [['slides', `🖼 Slides (${slides.length})`] as [string,string]] : []),
            ] as [string,string][]).map(([id, label]) => (
              <button
                key={id}
                className={`tab-btn ${activeTab === id ? 'active' : ''}`}
                onClick={() => setActiveTab(id as any)}
              >{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="container overview-content">

        {activeTab === 'overview' && (
          <div className="tab-panel fade-in">
            {/* Executive Summary */}
            <section className="content-section">
              <div className="section-label">Executive Summary</div>
              <div className="card exec-summary">
                <p style={{ color:'var(--c-text)', lineHeight:1.8 }}>{overview.executive_summary}</p>
              </div>
            </section>

            {/* Highlights */}
            {overview.highlights?.length > 0 && (
              <section className="content-section">
                <div className="section-label">Highlights</div>
                <div className="highlight-box">
                  <ul className="highlights-list">
                    {overview.highlights.map((h: string, i: number) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Decisions */}
            {decisions.length > 0 && (
              <section className="content-section">
                <div className="section-label">Decisions Made</div>
                <div className="decisions-list">
                  {decisions.map((d: any) => (
                    <div key={d.decision_id} className="decision-item card">
                      <div className="decision-text">{d.text}</div>
                      {(d.decided_by_name || d.decided_by_id) && (
                        <div className="decision-by">
                          <span className="ts-chip">{formatTs(d.timestamp)}</span>
                          <span>decided by <strong>{d.decided_by_name || d.decided_by_id}</strong></span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

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
          <div className="tab-panel fade-in">
            <TopicAccordion topics={topics} keyPoints={keyPoints} />
          </div>
        )}

        {activeTab === 'speakers' && (
          <div className="tab-panel fade-in">
            <SpeakerCards speakers={speakers} actionItems={actionItems} />
          </div>
        )}

        {activeTab === 'slides' && (
          <div className="tab-panel fade-in">
            <SlideViewer slides={slides} topics={topics} />
          </div>
        )}
      </main>
    </div>
  )
}

function formatTs(sec: number): string {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2,'0')}`
}
