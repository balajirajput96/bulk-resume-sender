import { getDb } from "./db";
import { campaigns } from "../drizzle/schema";
import { and, eq, lte } from "drizzle-orm";
import { executeCampaign } from "./emailService";

/**
 * Scheduled campaigns checker executed periodically via heartbeat or interval
 */
export async function checkAndExecuteScheduledCampaigns() {
  try {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const scheduledCampaigns = await db.select().from(campaigns).where(
      and(
        eq(campaigns.status, 'scheduled'),
        lte(campaigns.scheduledAt, now)
      )
    );

    for (const campaign of scheduledCampaigns) {
      console.log(`[Cron] Executing scheduled campaign #${campaign.id}: "${campaign.title}"`);
      await executeCampaign(campaign.id);
    }
  } catch (error) {
    console.error("[Cron Error] Failed to process scheduled campaigns:", error);
  }
}
