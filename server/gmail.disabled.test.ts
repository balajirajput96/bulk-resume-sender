import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("./googleOAuth", () => ({
  isGoogleOAuthConfigured: () => false,
}));

import { appRouter } from "./routers";

describe("Gmail-disabled campaign safeguards", () => {
  it("blocks campaign dispatch before creating recipients when Gmail OAuth is not configured", async () => {
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    });

    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: { headers: { cookie: "" } },
      res: {},
    } as any);

    await expect(
      caller.campaigns.createAndSend({
        title: "Safeguard test",
        subject: "No Gmail dispatch",
        bodyTemplate: "This must not be sent.",
        resumeId: null,
        recipients: ["recipient@example.com"],
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "PRECONDITION_FAILED",
      message: "Connect Gmail through Google authorization before creating a sending campaign.",
    });
  });
});
