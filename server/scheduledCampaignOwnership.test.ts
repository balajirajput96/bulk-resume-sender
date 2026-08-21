import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHeartbeatJob: vi.fn(),
  executeCampaign: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: mocks.createHeartbeatJob,
}));

vi.mock("./emailService", () => ({
  executeCampaign: mocks.executeCampaign,
}));

vi.mock("./googleOAuth", () => ({
  isGoogleOAuthConfigured: () => true,
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

import { appRouter } from "./routers";

describe("scheduled campaign ownership", () => {
  it("creates an admin-only scheduled campaign job under the project-owner identity", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: vi.fn().mockResolvedValue([{ refreshToken: "encrypted", accessToken: "v1.encrypted" }]) }),
        }),
      }),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([{ insertId: 91 }]) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.createHeartbeatJob.mockResolvedValue({ taskUid: "owner-job-91", nextExecutionAt: "2030-01-01T00:00:00.000Z" });

    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: { headers: { cookie: "" } },
      res: {},
    } as any);

    await caller.campaigns.createAndSend({
      title: "Owner job",
      subject: "Scheduled outreach",
      bodyTemplate: "Hello {{name}}",
      resumeId: null,
      recipients: ["candidate@example.com"],
      scheduledAt: "2030-01-01T00:00:00.000Z",
    });

    expect(mocks.createHeartbeatJob).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign-91" }), "");
    expect(updateWhere).toHaveBeenCalled();
  });
});
