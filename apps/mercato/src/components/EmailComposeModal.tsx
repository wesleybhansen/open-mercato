'use client'

import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { X, Send, Sparkles, Loader2 } from 'lucide-react'

interface EmailComposeProps {
  contactName: string
  contactEmail: string
  contactId?: string
  onClose: () => void
  onSent?: () => void
}

export function EmailComposeModal({ contactName, contactEmail, contactId, onClose, onSent }: EmailComposeProps) {
  const [to, setTo] = useState(contactEmail)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purpose, setPurpose] = useState('follow-up')

  async function draftWithAI() {
    setDrafting(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contactName, contactEmail, purpose }),
      })
      const data = await res.json()
      if (data.ok) {
        setSubject(data.subject)
        setBody(data.body)
      } else {
        setError(data.error || 'Failed to draft')
      }
    } catch {
      setError('Failed to connect')
    }
    setDrafting(false)
  }

  async function sendEmail() {
    if (!to || !subject || !body) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/email/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          to, subject, bodyHtml: body.replace(/\n/g, '<br>'),
          bodyText: body, contactId,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setSent(true)
        setTimeout(() => { onSent?.(); onClose() }, 1500)
      } else {
        setError(data.error || 'Failed to send')
      }
    } catch {
      setError('Failed to send')
    }
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">
            {sent ? 'Email Sent' : `Email to ${contactName}`}
          </h2>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        {sent ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
              <Send className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-medium">Email sent to {contactName}</p>
            <p className="text-xs text-muted-foreground mt-1">Tracking is active — you'll see opens and clicks.</p>
          </div>
        ) : (
          <>
            {/* AI Draft bar */}
            <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
              <Sparkles className="size-3.5 text-accent shrink-0" />
              <select value={purpose} onChange={e => setPurpose(e.target.value)}
                className="text-xs bg-transparent border rounded px-2 py-1 text-muted-foreground flex-1 max-w-[180px]">
                <option value="follow-up">Follow up</option>
                <option value="introduction">Introduction</option>
                <option value="check-in">Check in</option>
                <option value="thank-you">Thank you</option>
                <option value="proposal">Send proposal</option>
                <option value="meeting-request">Request meeting</option>
              </select>
              <Button type="button" size="sm" variant="outline" onClick={draftWithAI} disabled={drafting}>
                {drafting ? <><Loader2 className="size-3 animate-spin mr-1" /> Drafting...</> : <><Sparkles className="size-3 mr-1" /> AI Draft</>}
              </Button>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
              {error && (
                <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</p>
              )}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">To</label>
                <Input value={to} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Subject</label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject..." className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Body</label>
                <textarea value={body} onChange={e => setBody(e.target.value)}
                  placeholder="Write your email..."
                  className="w-full rounded-md border bg-card px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring h-40" />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button type="button" size="sm" onClick={sendEmail} disabled={sending || !to || !subject || !body}>
                {sending ? <><Loader2 className="size-3 animate-spin mr-1.5" /> Sending...</> : <><Send className="size-3.5 mr-1.5" /> Send</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
