import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { campaigns, campaignRecipients, resumes, googleTokens, users } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { storagePut } from "./storage";
import { sendEmailViaGmail, executeCampaign } from "./emailService";
import { invokeLLM } from "./_core/llm";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Google OAuth & Gmail integration status
  google: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { connected: false, email: null };
      const tokens = await db.select().from(googleTokens).where(eq(googleTokens.userId, ctx.user.id)).limit(1);
      if (tokens.length === 0) return { connected: false, email: null };
      return { connected: true, email: tokens[0].googleEmail };
    }),
    
    // Connect / save mock or real Google OAuth token
    connect: protectedProcedure
      .input(z.object({ googleEmail: z.string(), accessToken: z.string(), refreshToken: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        await db.insert(googleTokens).values({
          userId: ctx.user.id,
          googleEmail: input.googleEmail,
          accessToken: input.accessToken,
          refreshToken: input.refreshToken || null,
        }).onDuplicateKeyUpdate({
          set: {
            googleEmail: input.googleEmail,
            accessToken: input.accessToken,
            refreshToken: input.refreshToken || null,
            updatedAt: new Date(),
          },
        });
        return { success: true };
      }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(googleTokens).where(eq(googleTokens.userId, ctx.user.id));
      return { success: true };
    }),
  }),

  // Resumes router
  resumes: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(resumes).where(eq(resumes.userId, ctx.user.id)).orderBy(desc(resumes.createdAt));
    }),

    upload: protectedProcedure
      .input(z.object({ filename: z.string(), base64Data: z.string(), fileSize: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const buffer = Buffer.from(input.base64Data, 'base64');
        const fileKey = `resumes/${ctx.user.id}/${Date.now()}_${input.filename}`;
        const contentType = input.filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        
        const uploaded = await storagePut(fileKey, buffer, contentType);

        const [insertRes] = await db.insert(resumes).values({
          userId: ctx.user.id,
          filename: input.filename,
          fileKey: fileKey,
          fileUrl: uploaded.url,
          fileSize: input.fileSize || buffer.length,
        });

        return { success: true, resumeId: insertRes.insertId, url: uploaded.url };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(resumes).where(and(eq(resumes.id, input.id), eq(resumes.userId, ctx.user.id)));
        return { success: true };
      }),
  }),

  // Campaigns router
  campaigns: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(campaigns).where(eq(campaigns.userId, ctx.user.id)).orderBy(desc(campaigns.createdAt));
    }),

    getDetail: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const campRes = await db.select().from(campaigns).where(and(eq(campaigns.id, input.id), eq(campaigns.userId, ctx.user.id))).limit(1);
        if (campRes.length === 0) throw new Error("Campaign not found");
        
        const recs = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, input.id));
        return { campaign: campRes[0], recipients: recs };
      }),

    createAndSend: protectedProcedure
      .input(z.object({
        title: z.string(),
        subject: z.string(),
        bodyTemplate: z.string(),
        resumeId: z.number().nullable(),
        recipients: z.array(z.string()),
        scheduledAt: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;
        const status = scheduledDate && scheduledDate > new Date() ? 'scheduled' : 'sending';

        const [campResult] = await db.insert(campaigns).values({
          userId: ctx.user.id,
          title: input.title,
          subject: input.subject,
          bodyTemplate: input.bodyTemplate,
          resumeId: input.resumeId,
          status: status,
          scheduledAt: scheduledDate,
          totalRecipients: input.recipients.length,
          sentCount: 0,
          failedCount: 0,
        });

        const campaignId = campResult.insertId;

        // Insert recipients
        if (input.recipients.length > 0) {
          const recipientValues = input.recipients.map(email => ({
            campaignId,
            email: email.trim(),
            status: 'pending' as const,
          }));
          await db.insert(campaignRecipients).values(recipientValues);
        }

        // If not scheduled for future, run immediately in background
        if (status === 'sending') {
          executeCampaign(campaignId).catch(err => console.error("[Campaign Execution Error]", err));
        }

        return { success: true, campaignId, status };
      }),
  }),

  // AI Email Assistant
  ai: router({
    generateEmail: protectedProcedure
      .input(z.object({
        jobTitle: z.string(),
        companyName: z.string(),
        tone: z.string(),
        keyPoints: z.string(),
      }))
      .mutation(async ({ input }) => {
        const prompt = `Write a professional, compelling outreach email / cover letter for the position of "${input.jobTitle}" at "${input.companyName}".
Tone: ${input.tone}
Key points to include: ${input.keyPoints}

Return a JSON object with two fields:
1. "subject": A catchy, professional email subject line.
2. "body": The HTML-formatted email body (using <p>, <br>, <strong> tags) tailored for professional outreach. No markdown code blocks, just raw HTML string or clean text formatted with HTML tags.`;

        try {
          const response = await invokeLLM({
            messages: [{ role: "user", content: prompt }] as any,
            response_format: { type: "json_object" },
          });

          const rawContent = typeof response === 'string' ? response : (typeof response.choices?.[0]?.message?.content === 'string' ? response.choices[0].message.content : "{}");
          const parsed = JSON.parse(rawContent);
          return {
            subject: parsed.subject || `Application for ${input.jobTitle} at ${input.companyName}`,
            body: parsed.body || `<p>Dear Hiring Manager at ${input.companyName},</p><p>I am writing to express my strong interest in the ${input.jobTitle} role.</p>`,
          };
        } catch (error) {
          console.error("[AI Generation Error]", error);
          return {
            subject: `Application for ${input.jobTitle} at ${input.companyName}`,
            body: `<p>Dear Hiring Manager at ${input.companyName},</p><p>I am writing to express my strong interest in the ${input.jobTitle} role.</p><p>Best regards,<br/>Candidate</p>`,
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
