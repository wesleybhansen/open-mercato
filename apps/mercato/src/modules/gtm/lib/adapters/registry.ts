import type { EnrichAdapter, SourceAdapter, VerifyAdapter } from './types'
import { fixtureEnrichAdapter, fixtureSourceAdapter, fixtureVerifyAdapter } from './fixture'
import { apifySourceEnabled, createApifySourceAdapter } from './apify/source'
import { apifyEnrichEnabled, createApifyEnrichAdapter } from './apify/enrich'

/*
 * Adapter registries (SPEC-066 Tranches 3/4, fixtures-first).
 *
 * The deterministic fixture adapters are always registered and always first:
 * with every provider gate off, this registry is byte-identical to the
 * fixtures-only registry and no provider or network call is possible by
 * construction.
 *
 * Real provider adapters register ADDITIVELY behind their own env gate, in
 * waterfall priority order. The Apify social-engagement source ships DARK
 * (GTM_APIFY_ENABLED plus a token, default off) because that source is
 * legally gated pending review; see lib/adapters/apify/source.ts.
 */
export function sourceAdapterRegistry(): Record<string, SourceAdapter> {
  const registry: Record<string, SourceAdapter> = {
    [fixtureSourceAdapter.descriptor.adapter_id]: fixtureSourceAdapter,
  }
  if (apifySourceEnabled()) {
    const apify = createApifySourceAdapter()
    registry[apify.descriptor.adapter_id] = apify
  }
  return registry
}

export function sourceAdapterList(): SourceAdapter[] {
  return Object.values(sourceAdapterRegistry())
}

/*
 * Registry ORDER is the enrichment waterfall order (SPEC-066 section 4.1
 * step 6): the first adapter that yields contact points wins.
 *
 * The Apify profile+email adapter appends behind the SAME dark gate as the
 * Apify source (GTM_APIFY_ENABLED plus a token, default off). With the gate off
 * this list is byte-identical to the fixtures-only list, so no provider call is
 * possible by construction. Note it is the only pay-per-ATTEMPT adapter in the
 * stack: see lib/adapters/apify/enrich.ts.
 */
export function enrichAdapterList(): EnrichAdapter[] {
  const list: EnrichAdapter[] = [fixtureEnrichAdapter]
  if (apifyEnrichEnabled()) list.push(createApifyEnrichAdapter())
  return list
}

// Registry ORDER is the verification order: the first adapter that returns a
// definitive verification state settles the contact point.
export function verifyAdapterList(): VerifyAdapter[] {
  return [fixtureVerifyAdapter]
}
