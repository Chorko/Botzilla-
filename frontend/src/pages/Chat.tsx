import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import './Chat.css'

interface Message {
  role: 'user' | 'bot'
  text: string
  tier?: string
  confidence?: number
}

export default function Chat() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [questions, setQuestions] = useState<string[]>([])
  const [title,     setTitle]     = useState('')
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!meetingId) return
    fetch(`/api/chat/${meetingId}/questions`)
      .then(r => r.json()).then(d => setQuestions(d.questions || [])).catch(() => {})
    fetch(`/api/summary/${meetingId}`)
      .then(r => r.json()).then(d => setTitle(d?.metadata?.title || 'this meeting')).catch(() => {})
    setMessages([{ role: 'bot', text: "Hey! I've analysed this meeting in full. Ask me anything — action items, speaker contributions, decisions, or a topic summary." }])
  }, [meetingId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

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
        text: data.answer || 'No answer returned.',
        tier: data.tier_name,
        confidence: data.confidence,
      }])
    } catch {
      setMessages(m => [...m, { role: 'bot', text: 'Something went wrong. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const TIER_LABELS: Record<string, { label: string; cls: string }> = {
    'JSON Lookup': { label: '⚡ Instant',  cls: 'tier-1' },
    'TF-IDF':      { label: '🔍 Search',   cls: 'tier-2' },
    'Gemini':      { label: '🧠 Gemini',   cls: 'tier-3' },
  }

  return (
    <div className="page chat-page">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-logo">
          <span className="navbar-logo-icon">⚡</span>
          Botzilla
        </Link>
        <div className="navbar-actions">
          {meetingId && (
            <Link to={`/overview/${meetingId}`} className="btn btn-ghost">
              ← Overview
            </Link>
          )}
        </div>
      </nav>

      {/* Chat header */}
      <div className="chat-header">
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <motion.div
              style={{
                width: 38, height: 38,
                background: 'linear-gradient(135deg, var(--indigo), var(--cyan))',
                borderRadius: 'var(--r-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.15rem',
                boxShadow: 'var(--shadow-indigo)',
              }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              💬
            </motion.div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
                Ask about this meeting
              </div>
              {title && (
                <div style={{ color: 'var(--text-4)', fontSize: '0.78rem', marginTop: 1 }}>
                  {title}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Suggested questions */}
      <AnimatePresence>
        {questions.length > 0 && messages.length <= 1 && (
          <motion.div
            className="suggested-strip"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="container">
              <div className="suggested-label">Try asking</div>
              <div className="suggested-chips">
                {questions.map((q, i) => (
                  <motion.button
                    key={i}
                    className="suggested-chip"
                    onClick={() => send(q)}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {q}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="chat-messages-area">
        <div className="container chat-messages-inner">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                className={`chat-row ${m.role}`}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.16,1,0.3,1] }}
              >
                {m.role === 'bot' && (
                  <div className="bot-avatar">⚡</div>
                )}
                <div>
                  <div className={`chat-bubble chat-bubble-${m.role === 'user' ? 'user' : 'bot'}`}>
                    {m.text.split('\n').map((line, li, arr) => (
                      <span key={li}>{line}{li < arr.length - 1 && <br />}</span>
                    ))}
                  </div>
                  {m.role === 'bot' && m.tier && (
                    <div className="chat-meta">
                      {TIER_LABELS[m.tier] && (
                        <span className={`tier-chip ${TIER_LABELS[m.tier].cls}`}>
                          {TIER_LABELS[m.tier].label}
                        </span>
                      )}
                      {m.confidence !== undefined && (
                        <span className="confidence-chip">
                          {Math.round(m.confidence * 100)}% match
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div
              className="chat-row bot"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="bot-avatar">⚡</div>
              <div className="chat-bubble chat-bubble-bot typing-indicator">
                <span /><span /><span />
              </div>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <div className="container">
          <div className="chat-input-box">
            <textarea
              ref={textareaRef}
              id="chat-input"
              className="chat-textarea"
              placeholder="Ask anything about this meeting…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              rows={1}
              disabled={loading}
            />
            <motion.button
              id="chat-send-btn"
              className="btn btn-primary send-btn"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
            >
              {loading
                ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
                : '↑'
              }
            </motion.button>
          </div>
          <p className="chat-hint">Enter to send · Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
