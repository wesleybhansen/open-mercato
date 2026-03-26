'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { DollarSign, Users, TrendingUp, FileText, Calendar, BarChart3 } from 'lucide-react'

interface ReportData {
  pipelineByStage: Array<{ stage: string; count: string; value: string }>
  dealOutcomes: { won: number; lost: number; revenue: number }
  contactsBySource: Array<{ source: string; count: string }>
  contactsOverTime: Array<{ day: string; count: string }>
  landingPagePerf: Array<{ title: string; view_count: number; submission_count: number }>
  paymentRevenue: { total: number; thisMonth: number; lastMonth: number }
  bookingStats: { upcoming: number; thisMonth: number }
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reports', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading reports...</div>
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Failed to load reports.</div>

  const maxPipelineCount = Math.max(...data.pipelineByStage.map(s => Number(s.count)), 1)
  const maxSourceCount = Math.max(...data.contactsBySource.map(s => Number(s.count)), 1)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-lg font-semibold mb-6">Reports</h1>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard icon={DollarSign} label="Revenue (30d)" value={`$${data.dealOutcomes.revenue.toLocaleString()}`}
          sub={`${data.dealOutcomes.won} deals won`} />
        <KpiCard icon={DollarSign} label="Payments (30d)" value={`$${data.paymentRevenue.thisMonth.toLocaleString()}`}
          sub={data.paymentRevenue.lastMonth > 0 ? `$${data.paymentRevenue.lastMonth.toLocaleString()} prev month` : 'No payments last month'} />
        <KpiCard icon={Users} label="New Contacts (30d)" value={String(data.contactsOverTime.reduce((s, d) => s + Number(d.count), 0))}
          sub={`${data.contactsBySource.length} sources`} />
        <KpiCard icon={Calendar} label="Bookings (30d)" value={String(data.bookingStats.thisMonth)}
          sub={`${data.bookingStats.upcoming} upcoming`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pipeline by Stage */}
        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" /> Pipeline by Stage
          </h2>
          {data.pipelineByStage.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No deals yet.</p>
          ) : (
            <div className="space-y-3">
              {data.pipelineByStage.map((stage, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{stage.stage || 'Unassigned'}</span>
                    <span className="text-xs text-muted-foreground">{stage.count} deals · ${Number(stage.value || 0).toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(Number(stage.count) / maxPipelineCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contacts by Source */}
        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" /> Contacts by Source
          </h2>
          {data.contactsBySource.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No contacts yet.</p>
          ) : (
            <div className="space-y-3">
              {data.contactsBySource.map((source, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize">{source.source.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground">{source.count}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(Number(source.count) / maxSourceCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deal Outcomes */}
        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" /> Deal Outcomes (30 days)
          </h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.dealOutcomes.won}</p>
              <p className="text-xs text-muted-foreground">Won</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.dealOutcomes.lost}</p>
              <p className="text-xs text-muted-foreground">Lost</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{data.dealOutcomes.won + data.dealOutcomes.lost > 0 ? Math.round((data.dealOutcomes.won / (data.dealOutcomes.won + data.dealOutcomes.lost)) * 100) : 0}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
          </div>
        </div>

        {/* Landing Page Performance */}
        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" /> Landing Page Performance
          </h2>
          {data.landingPagePerf.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No published pages.</p>
          ) : (
            <div className="space-y-2">
              {data.landingPagePerf.map((page, i) => {
                const conv = page.view_count > 0 ? ((page.submission_count / page.view_count) * 100).toFixed(1) : '0'
                return (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-xs font-medium truncate flex-1 mr-4">{page.title}</span>
                    <div className="flex gap-4 text-xs text-muted-foreground shrink-0 tabular-nums">
                      <span>{page.view_count} views</span>
                      <span>{page.submission_count} leads</span>
                      <span className="font-medium text-foreground">{conv}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className="size-4 text-muted-foreground/40" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  )
}
