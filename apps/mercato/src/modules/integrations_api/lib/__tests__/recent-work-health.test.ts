import {
  admitRecentWorkBoolean,
  admitRecentWorkCoreUser,
  admitRecentWorkLegacyOrganization,
  admitRecentWorkOptionalIdentifier,
  admitRecentWorkOrganizationRows,
  admitRecentWorkPartitions,
  classifyRecentWorkIdentity,
  summarizeRecentWorkPartitions,
} from "../recent-work-health";

const fulfilled = (value: unknown): PromiseFulfilledResult<unknown> => ({
  status: "fulfilled",
  value,
});
const rejected = (): PromiseRejectedResult => ({
  status: "rejected",
  reason: new Error("source unavailable"),
});

describe("summarizeRecentWorkPartitions", () => {
  it("reports a healthy set of partitions", () => {
    expect(
      summarizeRecentWorkPartitions(
        ["emails", "bookings"],
        [fulfilled([]), fulfilled([])],
      ),
    ).toEqual({
      failedPartitions: [],
      totalFailure: false,
    });
  });

  it("identifies a partial failure without discarding healthy partitions", () => {
    expect(
      summarizeRecentWorkPartitions(
        ["emails", "bookings"],
        [fulfilled([]), rejected()],
      ),
    ).toEqual({
      failedPartitions: ["bookings"],
      totalFailure: false,
    });
  });

  it("identifies a total partition failure", () => {
    expect(
      summarizeRecentWorkPartitions(
        ["emails", "bookings"],
        [rejected(), rejected()],
      ),
    ).toEqual({
      failedPartitions: ["emails", "bookings"],
      totalFailure: true,
    });
  });

  it("fails closed when partition metadata and results diverge", () => {
    expect(() =>
      summarizeRecentWorkPartitions(["emails"], [fulfilled([]), fulfilled([])]),
    ).toThrow("Recent-work partition metadata mismatch");
  });
});

describe("admitRecentWorkPartitions", () => {
  const validResults = (): Array<PromiseSettledResult<unknown>> => [
    fulfilled([
      {
        id: "email-1",
        to_address: null,
        subject: "Hello",
        body_text: null,
        created_at: new Date(),
      },
    ]),
    fulfilled([
      {
        id: "brief-1",
        event_summary: null,
        created_at: "2026-08-13T00:00:00.000Z",
      },
    ]),
    fulfilled([{ id: "auto-1", subject: null, created_at: new Date() }]),
    fulfilled([{ id: "page-1", title: "Launch", published_at: new Date() }]),
    fulfilled([{ id: "lead-1", subject: null, created_at: new Date() }]),
    fulfilled([
      {
        id: "booking-1",
        guest_name: null,
        start_time: new Date(),
        created_at: new Date(),
      },
    ]),
    fulfilled([{ id: "proposal-1", summary: null, created_at: new Date() }]),
    fulfilled({ n: "0" }),
  ];

  it("admits the exact eight valid partition shapes", () => {
    const results = validResults();
    expect(admitRecentWorkPartitions(results)).toEqual({
      failedPartitions: [],
      totalFailure: false,
      values: results.map((result) =>
        result.status === "fulfilled" ? result.value : undefined,
      ),
    });
  });

  it("treats a rejected or malformed fulfilled partition as a bounded partial failure", () => {
    const rejectedResults = validResults();
    rejectedResults[1] = rejected();
    const rejectedAdmission = admitRecentWorkPartitions(rejectedResults);
    expect(rejectedAdmission.failedPartitions).toEqual(["briefs"]);
    expect(rejectedAdmission.totalFailure).toBe(false);
    expect(rejectedAdmission.values[1]).toBeUndefined();

    const malformedResults = validResults();
    malformedResults[7] = fulfilled({ n: "not-a-count" });
    const malformedAdmission = admitRecentWorkPartitions(malformedResults);
    expect(malformedAdmission.failedPartitions).toEqual(["stallingDeals"]);
    expect(malformedAdmission.totalFailure).toBe(false);
    expect(malformedAdmission.values[7]).toBeUndefined();
  });

  it("refuses invalid identifiers, dates, optional strings, counts, and partition cardinality", () => {
    const invalidValues: Array<[number, unknown]> = [
      [
        0,
        [
          {
            id: "",
            to_address: null,
            subject: null,
            body_text: null,
            created_at: new Date(),
          },
        ],
      ],
      [1, [{ id: "brief-1", event_summary: {}, created_at: new Date() }]],
      [2, [{ id: "auto-1", subject: null, created_at: "not-a-date" }]],
      [3, [{ id: "page-1", title: "", published_at: new Date() }]],
      [4, [{ id: "lead-1", subject: 7, created_at: new Date() }]],
      [
        5,
        [
          {
            id: "booking-1",
            guest_name: null,
            start_time: "bad",
            created_at: new Date(),
          },
        ],
      ],
      [6, [{ id: "proposal-1", summary: null, created_at: null }]],
      [7, { n: Number.MAX_SAFE_INTEGER + 1 }],
      [7, { n: "01" }],
    ];

    for (const [index, value] of invalidValues) {
      const results = validResults();
      results[index] = fulfilled(value);
      expect(admitRecentWorkPartitions(results).failedPartitions).toHaveLength(
        1,
      );
    }
    expect(() => admitRecentWorkPartitions(validResults().slice(0, 7))).toThrow(
      "Recent-work partition metadata mismatch",
    );
  });

  it("marks total failure only when every exact partition is rejected or malformed", () => {
    const results = validResults().map((_, index) =>
      index % 2 === 0 ? rejected() : fulfilled(null),
    );
    expect(admitRecentWorkPartitions(results)).toEqual({
      failedPartitions: [
        "emails",
        "briefs",
        "automations",
        "pages",
        "leads",
        "pendingBookings",
        "proposals",
        "stallingDeals",
      ],
      totalFailure: true,
      values: Array.from({ length: 8 }, () => undefined),
    });
  });
});

describe("recent-work dependency admission", () => {
  it("distinguishes exact Core absence from a valid identity and rejects malformed identity", () => {
    expect(admitRecentWorkCoreUser(null)).toEqual({ state: "empty" });
    expect(
      admitRecentWorkCoreUser({ id: "user-1", clerk_user_id: "clerk-1" }),
    ).toEqual({
      state: "ready",
      id: "user-1",
      clerkUserId: "clerk-1",
    });
    expect(() =>
      admitRecentWorkCoreUser({ id: "user-1", clerk_user_id: 4 }),
    ).toThrow("Recent-work Core identity malformed");
  });

  it("requires exact booleans and optional nonempty identifiers", () => {
    expect(admitRecentWorkBoolean(false)).toBe(false);
    expect(admitRecentWorkBoolean(true)).toBe(true);
    expect(() => admitRecentWorkBoolean("false")).toThrow(
      "Recent-work boolean malformed",
    );
    expect(admitRecentWorkOptionalIdentifier(undefined)).toBeNull();
    expect(admitRecentWorkOptionalIdentifier("org-1")).toBe("org-1");
    expect(() => admitRecentWorkOptionalIdentifier(" ")).toThrow(
      "Recent-work identifier malformed",
    );
  });

  it("admits only exact nonempty organization identifiers and bounded legacy rows", () => {
    expect(admitRecentWorkOrganizationRows([{ id: "org-1" }], "id")).toEqual([
      "org-1",
    ]);
    expect(() => admitRecentWorkOrganizationRows([{ id: null }], "id")).toThrow(
      "Recent-work organization row malformed",
    );
    expect(admitRecentWorkLegacyOrganization(undefined)).toEqual({
      state: "empty",
    });
    expect(admitRecentWorkLegacyOrganization({ noli_org_id: null })).toEqual({
      state: "ready",
      noliOrgId: null,
    });
    expect(() => admitRecentWorkLegacyOrganization({})).toThrow(
      "Recent-work legacy organization malformed",
    );
    expect(() =>
      admitRecentWorkLegacyOrganization({ noli_org_id: {} }),
    ).toThrow("Recent-work identifier malformed");
  });
});

describe("classifyRecentWorkIdentity", () => {
  it("treats a confirmed absent Noli or CRM identity as empty", () => {
    expect(
      classifyRecentWorkIdentity({
        hasNoliIdentity: false,
        entitled: false,
        organizationId: null,
      }),
    ).toEqual({
      state: "empty",
    });
    expect(
      classifyRecentWorkIdentity({
        hasNoliIdentity: true,
        entitled: true,
        organizationId: null,
      }),
    ).toEqual({
      state: "empty",
    });
  });

  it("denies a confirmed inactive entitlement", () => {
    expect(
      classifyRecentWorkIdentity({
        hasNoliIdentity: true,
        entitled: false,
        organizationId: "org-1",
      }),
    ).toEqual({
      state: "forbidden",
    });
  });

  it("returns the confirmed local organization without provisioning", () => {
    expect(
      classifyRecentWorkIdentity({
        hasNoliIdentity: true,
        entitled: true,
        organizationId: "org-1",
      }),
    ).toEqual({
      state: "ready",
      organizationId: "org-1",
    });
  });
});
