/**
 * Lightweight email/password auth backed by an httpOnly cookie. Intentionally
 * minimal — no JWT, no refresh tokens — because the session just routes a
 * request to a MongoDB document holding the user's demo wallets.
 *
 * Passwords: scrypt + random salt, compared with timingSafeEqual.
 * Session binding: cookie value = Session `_id` (ObjectId string). Every
 * protected route reads it via `requireAuthSession()` and looks up the
 * matching document.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { validateObjectId } from "./validation";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const COOKIE_NAME = "xls66-auth";

/** Hash a plaintext password for persistence. Returns `salt:hash` hex-pair. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time comparison of a plaintext password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(hashBuffer, candidate);
}

/** Sets the httpOnly auth cookie. `secure` is auto-enabled in production. */
export async function setAuthCookie(sessionId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

/** Logout — deletes the cookie. */
export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Raw cookie value (may be any string, may be null). */
export async function getAuthSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Cookie value validated as a MongoDB ObjectId. Use this in protected route
 * handlers — it returns `null` both when the cookie is missing AND when the
 * value isn't a valid ObjectId, which collapses the 401 handling into a
 * single `if (!sessionId)` check.
 */
export async function requireAuthSession(): Promise<string | null> {
  const raw = await getAuthSessionId();
  return validateObjectId(raw);
}

export { COOKIE_NAME };
