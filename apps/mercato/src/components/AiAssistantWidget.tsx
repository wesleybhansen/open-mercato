'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Loader2, Sparkles } from 'lucide-react'

type Message = { role: 'user' | 'assistant'; content: string }

export function AiAssistantWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your CRM assistant. I can help you navigate the app, create contacts, build landing pages, and more. What can I help with?" },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: newMessages.slice(-10), // last 10 messages for context
          currentPage: document.title,
        }),
      })
      const data = await res.json()
      setMessages([...newMessages, {
        role: 'assistant',
        content: data.message || data.error || 'Something went wrong.',
      }])
    } catch {
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Connection error. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Quick actions
  const quickActions = [
    { label: 'How do I add a contact?', icon: '👤' },
    { label: 'How do I create a landing page?', icon: '📄' },
    { label: 'How do I create a deal?', icon: '💰' },
    { label: 'What can this CRM do?', icon: '✨' },
  ]

  return (
    <>
      {/* Toggle button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent text-white shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
          aria-label="Open AI Assistant"
        >
          <Sparkles className="size-5" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[380px] h-[520px] rounded-2xl border bg-background shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <Sparkles className="size-3.5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold">AI Assistant</p>
                <p className="text-[10px] text-muted-foreground">Ask me anything about the CRM</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-2xl rounded-br-sm'
                    : 'bg-muted rounded-2xl rounded-bl-sm'
                }`}>
                  {msg.content.split('\n').map((line, j) => {
                    // Simple markdown: **bold**
                    const formatted = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    return <p key={j} className={j > 0 ? 'mt-1' : ''} dangerouslySetInnerHTML={{ __html: formatted }} />
                  })}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />

            {/* Quick actions (only show when no user messages yet) */}
            {messages.length <= 1 && (
              <div className="space-y-1.5 pt-2">
                <p className="text-[11px] text-muted-foreground font-medium">Quick questions:</p>
                {quickActions.map((action) => (
                  <button key={action.label} type="button"
                    onClick={async () => {
                      const msg: Message = { role: 'user', content: action.label }
                      const newMsgs = [...messages, msg]
                      setMessages(newMsgs)
                      setLoading(true)
                      try {
                        const res = await fetch('/api/ai/assistant', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                          body: JSON.stringify({ messages: newMsgs.slice(-10), currentPage: document.title }),
                        })
                        const data = await res.json()
                        setMessages([...newMsgs, { role: 'assistant', content: data.message || 'Something went wrong.' }])
                      } catch {
                        setMessages([...newMsgs, { role: 'assistant', content: 'Connection error.' }])
                      }
                      setLoading(false)
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg border text-xs hover:bg-muted transition flex items-center gap-2">
                    <span>{action.icon}</span> {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t px-3 py-2.5">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                disabled={loading}
                className="flex-1 rounded-lg border bg-card px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent min-h-[36px] max-h-[80px]"
                rows={1}
              />
              <button type="button" onClick={send} disabled={!input.trim() || loading}
                className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center disabled:opacity-50 shrink-0">
                <Send className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
