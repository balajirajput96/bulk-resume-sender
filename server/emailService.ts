import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { campaignRecipients, campaigns, resumes, users } from "../drizzle/schema";
import { getDb } from "./db";
import { getGmailAccessToken } from "./googleOAuth";
import { storageGetSignedUrl } from "./storage";

const SEND_DELAY_MS = 250;

const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function getAttachmentPart(userId: number, resumeId: number | null | undefined, boundary: string): Promise<string> {
  if (!resumeId) return "";
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const resume = (await db.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1))[0];
  if (!resume) throw new Error("The selected resume is no longer available.");

  const signedUrl = await storageGetSignedUrl(resume.fileKey);
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("Unable to load the selected resume attachment.");
  const base64Data = Buffer.from(await response.arrayBuffer()).toString("base64");
  const mimeType = resume.filename.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return [
    `--${boundary}`,
    `Content-Type: ${mimeType}; name="${resume.filename}"`,
    `Content-Disposition: attachment; filename="${resume.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Data,
  ].join("\r\n");
}

export async function sendEmailViaGmail(userId: number, to: string, subject: string, htmlBody: string, resumeId?: number | null) {
  const accessToken = await getGmailAccessToken(userId);
  const boundary = `campaign_${randomUUID().replaceAll("-", "")}`;
  const attachmentPart = await getAttachmentPart(userId, resumeId, boundary);
  const messageLines = attachmentPart
    ? [
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        htmlBody,
        attachmentPart,
        `--${boundary}--`,
      ]
    : [
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        htmlBody,
      ];
  const raw = Buffer.from(messageLines.join("\r\n")).toString("base64url");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !data.id) throw new Error(data.error?.message || "Gmail could not send this message.");
  return { success: true, messageId: data.id };
}

export async function executeCampaign(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const campaign = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!campaign || campaign.status === "completed" || campaign.status === "failed") return;

  await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, campaignId));
  const recipients = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "pending")));
  let sentCount = campaign.sentCount;
  let failedCount = campaign.failedCount;

  for (const recipient of recipients) {
    try {
      const body = campaign.bodyTemplate
        .replace(/{{email}}/g, recipient.email)
        .replace(/{{name}}/g, recipient.email.split("@")[0]);
      await sendEmailViaGmail(campaign.userId, recipient.email, campaign.subject, body, campaign.resumeId);
      await db.update(campaignRecipients).set({ status: "sent", sentAt: new Date(), errorMessage: null }).where(eq(campaignRecipients.id, recipient.id));
      sentCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Gmail delivery failure";
      await db.update(campaignRecipients).set({ status: "failed", errorMessage: message }).where(eq(campaignRecipients.id, recipient.id));
      failedCount += 1;
    }
    await db.update(campaigns).set({ sentCount, failedCount }).where(eq(campaigns.id, campaignId));
    if (recipients.indexOf(recipient) < recipients.length - 1) await pause(SEND_DELAY_MS);
  }

  await db.update(campaigns).set({ status: "completed", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
  try {
    const owner = (await db.select().from(users).where(eq(users.id, campaign.userId)).limit(1))[0];
    if (owner?.email) {
      await sendEmailViaGmail(campaign.userId, owner.email, `Campaign summary: ${campaign.title}`,
        `<h3>Campaign completed</h3><p><strong>Recipients:</strong> ${campaign.totalRecipients}</p><p><strong>Sent:</strong> ${sentCount}</p><p><strong>Failed:</strong> ${failedCount}</p>`, null);
    }
  } catch (error) {
    console.error("[Campaign notification]", error);
  }
}
