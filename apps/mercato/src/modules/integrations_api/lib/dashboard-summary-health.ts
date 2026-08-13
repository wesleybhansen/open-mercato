type UnknownRecord = Record<string, unknown>;

type DashboardSummaryPartitions = {
  contacts: unknown;
  deals: unknown;
  landingPages: unknown;
  email: unknown;
  customerService: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function row(value: unknown): UnknownRecord {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("Dashboard summary partition malformed");
  }
  return value[0];
}

function count(value: unknown): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new Error("Dashboard summary count malformed");
  }
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Dashboard summary count malformed");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("Dashboard summary count malformed");
  return parsed;
}

function amount(value: unknown): number {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) return value;
    throw new Error("Dashboard summary amount malformed");
  }
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("Dashboard summary amount malformed");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error("Dashboard summary amount malformed");
  return parsed;
}

export function admitDashboardSummaryPartitions(
  partitions: DashboardSummaryPartitions,
) {
  const contacts = row(partitions.contacts);
  const deals = row(partitions.deals);
  const landingPages = row(partitions.landingPages);
  const email = row(partitions.email);
  const customerService = row(partitions.customerService);

  return {
    contacts: {
      total: count(contacts.total),
      last30Days: count(contacts.last_30),
      last7Days: count(contacts.last_7),
    },
    deals: {
      total: count(deals.total),
      open: count(deals.open),
      pipelineValue: amount(deals.pipeline_value),
      wonLast30: count(deals.won_30),
      revenueLast30: amount(deals.revenue_30),
    },
    landingPages: {
      total: count(landingPages.total),
      published: count(landingPages.published),
      views: count(landingPages.views),
      submissions: count(landingPages.submissions),
    },
    email: {
      sent: count(email.sent),
      opened: count(email.opened),
      clicked: count(email.clicked),
    },
    customerService: {
      repliesSentLast7: count(customerService.replies_sent_7),
      repliesSentLast30: count(customerService.replies_sent_30),
      pending: count(customerService.pending),
      flaggedPending: count(customerService.flagged_pending),
      flaggedLast30: count(customerService.flagged_30),
    },
  };
}
