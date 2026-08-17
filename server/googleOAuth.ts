import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { googleTokens } from "../drizzle/schema";
import { ENV } from "./_core/env";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const TOKEN_VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1000;

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type SignedOAuthState = {
  userId: number;
  redirectUri: string;
  issuedAt: number;
  nonce: string;
};

function getEncryptionKey(): Buffer {
  if (!ENV.cookieSecret) {
    throw new Error("Application encryption is unavailable. Set JWT_SECRET before connecting Gmail.");
  }
  return crypto.createHash("sha256").update(ENV.cookieSecret).digest();
}

function sealToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function unsealToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== TOKEN_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("This Gmail connection must be re-authorized securely.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getEncryptionKey()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(ENV.googleClientId && ENV.googleClientSecret);
}

export function createGoogleOAuthState(userId: number, redirectUri: string): string {
  const state: SignedOAuthState = {
    userId,
    redirectUri,
    issuedAt: Date.now(),
    nonce: crypto.randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyGoogleOAuthState(stateValue: string): SignedOAuthState {
  const [payload, signature] = stateValue.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) {
    throw new Error("Google authorization state was invalid or expired.");
  }
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedOAuthState;
  if (!state.userId || !state.redirectUri || Date.now() - state.issuedAt > STATE_TTL_MS) {
    throw new Error("Google authorization state was invalid or expired.");
  }
  return state;
}

export function buildGoogleAuthorizationUrl(state: string, redirectUri: string): string {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Gmail connection is not configured yet. Add the Google OAuth client credentials first.");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ENV.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function requestGoogleToken(parameters: Record<string, string>): Promise<GoogleTokenResponse> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Gmail connection is not configured yet. Add the Google OAuth client credentials first.");
  }
  const body = new URLSearchParams({
    client_id: ENV.googleClientId,
    client_secret: ENV.googleClientSecret,
    ...parameters,
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse & { error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Google rejected the authorization request.");
  }
  return data;
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  return requestGoogleToken({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_PROFILE_ENDPOINT, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = (await response.json().catch(() => ({}))) as { email?: string };
  if (!response.ok || !data.email) {
    throw new Error("Unable to confirm the authorized Google email address.");
  }
  return data.email;
}

export async function persistGoogleTokens(userId: number, email: string, tokens: GoogleTokenResponse): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const expiresAt = new Date(Date.now() + Math.max(tokens.expires_in ?? 3600, 60) * 1000);
  const existing = await db.select().from(googleTokens).where(eq(googleTokens.userId, userId)).limit(1);
  const refreshToken = tokens.refresh_token ? sealToken(tokens.refresh_token) : existing[0]?.refreshToken ?? null;
  if (!refreshToken) throw new Error("Google did not return a refresh token. Reconnect Gmail and approve access again.");

  await db.insert(googleTokens).values({
    userId,
    googleEmail: email,
    accessToken: sealToken(tokens.access_token),
    refreshToken,
    expiresAt,
  }).onDuplicateKeyUpdate({
    set: {
      googleEmail: email,
      accessToken: sealToken(tokens.access_token),
      refreshToken,
      expiresAt,
      updatedAt: new Date(),
    },
  });
}

export async function getGmailAccessToken(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(googleTokens).where(eq(googleTokens.userId, userId)).limit(1);
  if (!result[0]) throw new Error("Connect Gmail before sending a campaign.");

  const stored = result[0];
  const hasValidToken = Boolean(stored.expiresAt && stored.expiresAt.getTime() > Date.now() + 60_000);
  if (hasValidToken) return unsealToken(stored.accessToken);
  if (!stored.refreshToken) throw new Error("Your Gmail connection expired. Reconnect Gmail before sending.");

  const refreshed = await requestGoogleToken({
    grant_type: "refresh_token",
    refresh_token: unsealToken(stored.refreshToken),
  });
  const expiresAt = new Date(Date.now() + Math.max(refreshed.expires_in ?? 3600, 60) * 1000);
  await db.update(googleTokens).set({ accessToken: sealToken(refreshed.access_token), expiresAt, updatedAt: new Date() }).where(eq(googleTokens.userId, userId));
  return refreshed.access_token;
}
