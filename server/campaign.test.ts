import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("Campaign & AI Router Tests", () => {
  it("verifies tRPC router setup for campaigns and resumes", () => {
    expect(appRouter._def.procedures).toHaveProperty("campaigns.list");
    expect(appRouter._def.procedures).toHaveProperty("resumes.list");
    expect(appRouter._def.procedures).toHaveProperty("google.status");
    expect(appRouter._def.procedures).toHaveProperty("ai.generateEmail");
  });
});
