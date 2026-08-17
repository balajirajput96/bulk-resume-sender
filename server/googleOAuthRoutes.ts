import type { Express, Request } from "express";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  exchangeGoogleAuthorizationCode,
  fetchGoogleEmail,
  persistGoogleTokens,
  verifyGoogleOAuthState,
} from "./googleOAuth";

function redirectUriFor(req: Request): string {
  if (ENV.googleOAuthRedirectUri) return ENV.googleOAuthRedirectUri;
  const forwardedProtocol = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = req.get("host");
  if (!host) throw new Error("Unable to determine the application callback URL.");
  return `${protocol}://${host}/api/google/callback`;
}

function redirectHomeWithError(res: Parameters<Express["get"]>[1] extends (req: any, res: infer R) => any ? R : any, message: string) {
  return res.redirect(`/?google_error=${encodeURIComponent(message)}`);
}

export function registerGoogleOAuthRoutes(app: Express): void {
  app.get("/api/google/connect", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.isCron) return res.status(403).json({ error: "cron-only" });
      const redirectUri = redirectUriFor(req);
      const state = createGoogleOAuthState(user.id, redirectUri);
      return res.redirect(buildGoogleAuthorizationUrl(state, redirectUri));
    } catch (error) {
      return redirectHomeWithError(res, error instanceof Error ? error.message : "Unable to start Google authorization.");
    }
  });

  app.get("/api/google/callback", async (req, res) => {
    const providerError = typeof req.query.error === "string" ? req.query.error : null;
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const stateValue = typeof req.query.state === "string" ? req.query.state : null;
    if (providerError || !code || !stateValue) {
      return redirectHomeWithError(res, providerError || "Google authorization was cancelled or invalid.");
    }

    try {
      const state = verifyGoogleOAuthState(stateValue);
      const tokens = await exchangeGoogleAuthorizationCode(code, state.redirectUri);
      const email = await fetchGoogleEmail(tokens.access_token);
      await persistGoogleTokens(state.userId, email, tokens);
      return res.redirect("/?gmail=connected");
    } catch (error) {
      return redirectHomeWithError(res, error instanceof Error ? error.message : "Unable to finish Google authorization.");
    }
  });
}
