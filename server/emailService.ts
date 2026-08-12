import { getDb } from "./db";
import { googleTokens, campaigns, campaignRecipients, resumes, users } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { storageGet } from "./storage";
import axios from "axios";

/**
 * Send an email via Gmail API using OAuth access token with optional resume attachment
 */
export async function sendEmailViaGmail(userId: number, to: string, subject: string, htmlBody: string, resumeId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tokenRes = await db.select().from(googleTokens).where(eq(googleTokens.userId, userId)).limit(1);
  if (tokenRes.length === 0) {
    throw new Error("Google account not connected. Please link your Google account first.");
  }

  const tokenRecord = tokenRes[0];
  let accessToken = tokenRecord.accessToken;

  // Fetch resume attachment if resumeId is provided
  let attachmentPart = "";
  let boundary = "foo_bar_baz";

  if (resumeId) {
    const resumeRes = await db.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1);
    if (resumeRes.length > 0) {
      const resume = resumeRes[0];
      try {
        // Download resume file from S3 storage
        const fileData = await storageGet(resume.fileKey);
        if (fileData && fileData.url) {
          const fileResp = await axios.get(fileData.url, { responseType: 'arraybuffer' });
          const base64Data = Buffer.from(fileResp.data).toString('base64');
          const mimeType = resume.filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

          attachmentPart = `\r\n--${boundary}\r\n` +
            `Content-Type: ${mimeType}; name="${resume.filename}"\r\n` +
            `Content-Disposition: attachment; filename="${resume.filename}"\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            `${base64Data}\r\n`;
        }
      } catch (err) {
        console.error("[Gmail] Failed to fetch resume attachment for email:", err);
      }
    }
  }

  const hasAttachment = attachmentPart.length > 0;
  
  let rawMessage = "";
  if (hasAttachment) {
    rawMessage = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      htmlBody,
      attachmentPart,
      `--${boundary}--`
    ].join("\r\n");
  } else {
    rawMessage = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      htmlBody
    ].join("\r\n");
  }

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const response = await axios.post(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
      { raw: encodedMessage },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { success: true, messageId: response.data.id };
  } catch (error: any) {
    console.error("[Gmail API Error]", error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message || "Failed to send email via Gmail API");
  }
}

/**
 * Execute a campaign by sending emails to all pending recipients
 */
export async function executeCampaign(campaignId: number) {
  const db = await getDb();
  if (!db) return;

  const campaignRes = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (campaignRes.length === 0) return;
  const campaign = campaignRes[0];

  await db.update(campaigns).set({ status: 'sending' }).where(eq(campaigns.id, campaignId));

  const recipients = await db.select().from(campaignRecipients).where(
    and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'pending'))
  );

  let sentCount = campaign.sentCount;
  let failedCount = campaign.failedCount;

  for (const recipient of recipients) {
    try {
      // Personalize message if placeholders exist
      let personalizedBody = campaign.bodyTemplate
        .replace(/{{email}}/g, recipient.email)
        .replace(/{{name}}/g, recipient.email.split('@')[0]);

      await sendEmailViaGmail(campaign.userId, recipient.email, campaign.subject, personalizedBody, campaign.resumeId);

      await db.update(campaignRecipients)
        .set({ status: 'sent', sentAt: new Date(), errorMessage: null })
        .where(eq(campaignRecipients.id, recipient.id));

      sentCount++;
    } catch (err: any) {
      await db.update(campaignRecipients)
        .set({ status: 'failed', errorMessage: err.message || 'Unknown error' })
        .where(eq(campaignRecipients.id, recipient.id));

      failedCount++;
    }

    await db.update(campaigns)
      .set({ sentCount, failedCount })
      .where(eq(campaigns.id, campaignId));
  }

  const finalStatus = failedCount === 0 ? 'completed' : 'completed';
  await db.update(campaigns).set({ status: finalStatus, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

  // Send owner notification summary
  try {
    const ownerRes = await db.select().from(users).where(eq(users.id, campaign.userId)).limit(1);
    if (ownerRes.length > 0 && ownerRes[0].email) {
      await sendEmailViaGmail(
        campaign.userId,
        ownerRes[0].email,
        `Campaign Summary: "${campaign.title}" Completed`,
        `<h3>Campaign Execution Completed</h3>
         <p><b>Campaign:</b> ${campaign.title}</p>
         <p><b>Total Recipients:</b> ${campaign.totalRecipients}</p>
         <p><b>Successfully Sent:</b> ${sentCount}</p>
         <p><b>Failures:</b> ${failedCount}</p>
         <p>Check your dashboard for detailed recipient delivery logs.</p>`,
        null
      );
    }
  } catch (notifErr) {
    console.error("[Campaign Notification Error]", notifErr);
  }
}
