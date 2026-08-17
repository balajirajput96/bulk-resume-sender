import { parse as parseCookie } from "cookie";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { createHeartbeatJob } from "./_core/heartbeat";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { campaignRecipients, campaigns, googleTokens, resumes } from "../drizzle/schema";
import { getDb } from "./db";
import { executeCampaign } from "./emailService";
import { isGoogleOAuthConfigured } from "./googleOAuth";
import { storagePut } from "./storage";

const MAX_RECIPIENTS_PER_CAMPAIGN = 100;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function buildOneTimeCron(date: Date): string {
  if (date.getTime() <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a future date and time for a scheduled campaign." });
  return `0 ${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}

function normalizeResume(filename: string, base64Data: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255);
  const extension = safeName.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "docx") throw new TRPCError({ code: "BAD_REQUEST", message: "Only PDF and DOCX resumes are allowed." });
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(base64Data)) throw new TRPCError({ code: "BAD_REQUEST", message: "The resume upload was not valid base64 data." });
  const buffer = Buffer.from(base64Data, "base64");
  if (!buffer.length || buffer.length > MAX_RESUME_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Resume must be between 1 byte and 5 MB." });
  if (extension === "pdf" && buffer.subarray(0, 4).toString("utf8") !== "%PDF") throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded PDF file header was invalid." });
  if (extension === "docx" && buffer.subarray(0, 2).toString("utf8") !== "PK") throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded DOCX file header was invalid." });
  return { safeName, extension, buffer };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  google: router({
    status: adminProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { configured: isGoogleOAuthConfigured(), connected: false, email: null, reauthorizationRequired: false };
      const token = (await db.select().from(googleTokens).where(eq(googleTokens.userId, ctx.user.id)).limit(1))[0];
      const requiresReauthorization = Boolean(token && (!token.refreshToken || !token.accessToken.startsWith("v1.")));
      return { configured: isGoogleOAuthConfigured(), connected: Boolean(token) && !requiresReauthorization, email: token?.googleEmail ?? null, reauthorizationRequired: requiresReauthorization };
    }),
    disconnect: adminProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(googleTokens).where(eq(googleTokens.userId, ctx.user.id));
      return { success: true };
    }),
  }),
  resumes: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(resumes).where(eq(resumes.userId, ctx.user.id)).orderBy(desc(resumes.createdAt));
    }),
    upload: adminProcedure.input(z.object({ filename: z.string().min(1).max(255), base64Data: z.string().min(8), fileSize: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { safeName, extension, buffer } = normalizeResume(input.filename, input.base64Data);
      const uploaded = await storagePut(`resumes/${ctx.user.id}/${Date.now()}_${safeName}`, buffer, extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const result = await db.insert(resumes).values({ userId: ctx.user.id, filename: safeName, fileKey: uploaded.key, fileUrl: uploaded.url, fileSize: buffer.length });
      return { success: true, resumeId: Number(result[0].insertId), url: uploaded.url };
    }),
    delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      // The managed storage layer safely makes the object unreachable once this DB reference is removed.
      await db.delete(resumes).where(and(eq(resumes.id, input.id), eq(resumes.userId, ctx.user.id)));
      return { success: true };
    }),
  }),
  campaigns: router({
    list: adminProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(campaigns).where(eq(campaigns.userId, ctx.user.id)).orderBy(desc(campaigns.createdAt));
    }),
    getDetail: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const campaign = (await db.select().from(campaigns).where(and(eq(campaigns.id, input.id), eq(campaigns.userId, ctx.user.id))).limit(1))[0];
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      return { campaign, recipients: await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaign.id)) };
    }),
    createAndSend: adminProcedure.input(z.object({
      title: z.string().trim().min(1).max(255),
      subject: z.string().trim().min(1).max(500),
      bodyTemplate: z.string().trim().min(1).max(50_000),
      resumeId: z.number().int().positive().nullable(),
      recipients: z.array(z.string().trim().email()).min(1).max(MAX_RECIPIENTS_PER_CAMPAIGN),
      scheduledAt: z.string().datetime().nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const connection = (await db.select().from(googleTokens).where(eq(googleTokens.userId, ctx.user.id)).limit(1))[0];
      if (!isGoogleOAuthConfigured() || !connection?.refreshToken || !connection.accessToken.startsWith("v1.")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect Gmail through Google authorization before creating a sending campaign." });
      }
      const recipients = Array.from(new Set(input.recipients.map(email => email.toLowerCase())));
      const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (scheduledDate && Number.isNaN(scheduledDate.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid schedule date." });
      const status = scheduledDate && scheduledDate > new Date() ? "scheduled" : "sending";
      const result = await db.insert(campaigns).values({ userId: ctx.user.id, title: input.title, subject: input.subject, bodyTemplate: input.bodyTemplate, resumeId: input.resumeId, status, scheduledAt: scheduledDate, totalRecipients: recipients.length, sentCount: 0, failedCount: 0 });
      const campaignId = Number(result[0].insertId);
      await db.insert(campaignRecipients).values(recipients.map(email => ({ campaignId, email, status: "pending" as const })));
      if (status === "scheduled" && scheduledDate) {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        if (!sessionToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "Your session is required to schedule a campaign." });
        const job = await createHeartbeatJob({ name: `campaign-${campaignId}`, cron: buildOneTimeCron(scheduledDate), path: "/api/scheduled/send-campaign", payload: { campaignId }, description: `One-time email campaign ${campaignId}` }, sessionToken);
        await db.update(campaigns).set({ scheduleCronTaskUid: job.taskUid }).where(eq(campaigns.id, campaignId));
        return { success: true, campaignId, status, nextExecutionAt: job.nextExecutionAt ?? null };
      }
      await executeCampaign(campaignId);
      return { success: true, campaignId, status: "completed", nextExecutionAt: null };
    }),
  }),
  ai: router({
    generateEmail: adminProcedure.input(z.object({ jobTitle: z.string().trim().min(1).max(180), companyName: z.string().trim().min(1).max(180), tone: z.string().trim().min(1).max(80), keyPoints: z.string().trim().min(1).max(2_000) })).mutation(async ({ input }) => {
      const response = await invokeLLM({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: "You write concise, truthful professional outreach. Do not invent achievements or experience. Output JSON only." },
          { role: "user", content: `Draft an outreach email for a ${input.jobTitle} role at ${input.companyName}. Tone: ${input.tone}. Facts to use: ${input.keyPoints}.` },
        ] as any,
        response_format: { type: "json_schema", json_schema: { name: "outreach_email", strict: true, schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false } } },
      });
      const content = response.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI drafting returned an invalid response. Please try again." });
      const draft = JSON.parse(content) as { subject: string; body: string };
      if (!draft.subject || !draft.body) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI drafting returned an incomplete response. Please try again." });
      return draft;
    }),
  }),
});

export type AppRouter = typeof appRouter;
