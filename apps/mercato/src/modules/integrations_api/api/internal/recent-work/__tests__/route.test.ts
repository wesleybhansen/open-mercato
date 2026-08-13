/** @jest-environment node */

const mockFindNoliUserById = jest.fn();
const mockFindPrimaryOrgIdForUser = jest.fn();
const mockIsEntitled = jest.fn();
const mockCreateRequestContainer = jest.fn();

type QueryValue = unknown | Error;
type QueryFilter = [string, unknown];

const partitionValues = new Map<string, QueryValue>();
let mappedOrganizations: QueryValue;
let userOrganizations: QueryValue;
let legacyOrganization: QueryValue;

function settle(value: QueryValue): Promise<unknown> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

function createKnex() {
  return (table: string) => {
    const filters: QueryFilter[] = [];
    const query = {
      where: jest.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      }),
      whereNull: jest.fn(() => query),
      whereNotNull: jest.fn(() => query),
      whereIn: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      select: jest.fn(() => query),
      count: jest.fn(() => query),
      first: jest.fn(() => {
        if (table === "organizations") return settle(legacyOrganization);
        if (table === "customer_deals")
          return settle(partitionValues.get("stallingDeals") ?? { n: "0" });
        return settle(undefined);
      }),
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        let value: QueryValue = [];
        if (table === "organizations") value = mappedOrganizations;
        else if (table === "users") value = userOrganizations;
        else if (table === "email_messages")
          value = partitionValues.get("emails") ?? [];
        else if (table === "meeting_prep_briefs")
          value = partitionValues.get("briefs") ?? [];
        else if (table === "landing_pages")
          value = partitionValues.get("pages") ?? [];
        else if (table === "bookings")
          value = partitionValues.get("pendingBookings") ?? [];
        else if (table === "inbox_proposals")
          value = partitionValues.get("proposals") ?? [];
        else if (table === "customer_activities") {
          const activityType = filters.find(
            ([field]) => field === "activity_type",
          )?.[1];
          value =
            partitionValues.get(
              activityType === "automation" ? "automations" : "leads",
            ) ?? [];
        }
        return settle(value).then(onFulfilled, onRejected);
      },
    };
    return query;
  };
}

jest.mock("@open-mercato/shared/lib/noli/core-client", () => ({
  findNoliUserById: (...args: unknown[]) => mockFindNoliUserById(...args),
  findPrimaryOrgIdForUser: (...args: unknown[]) =>
    mockFindPrimaryOrgIdForUser(...args),
  isEntitled: (...args: unknown[]) => mockIsEntitled(...args),
}));

jest.mock("@open-mercato/shared/lib/di/container", () => ({
  createRequestContainer: (...args: unknown[]) =>
    mockCreateRequestContainer(...args),
}));

import { POST } from "../route";

const serviceSecret = "test-internal-service-secret";
const noliUserId = "11111111-1111-4111-8111-111111111111";
const noliOrgId = "22222222-2222-4222-8222-222222222222";
const crmOrgId = "33333333-3333-4333-8333-333333333333";

function request(authorization = `Bearer ${serviceSecret}`): Request {
  return new Request("http://localhost/api/internal/recent-work", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ noliUserId }),
  });
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "Recent work temporarily unavailable",
    code: "recent_work_unavailable",
  });
}

describe("CRM internal recent-work dependency honesty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    partitionValues.clear();
    mappedOrganizations = [{ id: crmOrgId }];
    userOrganizations = [];
    legacyOrganization = undefined;
    process.env.NOLI_INTERNAL_SERVICE_SECRET = serviceSecret;
    mockFindNoliUserById.mockResolvedValue({
      id: noliUserId,
      clerk_user_id: "clerk-user-1",
    });
    mockFindPrimaryOrgIdForUser.mockResolvedValue(noliOrgId);
    mockIsEntitled.mockResolvedValue(true);
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ getKnex: () => createKnex() }),
    });
  });

  afterAll(() => {
    delete process.env.NOLI_INTERNAL_SERVICE_SECRET;
  });

  it("rejects an invalid service credential before any dependency access", async () => {
    const response = await POST(request("Bearer wrong"));

    expect(response.status).toBe(401);
    expect(mockFindNoliUserById).not.toHaveBeenCalled();
    expect(mockCreateRequestContainer).not.toHaveBeenCalled();
  });

  it("preserves confirmed Core and organization absence as an empty feed", async () => {
    mockFindNoliUserById.mockResolvedValueOnce(null);
    const missingCore = await POST(request());
    expect(missingCore.status).toBe(200);
    await expect(missingCore.json()).resolves.toEqual({ events: [] });
    expect(mockIsEntitled).not.toHaveBeenCalled();

    mockFindNoliUserById.mockResolvedValueOnce({
      id: noliUserId,
      clerk_user_id: "clerk-user-1",
    });
    mockFindPrimaryOrgIdForUser.mockResolvedValueOnce(null);
    const missingOrganization = await POST(request());
    expect(missingOrganization.status).toBe(200);
    await expect(missingOrganization.json()).resolves.toEqual({ events: [] });
  });

  it("preserves a confirmed inactive entitlement as forbidden", async () => {
    mockIsEntitled.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "CRM access unavailable",
    });
    expect(mockCreateRequestContainer).not.toHaveBeenCalled();
  });

  it("returns the exact healthy empty projection after eight valid reads", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [],
      partial: false,
    });
  });

  it("preserves a valid partial feed and emits only the finite degraded marker", async () => {
    partitionValues.set("briefs", new Error("private query detail"));
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [],
      partial: true,
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[internal.recent-work] recent_work_degraded",
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
      "private query detail",
    );
    consoleSpy.mockRestore();
  });

  it("classifies a malformed fulfilled partition as degraded instead of healthy", async () => {
    partitionValues.set("stallingDeals", { n: "not-a-count" });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [],
      partial: true,
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[internal.recent-work] recent_work_degraded",
    );
    consoleSpy.mockRestore();
  });

  it("fails closed with one bounded response when every partition rejects", async () => {
    for (const partition of [
      "emails",
      "briefs",
      "automations",
      "pages",
      "leads",
      "pendingBookings",
      "proposals",
      "stallingDeals",
    ]) {
      partitionValues.set(partition, new Error(`private ${partition} detail`));
    }
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expectUnavailable(await POST(request()));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[internal.recent-work] recent_work_unavailable",
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
      "private emails detail",
    );
    consoleSpy.mockRestore();
  });

  it.each<[string, () => void]>([
    [
      "malformed Core identity",
      () => mockFindNoliUserById.mockResolvedValue({ id: noliUserId }),
    ],
    ["malformed entitlement", () => mockIsEntitled.mockResolvedValue("true")],
    [
      "malformed Core organization",
      () => mockFindPrimaryOrgIdForUser.mockResolvedValue({ id: noliOrgId }),
    ],
    [
      "malformed local mapping",
      () => {
        mappedOrganizations = [{ id: null }];
      },
    ],
    [
      "request container failure",
      () =>
        mockCreateRequestContainer.mockRejectedValue(
          new Error("private detail"),
        ),
    ],
  ])(
    "fails closed for %s without exposing dependency output",
    async (_condition, arrange) => {
      arrange();
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expectUnavailable(await POST(request()));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[internal.recent-work] recent_work_unavailable",
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        "private detail",
      );
      consoleSpy.mockRestore();
    },
  );
});
