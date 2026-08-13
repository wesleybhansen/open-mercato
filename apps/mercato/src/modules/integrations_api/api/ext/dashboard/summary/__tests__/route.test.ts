/** @jest-environment node */

const mockCreateRequestContainer = jest.fn();

type QueryValue = unknown | Error;

const queryValues = new Map<string, QueryValue>();
const queryFilters = new Map<string, Array<[string, unknown]>>();

function settle(value: QueryValue): Promise<unknown> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

function createKnex() {
  const knex = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    queryFilters.set(table, filters);
    const query = {
      where: jest.fn(
        (field: string | Record<string, unknown>, value?: unknown) => {
          if (typeof field === "string") filters.push([field, value]);
          else
            Object.entries(field).forEach(([key, content]) =>
              filters.push([key, content]),
            );
          return query;
        },
      ),
      whereNull: jest.fn(() => query),
      whereRaw: jest.fn(() => query),
      select: jest.fn(() => query),
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => settle(queryValues.get(table) ?? []).then(onFulfilled, onRejected),
    };
    return query;
  };
  knex.raw = jest.fn((value: string) => value);
  return knex;
}

jest.mock("@open-mercato/shared/lib/di/container", () => ({
  createRequestContainer: (...args: unknown[]) =>
    mockCreateRequestContainer(...args),
}));

import { GET } from "../route";

const tenantId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

function validValues() {
  return {
    customer_entities: [{ total: "0", last_30: "0", last_7: "0" }],
    customer_deals: [
      {
        total: "0",
        open: "0",
        pipeline_value: "0",
        won_30: "0",
        revenue_30: "0",
      },
    ],
    landing_pages: [
      { total: "0", published: "0", views: "0", submissions: "0" },
    ],
    email_messages: [{ sent: "0", opened: "0", clicked: "0" }],
    inbox_proposal_actions: [
      {
        replies_sent_7: "0",
        replies_sent_30: "0",
        pending: "0",
        flagged_pending: "0",
        flagged_30: "0",
      },
    ],
  };
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Dashboard summary temporarily unavailable",
    code: "dashboard_summary_unavailable",
  });
}

describe("CRM external dashboard summary dependency honesty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryValues.clear();
    queryFilters.clear();
    Object.entries(validValues()).forEach(([table, value]) =>
      queryValues.set(table, value),
    );
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ getKnex: () => createKnex() }),
    });
  });

  it("rejects missing authority before dependency construction", async () => {
    const response = await GET(new Request("http://localhost"), {});

    expect(response.status).toBe(401);
    expect(mockCreateRequestContainer).not.toHaveBeenCalled();
  });

  it("returns the exact healthy zero projection with tenant and organization scope", async () => {
    const response = await GET(new Request("http://localhost"), {
      auth: { tenantId, orgId: organizationId },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        contacts: { total: 0, last30Days: 0, last7Days: 0 },
        deals: {
          total: 0,
          open: 0,
          pipelineValue: 0,
          wonLast30: 0,
          revenueLast30: 0,
        },
        landingPages: { total: 0, published: 0, views: 0, submissions: 0 },
        email: { sent: 0, opened: 0, clicked: 0 },
        customerService: {
          repliesSentLast7: 0,
          repliesSentLast30: 0,
          pending: 0,
          flaggedPending: 0,
          flaggedLast30: 0,
        },
      },
    });
    for (const filters of queryFilters.values()) {
      expect(filters).toEqual(
        expect.arrayContaining([
          ["tenant_id", tenantId],
          ["organization_id", organizationId],
        ]),
      );
    }
  });

  it.each([
    "customer_entities",
    "customer_deals",
    "landing_pages",
    "email_messages",
    "inbox_proposal_actions",
  ])(
    "fails closed when %s rejects instead of fabricating zero state",
    async (table) => {
      queryValues.set(table, new Error("private database detail"));
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expectUnavailable(
        await GET(new Request("http://localhost"), {
          auth: { tenantId, orgId: organizationId },
        }),
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[ext.dashboard.summary] dashboard_summary_unavailable",
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        "private database detail",
      );
      consoleSpy.mockRestore();
    },
  );

  it.each([
    [
      "customer_entities",
      [{ total: "not-a-count", last_30: "0", last_7: "0" }],
    ],
    [
      "customer_deals",
      [
        {
          total: "0",
          open: "0",
          pipeline_value: null,
          won_30: "0",
          revenue_30: "0",
        },
      ],
    ],
    ["landing_pages", []],
    ["email_messages", [{ sent: "0", opened: "01", clicked: "0" }]],
    ["inbox_proposal_actions", [{ replies_sent_7: "0" }]],
  ])(
    "fails closed when %s returns malformed fulfilled data",
    async (table, value) => {
      queryValues.set(table as string, value);
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expectUnavailable(
        await GET(new Request("http://localhost"), {
          auth: { tenantId, orgId: organizationId },
        }),
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[ext.dashboard.summary] dashboard_summary_unavailable",
      );
      consoleSpy.mockRestore();
    },
  );
});
