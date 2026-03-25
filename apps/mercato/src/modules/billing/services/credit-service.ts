import type { Knex } from 'knex'

export class CreditService {
  constructor(private knex: Knex) {}

  async getBalance(organizationId: string): Promise<number> {
    const balance = await this.knex('credit_balances').where('organization_id', organizationId).first()
    return balance ? parseFloat(balance.balance) : 0
  }

  async ensureBalance(tenantId: string, organizationId: string): Promise<void> {
    const exists = await this.knex('credit_balances').where('organization_id', organizationId).first()
    if (!exists) {
      await this.knex('credit_balances').insert({
        id: require('crypto').randomUUID(),
        tenant_id: tenantId,
        organization_id: organizationId,
        balance: '0',
        updated_at: new Date(),
      })
    }
  }

  async addCredits(
    tenantId: string,
    organizationId: string,
    amount: number,
    description: string,
    referenceId?: string,
  ): Promise<void> {
    await this.ensureBalance(tenantId, organizationId)
    await this.knex('credit_balances')
      .where('organization_id', organizationId)
      .increment('balance', amount)

    await this.knex('credit_transactions').insert({
      id: require('crypto').randomUUID(),
      tenant_id: tenantId,
      organization_id: organizationId,
      amount: amount.toFixed(4),
      type: 'purchase',
      description,
      reference_id: referenceId || null,
      created_at: new Date(),
    })
  }

  async deductCredits(
    tenantId: string,
    organizationId: string,
    amount: number,
    service: 'email' | 'sms' | 'phone' | 'ai',
    description: string,
    referenceId?: string,
  ): Promise<{ success: boolean; balance: number }> {
    const current = await this.getBalance(organizationId)
    if (current < amount) return { success: false, balance: current }

    await this.knex('credit_balances')
      .where('organization_id', organizationId)
      .decrement('balance', amount)

    await this.knex('credit_transactions').insert({
      id: require('crypto').randomUUID(),
      tenant_id: tenantId,
      organization_id: organizationId,
      amount: (-amount).toFixed(4),
      type: 'usage',
      description,
      service,
      reference_id: referenceId || null,
      created_at: new Date(),
    })

    return { success: true, balance: current - amount }
  }
}
