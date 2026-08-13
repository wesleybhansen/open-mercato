export function summarizeRecentWorkPartitions(
  partitionNames: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
): { failedPartitions: string[]; totalFailure: boolean } {
  if (partitionNames.length !== results.length) {
    throw new Error("Recent-work partition metadata mismatch");
  }

  const failedPartitions = results.flatMap((result, index) =>
    result.status === "rejected" ? [partitionNames[index]] : [],
  );
  return {
    failedPartitions,
    totalFailure: failedPartitions.length === results.length,
  };
}

export const RECENT_WORK_PARTITION_NAMES = [
  "emails",
  "briefs",
  "automations",
  "pages",
  "leads",
  "pendingBookings",
  "proposals",
  "stallingDeals",
] as const;

type RecentWorkPartitionName = (typeof RECENT_WORK_PARTITION_NAMES)[number];
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isValidDateValue(value: unknown): boolean {
  return (
    (value instanceof Date && !Number.isNaN(value.getTime())) ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      !Number.isNaN(Date.parse(value)))
  );
}

function isRowArray(
  value: unknown,
  validate: (row: UnknownRecord) => boolean,
): boolean {
  return (
    Array.isArray(value) && value.every((row) => isRecord(row) && validate(row))
  );
}

const partitionValidators: Record<
  RecentWorkPartitionName,
  (value: unknown) => boolean
> = {
  emails: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.to_address) &&
        isOptionalString(row.subject) &&
        isOptionalString(row.body_text) &&
        isValidDateValue(row.created_at),
    ),
  briefs: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.event_summary) &&
        isValidDateValue(row.created_at),
    ),
  automations: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.subject) &&
        isValidDateValue(row.created_at),
    ),
  pages: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isNonEmptyString(row.title) &&
        isValidDateValue(row.published_at),
    ),
  leads: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.subject) &&
        isValidDateValue(row.created_at),
    ),
  pendingBookings: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.guest_name) &&
        isValidDateValue(row.start_time) &&
        isValidDateValue(row.created_at),
    ),
  proposals: (value) =>
    isRowArray(
      value,
      (row) =>
        isNonEmptyString(row.id) &&
        isOptionalString(row.summary) &&
        isValidDateValue(row.created_at),
    ),
  stallingDeals: (value) => {
    if (!isRecord(value)) return false;
    const count = value.n;
    if (typeof count === "number")
      return Number.isSafeInteger(count) && count >= 0;
    if (typeof count !== "string" || !/^(0|[1-9]\d*)$/.test(count))
      return false;
    const parsed = Number(count);
    return Number.isSafeInteger(parsed) && parsed >= 0;
  },
};

export function admitRecentWorkPartitions(
  results: readonly PromiseSettledResult<unknown>[],
): {
  failedPartitions: RecentWorkPartitionName[];
  totalFailure: boolean;
  values: Array<unknown | undefined>;
} {
  if (results.length !== RECENT_WORK_PARTITION_NAMES.length) {
    throw new Error("Recent-work partition metadata mismatch");
  }
  const failedPartitions: RecentWorkPartitionName[] = [];
  const values = results.map((result, index) => {
    const name = RECENT_WORK_PARTITION_NAMES[index];
    if (
      result.status === "fulfilled" &&
      partitionValidators[name](result.value)
    ) {
      return result.value;
    }
    failedPartitions.push(name);
    return undefined;
  });
  return {
    failedPartitions,
    totalFailure:
      failedPartitions.length === RECENT_WORK_PARTITION_NAMES.length,
    values,
  };
}

export function admitRecentWorkCoreUser(
  value: unknown,
): { state: "empty" } | { state: "ready"; id: string; clerkUserId: string } {
  if (value === null || value === undefined) return { state: "empty" };
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.clerk_user_id)
  ) {
    throw new Error("Recent-work Core identity malformed");
  }
  return { state: "ready", id: value.id, clerkUserId: value.clerk_user_id };
}

export function admitRecentWorkBoolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Recent-work boolean malformed");
  return value;
}

export function admitRecentWorkOptionalIdentifier(
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (!isNonEmptyString(value))
    throw new Error("Recent-work identifier malformed");
  return value;
}

export function admitRecentWorkOrganizationRows(
  value: unknown,
  key: string,
): string[] {
  if (!Array.isArray(value))
    throw new Error("Recent-work organization rows malformed");
  return value.map((row) => {
    if (!isRecord(row) || !isNonEmptyString(row[key])) {
      throw new Error("Recent-work organization row malformed");
    }
    return row[key];
  });
}

export function admitRecentWorkLegacyOrganization(
  value: unknown,
): { state: "empty" } | { state: "ready"; noliOrgId: string | null } {
  if (value === null || value === undefined) return { state: "empty" };
  if (!isRecord(value) || !Object.hasOwn(value, "noli_org_id")) {
    throw new Error("Recent-work legacy organization malformed");
  }
  return {
    state: "ready",
    noliOrgId: admitRecentWorkOptionalIdentifier(value.noli_org_id),
  };
}

export function classifyRecentWorkIdentity({
  hasNoliIdentity,
  entitled,
  organizationId,
}: {
  hasNoliIdentity: boolean;
  entitled: boolean;
  organizationId: string | null | undefined;
}):
  | { state: "empty" }
  | { state: "forbidden" }
  | { state: "ready"; organizationId: string } {
  if (!hasNoliIdentity) return { state: "empty" };
  if (!entitled) return { state: "forbidden" };
  return organizationId
    ? { state: "ready", organizationId }
    : { state: "empty" };
}
