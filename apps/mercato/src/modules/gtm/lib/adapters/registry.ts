import type { SourceAdapter } from './types'
import { fixtureSourceAdapter } from './fixture'

/*
 * Source-adapter registry (SPEC-066 Tranche 3, fixtures-first).
 *
 * Real provider adapters (Crustdata, DataForSEO, ...) do not exist yet; they
 * arrive with the Tranche 4 reserve-wrapped invoker and register here behind
 * the same SourceAdapter contract. Until then every execution path resolves
 * the deterministic fixture adapter, so no provider or network call is
 * possible by construction.
 */
export function sourceAdapterRegistry(): Record<string, SourceAdapter> {
  return {
    [fixtureSourceAdapter.descriptor.adapter_id]: fixtureSourceAdapter,
  }
}

export function sourceAdapterList(): SourceAdapter[] {
  return Object.values(sourceAdapterRegistry())
}
