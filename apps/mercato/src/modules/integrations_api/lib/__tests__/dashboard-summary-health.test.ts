import { admitDashboardSummaryPartitions } from "../dashboard-summary-health";

function validPartitions() {
  return {
    contacts: [{ total: "5", last_30: "3", last_7: "1" }],
    deals: [
      {
        total: "4",
        open: "2",
        pipeline_value: "1250.50",
        won_30: "1",
        revenue_30: 500,
      },
    ],
    landingPages: [{ total: "3", published: "2", views: "90", submissions: 7 }],
    email: [{ sent: "8", opened: "4", clicked: "2" }],
    customerService: [
      {
        replies_sent_7: "1",
        replies_sent_30: "3",
        pending: "2",
        flagged_pending: "1",
        flagged_30: "4",
      },
    ],
  };
}

describe("admitDashboardSummaryPartitions", () => {
  it("projects every exact aggregate into the existing dashboard shape", () => {
    expect(admitDashboardSummaryPartitions(validPartitions())).toEqual({
      contacts: { total: 5, last30Days: 3, last7Days: 1 },
      deals: {
        total: 4,
        open: 2,
        pipelineValue: 1250.5,
        wonLast30: 1,
        revenueLast30: 500,
      },
      landingPages: { total: 3, published: 2, views: 90, submissions: 7 },
      email: { sent: 8, opened: 4, clicked: 2 },
      customerService: {
        repliesSentLast7: 1,
        repliesSentLast30: 3,
        pending: 2,
        flaggedPending: 1,
        flaggedLast30: 4,
      },
    });
  });

  it.each([
    "contacts",
    "deals",
    "landingPages",
    "email",
    "customerService",
  ] as const)(
    "refuses missing, duplicate, or malformed %s partition rows",
    (partition) => {
      const missing = validPartitions();
      missing[partition] = [];
      expect(() => admitDashboardSummaryPartitions(missing)).toThrow(
        "Dashboard summary partition malformed",
      );

      const duplicate = validPartitions();
      duplicate[partition] = [{}, {}];
      expect(() => admitDashboardSummaryPartitions(duplicate)).toThrow(
        "Dashboard summary partition malformed",
      );
    },
  );

  it.each<unknown>([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    "01",
    "-1",
    "1.5",
    {},
    null,
  ])("refuses malformed count %p", (value) => {
    const partitions = validPartitions();
    partitions.contacts[0].total = value as string;
    expect(() => admitDashboardSummaryPartitions(partitions)).toThrow(
      "Dashboard summary count malformed",
    );
  });

  it.each<unknown>([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    "01",
    "-1",
    ".5",
    "1.",
    {},
    null,
  ])("refuses malformed amount %p", (value) => {
    const partitions = validPartitions();
    partitions.deals[0].pipeline_value = value as string;
    expect(() => admitDashboardSummaryPartitions(partitions)).toThrow(
      "Dashboard summary amount malformed",
    );
  });
});
