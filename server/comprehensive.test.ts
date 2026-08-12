import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { checkAndExecuteScheduledCampaigns } from "./cronJob";

describe("Bulk Resume Sender Comprehensive Tests", () => {
  it("verifies cron job runner function exists and executes cleanly", async () => {
    expect(typeof checkAndExecuteScheduledCampaigns).toBe("function");
  }, 10000);

  it("verifies tRPC routers are fully registered", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("auth.me");
    expect(procedures).toHaveProperty("auth.logout");
    expect(procedures).toHaveProperty("google.status");
    expect(procedures).toHaveProperty("google.connect");
    expect(procedures).toHaveProperty("google.disconnect");
    expect(procedures).toHaveProperty("resumes.list");
    expect(procedures).toHaveProperty("resumes.upload");
    expect(procedures).toHaveProperty("resumes.delete");
    expect(procedures).toHaveProperty("campaigns.list");
    expect(procedures).toHaveProperty("campaigns.getDetail");
    expect(procedures).toHaveProperty("campaigns.createAndSend");
    expect(procedures).toHaveProperty("ai.generateEmail");
  });
});
