import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './Chat.css'

interface Message {
  role: 'user' | 'bot'
  text: string
  tier?: string
  confidence?: number
  sources?: string[]
}

export default function Chat() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [questions, setQuestions] = useState<string[]>([])
  const [title, setTitle]       = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load suggested questions + meeting title
  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/chat/${meetingId}/questions`)
      .then(r => r.json())
      .then(d => setQuestions(d.questions || []))
      .catch(() => {})

    fetch(`/api/summary/${meetingId}`)
      .then(r => r.json())
      .then(d => setTitle(d?.metadata?.title || ''))
      .catch(() => {})

    // Welcome message
    setMessages([{
      role: 'bot',
      text: "👋 Hey! I've analysed this meeting. Ask me anything — action items, decisions, what someone said, or a topic summary.",
    }])
  }, [meetingId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (query: string) => {
    if (!query.trim() || loading || !meetingId) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: query }])
    setLoading(true)

    try {
      const res = await fetch(`/api/chat/${meetingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      setMessages(m => [...m, {
        role: 'bot',
        text: data.answer,
        tier: data.tier_name,
        confidence: data.confidence,
        sources: data.sources,
      }])
    } catch {
      setMessages(m => [...m, { role: 'bot', text: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div className="page chat-page">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-logo">⚡ Botzilla</Link>
        <div className="navbar-actions">
          {meetingId && (
            <Link to={`/overview/${meetingId}`} className="btn btn-ghost">← Overview</Link>
          )}
        </div>
      </nav>

      {/* Chat header */}
      <div className="chat-header">
        <div className="container">
          <h2 style={{ fontSize:'1.1rem', fontWeight:700 }}>
            💬 Ask about this meeting
          </h2>
          {title && <p style={{ color:'var(--c-text-subtle)', fontSize:'0.82rem', marginTop:2 }}>{title}</p>}
        </div>
      </div>

      {/* Suggested questions */}
      {questions.length > 0 && messages.length <= 1 && (
        <div className="suggested-strip">
          <div className="container">
            <div className="suggested-label">Try asking</div>
            <div className="suggested-chips">
              {questions.map((q, i) => (
                <button key={i} className="suggested-chip" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages-area">
        <div className="container chat-messages-inner">
          {messages.map((m, i) => (
            <div key={i} className={`chat-row ${m.role}`}>
              {m.role === 'bot' && (
                <div className="bot-avatar">⚡</div>
              )}
              <div className={`chat-bubble chat-bubble-${m.role === 'user' ? 'user' : 'bot'}`}>
                {m.text.split('\n').map((line, li) => (
                  <span key={li}>{line}{li < m.text.split('\n').length - 1 && <br />}</span>
                ))}
                {m.role === 'bot' && m.tier && (
                  <div className="chat-meta">
                    {m.tier === 'JSON Lookup' && <span className="tier-chip tier-1">⚡ Instant</span>}
                    {m.tier === 'TF-IDF'      && <span className="tier-chip tier-2">🔍 Search</span>}
                    {m.tier === 'Gemini'       && <span className="tier-chip tier-3">🧠 Gemini</span>}
                    {m.confidence !== undefined && (
                      <span className="confidence-chip">
                        {Math.round(m.confidence * 100)}% match
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-row bot">
              <div className="bot-avatar">⚡</div>
              <div className="chat-bubble chat-bubble-bot typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="container">
          <div className="chat-input-box">
            <textarea
              id="chat-input"
              className="chat-textarea"
              placeholder="Ask anything about this meeting…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={loading}
            />
            <button
              id="chat-send-btn"
              className="btn btn-primary send-btn"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
            >
              {loading ? <span className="spinner" style={{width:16,height:16,borderWidth:2}} /> : '↑'}
            </button>
          </div>
          <p className="chat-hint">Press Enter to send · Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
