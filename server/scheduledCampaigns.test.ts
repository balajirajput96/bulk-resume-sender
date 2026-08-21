import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  deleteHeartbeatJob: vi.fn(),
  executeCampaign: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: mocks.authenticateRequest },
}));

vi.mock("./_core/heartbeat", () => ({
  deleteHeartbeatJob: mocks.deleteHeartbeatJob,
}));

vi.mock("./emailService", () => ({
  executeCampaign: mocks.executeCampaign,
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

import { registerScheduledCampaignRoutes } from "./scheduledCampaigns";

describe("scheduled campaign cleanup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("removes the Heartbeat job and clears its reference after a one-time campaign runs", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ id: 42, status: "scheduled", scheduledAt: new Date(Date.now() - 1_000) }]),
          }),
        }),
      }),
      update: vi.fn(() => ({ set: updateSet })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "heartbeat-42" });
    mocks.executeCampaign.mockResolvedValue(undefined);
    mocks.deleteHeartbeatJob.mockResolvedValue(undefined);

    let handler: ((req: unknown, res: unknown) => Promise<unknown>) | undefined;
    registerScheduledCampaignRoutes({ post: (_path: string, registeredHandler: typeof handler) => { handler = registeredHandler; } } as any);
    const json = vi.fn();

    await handler!({}, { json, status: vi.fn().mockReturnThis() });

    expect(mocks.executeCampaign).toHaveBeenCalledWith(42);
    expect(mocks.deleteHeartbeatJob).toHaveBeenCalledWith("heartbeat-42", "");
    expect(updateSet).toHaveBeenCalledWith({ scheduleCronTaskUid: null });
    expect(updateWhere).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ ok: true, campaignId: 42 });
  });

  it("keeps the job reference recoverable when Heartbeat deletion fails after delivery", async () => {
    const updateSet = vi.fn();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ id: 43, status: "scheduled", scheduledAt: new Date(Date.now() - 1_000) }]),
          }),
        }),
      }),
      update: vi.fn(() => ({ set: updateSet })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "heartbeat-43" });
    mocks.executeCampaign.mockResolvedValue(undefined);
    mocks.deleteHeartbeatJob.mockRejectedValue(new Error("forbidden"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let handler: ((req: unknown, res: unknown) => Promise<unknown>) | undefined;
    registerScheduledCampaignRoutes({ post: (_path: string, registeredHandler: typeof handler) => { handler = registeredHandler; } } as any);
    const json = vi.fn();

    await handler!({}, { json, status: vi.fn().mockReturnThis() });

    expect(mocks.executeCampaign).toHaveBeenCalledWith(43);
    expect(mocks.deleteHeartbeatJob).toHaveBeenCalledWith("heartbeat-43", "");
    expect(updateSet).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("[Scheduled Campaign] Unable to remove completed one-time job", expect.any(Error));
    expect(json).toHaveBeenCalledWith({ ok: true, campaignId: 43 });
    errorSpy.mockRestore();
  });
});
