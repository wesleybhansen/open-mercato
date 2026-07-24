import type { EnrichAdapter, SourceAdapter, VerifyAdapter } from './types'
import { fixtureEnrichAdapter, fixtureSourceAdapter, fixtureVerifyAdapter } from './fixture'

/*
 * Adapter registries (SPEC-066 Tranches 3/4, fixtures-first).
 *
 * Real provider adapters (Crustdata, DataForSEO, FullEnrich, ...) do not
 * exist yet; when they land they register here behind the same layer
 * contracts, in waterfall priority order. Until then every execution path
 * resolves the deterministic fixture adapters, so no provider or network
 * call is possible by construction.
 */
export function sourceAdapterRegistry(): Record<string, SourceAdapter> {
  return {
    [fixtureSourceAdapter.descriptor.adapter_id]: fixtureSourceAdapter,
  }
}

export function sourceAdapterList(): SourceAdapter[] {
  return Object.values(sourceAdapterRegistry())
}

// Registry ORDER is the enrichment waterfall order (SPEC-066 section 4.1
// step 6): the first adapter that yields contact points wins.
export function enrichAdapterList(): EnrichAdapter[] {
  return [fixtureEnrichAdapter]
}

// Registry ORDER is the verification order: the first adapter that returns a
// definitive verification state settles the contact point.
export function verifyAdapterList(): VerifyAdapter[] {
  return [fixtureVerifyAdapter]
}
