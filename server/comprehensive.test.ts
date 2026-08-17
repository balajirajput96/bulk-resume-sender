import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { createGoogleOAuthState, verifyGoogleOAuthState } from "./googleOAuth";

describe("Bulk Resume Sender Comprehensive Tests", () => {
  it("signs and validates a short-lived Google OAuth state payload", () => {
    const state = createGoogleOAuthState(42, "https://app.example.com/api/google/callback");
    expect(verifyGoogleOAuthState(state)).toMatchObject({
      userId: 42,
      redirectUri: "https://app.example.com/api/google/callback",
    });
  });

  it("rejects a tampered Google OAuth state payload", () => {
    const state = createGoogleOAuthState(42, "https://app.example.com/api/google/callback");
    expect(() => verifyGoogleOAuthState(`${state}tampered`)).toThrow(/invalid|expired/i);
  });

  it("verifies tRPC routers are fully registered", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("auth.me");
    expect(procedures).toHaveProperty("auth.logout");
    expect(procedures).toHaveProperty("google.status");
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
