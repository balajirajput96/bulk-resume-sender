import type { Express } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { campaigns } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { deleteHeartbeatJob } from "./_core/heartbeat";
import { executeCampaign } from "./emailService";

/** Registers the platform-authenticated callback for scheduled campaigns. */
export function registerScheduledCampaignRoutes(app: Express): void {
  app.post("/api/scheduled/send-campaign", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const campaign = (await db.select().from(campaigns).where(eq(campaigns.scheduleCronTaskUid, user.taskUid)).limit(1))[0];
      if (!campaign) return res.json({ ok: true, skipped: "orphan" });
      if (campaign.status !== "scheduled") return res.json({ ok: true, skipped: "not-scheduled" });
      if (campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) return res.json({ ok: true, skipped: "early" });

      await executeCampaign(campaign.id);
      try {
        await deleteHeartbeatJob(user.taskUid, "");
        await db.update(campaigns).set({ scheduleCronTaskUid: null }).where(eq(campaigns.id, campaign.id));
      } catch (cleanupError) {
        // Delivery already completed. Keep the reference for later investigation
        // rather than converting a successful campaign into a failed callback.
        console.error("[Scheduled Campaign] Unable to remove completed one-time job", cleanupError);
      }
      return res.json({ ok: true, campaignId: campaign.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Scheduled Campaign]", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
}
