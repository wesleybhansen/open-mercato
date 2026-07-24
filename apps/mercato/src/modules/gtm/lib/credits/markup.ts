/*
 * Credit pricing of provider units (GTM-SPEC-01 section 4.6): a platform
 * markup multiplier applies over the adapter's quoted per-unit credit cost.
 * The recommended initial multiplier is 2x; it is read from the environment
 * (GTM_CREDIT_MARKUP) with '2' as the fallback so the default needs no env.
 */

export const DEFAULT_CREDIT_MARKUP = 2

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
