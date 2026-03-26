'use client'

import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { X, DollarSign, Loader2 } from 'lucide-react'

interface CreateDealProps {
  contactName?: string
  contactId?: string
  onClose: () => void
  onCreated?: () => void
}

export function CreateDealModal({ contactName, contactId, onClose, onCreated }: CreateDealProps) {
  const [title, setTitle] = useState(contactName ? `Deal with ${contactName}` : '')
  const [value, setValue] = useState('')
  const [stage, setStage] = useState('New Lead')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createDeal() {
    if (!title.trim()) return
    setCreating(true)
    setError(null)
    try {
      // Use the customers API to create a deal
      const res = await fetch('/api/customers/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          valueAmount: value ? Number(value) : null,
          valueCurrency: 'USD',
          pipelineStage: stage,
          status: 'open',
          // Link to contact if provided
          ...(contactId ? { people: [{ entityId: contactId }] } : {}),
        }),
      })
      const data = await res.json()
      if (data.ok !== false && (data.id || data.data?.id)) {
        onCreated?.()
        onClose()
      } else {
        setError(data.error || 'Failed to create deal')
      }
    } catch {
      setError('Failed to create deal')
    }
    setCreating(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">New Deal</h2>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</p>}

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Deal Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Website redesign for Acme Co" className="h-9 text-sm" autoFocus />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Value ($)</label>
            <Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" className="h-9 text-sm" step="0.01" />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Pipeline Stage</label>
            <select value={stage} onChange={e => setStage(e.target.value)}
              className="w-full h-9 rounded-md border bg-card px-3 text-sm">
              <option value="New Lead">New Lead</option>
              <option value="Contacted">Contacted</option>
              <option value="Qualified">Qualified</option>
              <option value="Proposal">Proposal</option>
              <option value="Negotiation">Negotiation</option>
            </select>
          </div>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" onClick={createDeal} disabled={creating || !title.trim()}>
            {creating ? <><Loader2 className="size-3 animate-spin mr-1.5" /> Creating...</> : <><DollarSign className="size-3.5 mr-1.5" /> Create Deal</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
