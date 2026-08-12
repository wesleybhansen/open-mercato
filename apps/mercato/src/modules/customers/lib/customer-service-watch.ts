export type WatchedConnectionIds = string[] | null

export function normalizeWatchedConnectionIds(
  value: unknown,
  current: WatchedConnectionIds,
): WatchedConnectionIds {
  if (value === undefined) return current
  if (!Array.isArray(value)) return null
  return value.filter(
    (connectionId): connectionId is string =>
      typeof connectionId === 'string' && connectionId.length > 0,
  )
}

export function allowedWatchedConnectionIds(
  watched: WatchedConnectionIds,
): Set<string> | null {
  return watched === null ? null : new Set(watched)
}

export function watchedConnectionIdsForStorage(
  watched: WatchedConnectionIds,
): string | null {
  return watched === null ? null : JSON.stringify(watched)
}

export function hasWatchedMailboxes(watched: WatchedConnectionIds): boolean {
  return watched === null || watched.length > 0
}
