/*
 * Credit pricing of provider units (GTM-SPEC-01 section 4.6): a platform
 * markup multiplier applies over the adapter's quoted per-unit credit cost.
 * The recommended initial multiplier is 2x; it is read from the environment
 * (GTM_CREDIT_MARKUP) with '2' as the fallback so the default needs no env.
 */

export const DEFAULT_CREDIT_MARKUP = 2

/*
 * NOLI CREDIT UNIT. Authoritative source: CREDITS_PER_CENT = 2500 in
 * `apps/mercato/src/lib/usage/allowance.ts` and `packages/shared` (and the
 * noli-core ledger SQL, which settles cost_cents = ceil(charged_credits/2500)).
 * So 2500 credits = 1 cent, 1 credit = $0.000004, and $1 = 250,000 credits.
 *
 * WARNING: This constant MUST stay in parity with packages/entitlements-client /
 * packages/shared. If CREDITS_PER_CENT ever changes there, change it here in
 * the same commit or every provider quote in this module silently mis-prices.
 *
 * WARNING: A provider's own "credits" are NOT Noli credits. Origami's rate card
 * ("0.2 credits per social engagement result") is denominated in ORIGAMI
 * credits; copying that number into a Noli quote undercharges by ~3,750x.
 * Always express provider cost in USD and convert with creditsFromUsd.
 */
export const CREDITS_PER_CENT = 2500
export const CREDITS_PER_USD = CREDITS_PER_CENT * 100 // 250_000

/*
 * Provider cost in USD -> Noli credits, PRE-markup. Markup is applied in
 * exactly one place (creditsForUnits below); never multiply it in here.
 */
export function creditsFromUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new TypeError(`usd must be a non-negative finite number, got ${usd}`)
  }
  // rounded to 6 decimals so float noise cannot leak into a quoted price
  return Math.round(usd * CREDITS_PER_USD * 1e6) / 1e6
}

export function defaultMarkupMultiplier(): number {
  const raw = process.env.GTM_CREDIT_MARKUP ?? String(DEFAULT_CREDIT_MARKUP)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CREDIT_MARKUP
}

/*
 * Integer credits for a unit count: ceil of units x quoted x markup, and never
 * zero for a nonzero unit count (a paid unit always costs at least 1 credit).
 * Zero units always price at exactly 0.
 */
export function creditsForUnits(
  units: number,
  quotedCreditsPerUnit: number,
  markupMultiplier: number = defaultMarkupMultiplier(),
): number {
  if (!Number.isFinite(units) || units < 0) {
    throw new TypeError(`units must be a non-negative finite number, got ${units}`)
  }
  if (!Number.isFinite(quotedCreditsPerUnit) || quotedCreditsPerUnit < 0) {
    throw new TypeError(
      `quotedCreditsPerUnit must be a non-negative finite number, got ${quotedCreditsPerUnit}`,
    )
  }
  if (!Number.isFinite(markupMultiplier) || markupMultiplier <= 0) {
    throw new TypeError(`markupMultiplier must be a positive finite number, got ${markupMultiplier}`)
  }
  if (units === 0) return 0
  return Math.max(1, Math.ceil(units * quotedCreditsPerUnit * markupMultiplier))
}
