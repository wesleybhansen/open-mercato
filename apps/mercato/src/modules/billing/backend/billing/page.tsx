'use client'

import { useState, useEffect } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { Button } from '@open-mercato/ui/primitives/button'
import { CreditCard, Plus, ArrowUpRight, ArrowDownRight } from 'lucide-react'

type CreditPackage = {
  id: string
  name: string
  credit_amount: string
  price: string
}

type Transaction = {
  id: string
  amount: string
  type: string
  description: string
  service: string | null
  created_at: string
}

export default function BillingPage() {
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)
  const [balance, setBalance] = useState(0)
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/billing/balance').then((r) => r.json()),
      fetch('/api/billing/transactions').then((r) => r.json()),
    ]).then(([balanceData, txData]) => {
      if (balanceData.ok) {
        setBalance(balanceData.data.balance || 0)
        setPackages(balanceData.data.packages || [])
      }
      if (txData.ok) setTransactions(txData.data || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold mb-6">{translate('billing.balance.title', 'Credit Balance')}</h1>

      {/* Balance Card */}
      <div className="rounded-xl border bg-card p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current Balance</p>
            <p className="text-4xl font-bold tabular-nums mt-1">${balance.toFixed(2)}</p>
          </div>
          <div className="size-12 rounded-full bg-accent/10 flex items-center justify-center">
            <CreditCard className="size-6 text-accent" />
          </div>
        </div>
        {balance < 5 && (
          <p className="text-sm text-amber-600 dark:text-amber-400 mt-3">
            {translate('billing.balance.lowBalance', 'Low balance — add credits to keep sending')}
          </p>
        )}
      </div>

      {/* Credit Packages */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {translate('billing.packages.title', 'Credit Packages')}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {packages.map((pkg) => (
          <div key={pkg.id} className="rounded-lg border bg-card p-5 hover:border-accent/50 transition cursor-pointer">
            <p className="font-semibold text-lg">{pkg.name}</p>
            <p className="text-2xl font-bold mt-2">${parseFloat(pkg.price).toFixed(2)}</p>
            <p className="text-sm text-muted-foreground mt-1">${parseFloat(pkg.credit_amount).toFixed(2)} in credits</p>
            <Button type="button" size="sm" className="mt-4 w-full">
              <Plus className="size-3 mr-1" /> Buy
            </Button>
          </div>
        ))}
      </div>

      {/* Transaction History */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {translate('billing.transactions.title', 'Transaction History')}
      </h2>
      {transactions.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
          {translate('billing.transactions.empty', 'No transactions yet')}
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {transactions.map((tx) => {
            const isCredit = parseFloat(tx.amount) > 0
            return (
              <div key={tx.id} className="flex items-center gap-4 px-4 py-3">
                <div className={`size-8 rounded-full flex items-center justify-center ${
                  isCredit ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {isCredit ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{tx.description}</p>
                  {tx.service && <p className="text-xs text-muted-foreground">{tx.service}</p>}
                </div>
                <div className={`text-sm font-medium tabular-nums ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {isCredit ? '+' : ''}{parseFloat(tx.amount).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(tx.created_at).toLocaleDateString()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
