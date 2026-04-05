'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Building2, Cpu, Activity, Shield, Search } from 'lucide-react'

type OverviewData = {
  totalOrgs: number
  totalUsers: number
  aiCallsThisMonth: number
  globalAiCap: number | null
  activeThisWeek: number
}

type OrgRow = {
  id: string
  name: string
  max_seats: number
  created_at: string
  business_name: string | null
  owner_name: string | null
  owner_email: string | null
  user_count: number
  ai_calls: number | null
}

type AiOrgRow = {
  org_id: string
  org_name: string
  business_name: string | null
  calls_used: number
  org_cap_override: string | null
  has_byok: boolean
}

type AiData = {
  globalCap: number | null
  totalCalls: number
  orgs: AiOrgRow[]
}

type UserRow = {
  id: string
  name: string
  email: string
  created_at: string
  last_login_at: string | null
  org_name: string | null
  business_name: string | null
  role_name: string | null
}

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [aiData, setAiData] = useState<AiData | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [orgSearch, setOrgSearch] = useState('')
  const [globalCapInput, setGlobalCapInput] = useState('')
  const [savingGlobalCap, setSavingGlobalCap] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, orgsRes, aiRes, usersRes] = await Promise.all([
        fetch('/api/admin', { credentials: 'include' }),
        fetch(`/api/admin/organizations${orgSearch ? `?search=${encodeURIComponent(orgSearch)}` : ''}`, { credentials: 'include' }),
        fetch('/api/admin/ai', { credentials: 'include' }),
        fetch(`/api/admin/users${userSearch ? `?search=${encodeURIComponent(userSearch)}` : ''}`, { credentials: 'include' }),
      ])

      if (overviewRes.status === 403) {
        router.push('/backend/dashboards')
        return
      }

      const [overviewJson, orgsJson, aiJson, usersJson] = await Promise.all([
        overviewRes.json(),
        orgsRes.json(),
        aiRes.json(),
        usersRes.json(),
      ])

      if (overviewJson.ok) setOverview(overviewJson.data)
      if (orgsJson.ok) setOrgs(orgsJson.data)
      if (aiJson.ok) {
        setAiData(aiJson.data)
        if (aiJson.data.globalCap !== null && !globalCapInput) {
          setGlobalCapInput(String(aiJson.data.globalCap))
        }
      }
      if (usersJson.ok) setUsers(usersJson.data)
    } catch {
      router.push('/backend/dashboards')
    } finally {
      setLoading(false)
    }
  }, [orgSearch, userSearch, router, globalCapInput])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function updateSeats(orgId: string, maxSeats: number) {
    if (maxSeats < 1 || isNaN(maxSeats)) return
    await fetch('/api/admin/organizations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orgId, maxSeats }),
    })
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, max_seats: maxSeats } : o))
  }

  async function saveGlobalCap() {
    const cap = parseInt(globalCapInput, 10)
    if (isNaN(cap) || cap < 0) return
    setSavingGlobalCap(true)
    await fetch('/api/admin/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'global', cap }),
    })
    setOverview(prev => prev ? { ...prev, globalAiCap: cap } : prev)
    setAiData(prev => prev ? { ...prev, globalCap: cap } : prev)
    setSavingGlobalCap(false)
  }

  async function setOrgCap(orgId: string, cap: number | null) {
    await fetch('/api/admin/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'org', orgId, cap }),
    })
    setAiData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        orgs: prev.orgs.map(o =>
          o.org_id === orgId ? { ...o, org_cap_override: cap !== null ? String(cap) : null } : o
        ),
      }
    })
  }

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full" />
          <span className="text-sm">Loading admin panel...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Platform Admin</h1>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{overview?.totalOrgs ?? 0}</p>
          <p className="text-xs text-muted-foreground">Organizations</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{overview?.totalUsers ?? 0}</p>
          <p className="text-xs text-muted-foreground">Total Users</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{overview?.aiCallsThisMonth ?? 0}</p>
          <p className="text-xs text-muted-foreground">AI Calls This Month</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{overview?.activeThisWeek ?? 0}</p>
          <p className="text-xs text-muted-foreground">Active This Week</p>
        </div>
      </div>

      {/* Organizations Table */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Organizations</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search orgs..."
              value={orgSearch}
              onChange={e => setOrgSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadData()}
              className="h-8 w-48 rounded-md border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="rounded-lg border overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Organization</th>
                <th className="text-left px-4 py-2 font-medium">Owner</th>
                <th className="text-right px-4 py-2 font-medium">Users</th>
                <th className="text-right px-4 py-2 font-medium">Seats</th>
                <th className="text-right px-4 py-2 font-medium">AI Calls</th>
                <th className="text-right px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-medium">{org.business_name || org.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{org.owner_email || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right">{org.user_count}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      defaultValue={org.max_seats}
                      min={1}
                      max={100}
                      className="w-16 text-sm text-right rounded border px-2 py-1 bg-background"
                      onBlur={e => {
                        const val = parseInt(e.target.value, 10)
                        if (val !== org.max_seats) updateSeats(org.id, val)
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{org.ai_calls || 0}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground text-right">
                    {new Date(org.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No organizations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* AI Usage & Caps */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">AI Usage & Caps</h2>
        <div className="rounded-lg border p-4 mb-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Global Monthly Cap:</label>
            <input
              type="number"
              value={globalCapInput}
              onChange={e => setGlobalCapInput(e.target.value)}
              min={0}
              className="w-28 text-sm rounded border px-2 py-1 bg-background"
            />
            <button
              onClick={saveGlobalCap}
              disabled={savingGlobalCap}
              className="px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {savingGlobalCap ? 'Saving...' : 'Save'}
            </button>
            <span className="text-xs text-muted-foreground">
              Total calls this month: <span className="font-medium text-foreground">{aiData?.totalCalls ?? 0}</span>
            </span>
          </div>
        </div>
        <div className="rounded-lg border overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Organization</th>
                <th className="text-right px-4 py-2 font-medium">Calls Used</th>
                <th className="text-right px-4 py-2 font-medium">Cap Override</th>
                <th className="text-center px-4 py-2 font-medium">BYOK</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {aiData?.orgs.map(org => (
                <tr key={org.org_id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-medium">{org.business_name || org.org_name}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{org.calls_used}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      defaultValue={org.org_cap_override ?? ''}
                      placeholder="Global"
                      min={0}
                      className="w-20 text-sm text-right rounded border px-2 py-1 bg-background"
                      onBlur={e => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null
                        const current = org.org_cap_override ? parseInt(org.org_cap_override, 10) : null
                        if (val !== current) setOrgCap(org.org_id, val)
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    {org.has_byok ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {org.org_cap_override && (
                      <button
                        onClick={() => setOrgCap(org.org_id, null)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Remove cap
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(!aiData?.orgs || aiData.orgs.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Users Table */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Users</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search users..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadData()}
              className="h-8 w-48 rounded-md border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="rounded-lg border overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Organization</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-right px-4 py-2 font-medium">Last Login</th>
                <th className="text-right px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-medium">{user.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3 text-sm">{user.business_name || user.org_name || '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                      {user.role_name || 'none'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground text-right">
                    {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground text-right">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
