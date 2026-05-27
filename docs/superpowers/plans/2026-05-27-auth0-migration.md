# Auth0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homegrown scrypt+cookie auth with Auth0 Universal Login (email/password, verified email required), wired through the `@auth0/nextjs-auth0` v4 SDK. The existing custodial XRPL wallet provisioning continues to work, but is keyed by Auth0 `sub` instead of a Mongo ObjectId.

**Architecture:** Auth0 SDK v4 middleware mounts `/auth/*` routes automatically (no catch-all Route Handler in v4). A new `getOrCreateUserWallets()` helper provisions the 4 testnet wallets lazily on the first `GET /api/session/me` after signup. All other protected routes call a lookup-only `getUserWallets()` helper. The existing CSRF same-origin check remains, chained after the Auth0 middleware.

**Tech Stack:** Next.js 16 (App Router), `@auth0/nextjs-auth0` v4, Mongoose, MongoDB. No test framework in the repo — verification is `npm run build` (type-check) plus manual flows.

**Source spec:** `docs/superpowers/specs/2026-05-27-auth0-migration-design.md`

**Important note on v4 SDK:** The brainstorming spec mentioned a `src/app/auth/[auth0]/route.ts` catch-all. After verifying SDK v4 docs, that file is **NOT** needed — v4 auto-mounts `/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile`, `/auth/access-token`, `/auth/backchannel-logout` directly from the middleware. The plan reflects v4 (no catch-all file).

---

## Task 1: Install Auth0 SDK and add env scaffolding

**Files:**
- Modify: `package.json` (npm will rewrite)
- Modify: `.env.example`

- [ ] **Step 1: Install the SDK**

```bash
npm install @auth0/nextjs-auth0@^4
```

- [ ] **Step 2: Add Auth0 env vars to `.env.example`**

Append to `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/.env.example`:

```bash

# Auth0 — required for authentication.
# Generate AUTH0_SECRET with: openssl rand -hex 32
# Dashboard: https://manage.auth0.com → Applications → <your app> → Settings
AUTH0_SECRET=
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Confirm `.env.local` already has real values**

The user already populated `.env.local`. Verify with:

```bash
grep -E '^AUTH0_|^APP_BASE_URL' /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app/.env.local
```

Expected: 5 non-empty lines. If any are missing, stop and ask the user.

- [ ] **Step 4: Confirm build still passes**

```bash
cd /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app && npm run build
```

Expected: build succeeds (we haven't changed any code yet, just added a dep).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "Add @auth0/nextjs-auth0 dependency and env scaffolding"
```

---

## Task 2: Create the Auth0 SDK client singleton

**Files:**
- Create: `src/lib/auth0.ts`

- [ ] **Step 1: Create the singleton**

Write `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/auth0.ts`:

```typescript
import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 SDK v4 client singleton. Reads configuration from env vars:
 *   AUTH0_SECRET, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, APP_BASE_URL.
 *
 * The v4 SDK auto-mounts /auth/login, /auth/logout, /auth/callback,
 * /auth/profile, /auth/access-token, /auth/backchannel-logout via
 * `auth0.middleware(request)` in src/middleware.ts. No Route Handler needed.
 */
export const auth0 = new Auth0Client();
```

- [ ] **Step 2: Verify type-check**

```bash
cd /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth0.ts
git commit -m "Add Auth0 SDK v4 client singleton"
```

---

## Task 3: Create the UserWallets Mongoose model

**Files:**
- Create: `src/lib/db/models/user-wallets.ts`
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Create the model**

Write `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/db/models/user-wallets.ts`:

```typescript
import mongoose, { Schema } from "mongoose";

const walletSchema = new Schema(
  {
    address: { type: String, required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
    seed: { type: String, required: true },
    role: {
      type: String,
      enum: ["broker", "depositor", "borrower", "issuer"],
      required: true,
    },
    balance: { type: String },
  },
  { _id: false }
);

const userWalletsSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true },
    wallets: { type: [walletSchema], required: true },
    vaultId: { type: String },
    loanBrokerId: { type: String },
    issuedToken: {
      type: { type: String, enum: ["IOU", "MPT"] },
      currency: { type: String },
      issuer: { type: String },
      mptIssuanceId: { type: String },
    },
  },
  { timestamps: true }
);

export const UserWalletsModel =
  mongoose.models.UserWallets ||
  mongoose.model("UserWallets", userWalletsSchema);
```

- [ ] **Step 2: Export from db index**

Edit `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/db/index.ts`:

```typescript
export { connectDB } from "./connection";
export { SessionModel } from "./models/session";
export { UserWalletsModel } from "./models/user-wallets";
export { VaultModel } from "./models/vault";
export { LoanModel } from "./models/loan";
export { DepositHistoryModel } from "./models/deposit-history";
```

We keep `SessionModel` exported in parallel for now — it gets removed in Task 14 once all callers are migrated.

- [ ] **Step 3: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/models/user-wallets.ts src/lib/db/index.ts
git commit -m "Add UserWallets Mongoose model keyed by auth0Sub"
```

---

## Task 4: Create the user-wallets helpers (server chokepoint)

**Files:**
- Create: `src/lib/user-wallets.ts`

- [ ] **Step 1: Create the helpers**

Write `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/user-wallets.ts`:

```typescript
import { auth0 } from "./auth0";
import { connectDB, UserWalletsModel } from "./db";
import { generateAndFundWallet } from "./xrpl/wallet";

/**
 * Server-side chokepoint replacing the old `requireAuthSession()` for the
 * `/api/session/me` route. Looks up the UserWallets document by Auth0 `sub`.
 * If absent (first login after Auth0 signup), provisions 4 funded XRPL
 * testnet wallets and inserts the document. Handles the first-login race
 * by catching the unique-index duplicate-key error.
 *
 * Returns the full document (with seeds) — the route handler is responsible
 * for redacting before sending to the client.
 *
 * Returns null only if the Auth0 session itself is missing.
 */
export async function getOrCreateUserWallets() {
  const session = await auth0.getSession();
  if (!session?.user) return null;
  const sub = session.user.sub;
  const email = session.user.email;
  if (!sub || !email) return null;

  await connectDB();

  const existing = await UserWalletsModel.findOne({ auth0Sub: sub });
  if (existing) return existing;

  const roles = ["broker", "depositor", "borrower", "issuer"] as const;
  const wallets = await Promise.all(
    roles.map(async (role) => ({ ...(await generateAndFundWallet()), role }))
  );

  try {
    return await UserWalletsModel.create({ auth0Sub: sub, email, wallets });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // A parallel request beat us to the insert — return its winning doc.
      // The 4 wallets we just funded are orphaned on testnet (acceptable).
      return await UserWalletsModel.findOne({ auth0Sub: sub });
    }
    throw err;
  }
}

/**
 * Lookup-only variant used by every protected route OTHER than
 * `/api/session/me`. Returns null if the user is unauthenticated OR if no
 * UserWallets document exists — callers respond 401 in both cases. The
 * caller can use `getOrCreateUserWallets` if it needs to be the entry point.
 */
export async function getUserWallets() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) return null;
  await connectDB();
  return await UserWalletsModel.findOne({ auth0Sub: session.user.sub });
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}
```

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/user-wallets.ts
git commit -m "Add getOrCreateUserWallets and getUserWallets helpers"
```

---

## Task 5: Rename Session type to UserWallets

**Files:**
- Modify: `src/types/session.ts`

- [ ] **Step 1: Update the type**

Replace the contents of `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/types/session.ts` with:

```typescript
/** Server-internal wallet record loaded from MongoDB. Includes secrets. */
export interface WalletInfo {
  address: string;
  publicKey: string;
  privateKey: string;
  seed: string;
  role: "broker" | "depositor" | "borrower" | "issuer";
  balance?: string;
}

/** Wire shape of a wallet returned to the client — secrets are stripped. */
export interface PublicWallet {
  address: string;
  publicKey: string;
  role: "broker" | "depositor" | "borrower" | "issuer";
  balance?: string;
}

export interface IssuedToken {
  type: "IOU" | "MPT";
  currency?: string;
  issuer?: string;
  mptIssuanceId?: string;
}

/**
 * Shape of the user record as the client receives it. Keyed by Auth0 `sub`.
 * `wallets` excludes `seed` / `privateKey` (see `lib/session-public.ts:redactSession`).
 * No `passwordHash` — Auth0 owns credentials.
 */
export interface Session {
  _id: string;
  auth0Sub: string;
  email: string;
  wallets: PublicWallet[];
  vaultId?: string;
  loanBrokerId?: string;
  issuedToken?: IssuedToken;
  createdAt: Date;
  updatedAt: Date;
}
```

We keep the type name `Session` to minimize blast radius across components — only the field set changes (add `auth0Sub`, remove `passwordHash` which was never on the public type anyway).

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/session.ts
git commit -m "Add auth0Sub to Session type"
```

---

## Task 6: Rewrite middleware to chain Auth0 SDK with CSRF check

**Files:**
- Modify: `src/middleware.ts`

This task is the **first** that materially changes behavior. After this commit, the app's `/dashboard` will require an Auth0 session, and the old cookie-based flow will stop working. The next several tasks restore functionality on the new path.

- [ ] **Step 1: Replace middleware**

Replace the contents of `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/middleware.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Public API endpoints reachable without an Auth0 session. Exact-match only.
 * The `/auth/*` namespace is implicitly public — those routes ARE the auth
 * flow (handled by `auth0.middleware`).
 */
const PUBLIC_API_PATHS = new Set([
  "/api/openapi",
  "/api/docs",
]);

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function middleware(request: NextRequest) {
  // 1. Auth0 middleware runs first. It auto-mounts /auth/* routes and
  //    refreshes the session cookie. Its response carries Set-Cookie headers
  //    that we must propagate downstream.
  const authRes = await auth0.middleware(request);

  // 2. Auth0-owned routes: return immediately. The OAuth callback uses PKCE
  //    + state, so we don't apply the same-origin CSRF check to them.
  if (request.nextUrl.pathname.startsWith("/auth")) {
    return authRes;
  }

  // 3. CSRF: same-origin enforcement on mutating requests. Browsers always
  //    send `Origin` on cross-site fetches and on same-origin POSTs; if it's
  //    present and the host doesn't match, the request is cross-origin.
  //    Server-side tools (curl, Postman) typically don't send `Origin`, so
  //    they pass — they'd still need a valid Auth0 session cookie.
  if (UNSAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== request.nextUrl.host) {
          return NextResponse.json(
            { error: "Cross-origin request blocked" },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
      }
    }
  }

  // 4. Public endpoints bypass the session gate.
  if (PUBLIC_API_PATHS.has(request.nextUrl.pathname)) {
    return authRes;
  }

  // 5. Session gate. Per-route handlers also call `getUserWallets()` for
  //    defense in depth, but blocking here short-circuits before any DB work.
  const session = await auth0.getSession(request);
  if (!session) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (request.nextUrl.pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return authRes;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt (metadata)
     * - public files with file extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.).*)",
  ],
};
```

Note: the matcher widens from `/dashboard/:path*|/api/:path*` to match all paths except static assets. This is required because Auth0's middleware needs to handle `/auth/*` (which is not under `/api/` or `/dashboard/`).

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test the auth0 routes mount**

```bash
npm run dev
```

In another terminal:
```bash
curl -sI http://localhost:3000/auth/login
```

Expected: `302` redirect with `Location: https://<AUTH0_DOMAIN>/authorize?...`.

If you get a 404, the Auth0 middleware is not picking up env vars — check `.env.local` is in the right directory and `npm run dev` was restarted after edits.

Stop the dev server (`Ctrl+C`) before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "Chain Auth0 middleware with same-origin CSRF check"
```

---

## Task 7: Migrate /api/session/me to use getOrCreateUserWallets

**Files:**
- Modify: `src/app/api/session/me/route.ts`

- [ ] **Step 1: Replace the route**

Replace the contents of `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/app/api/session/me/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { getOrCreateUserWallets } from "@/lib/user-wallets";
import { UserWalletsModel } from "@/lib/db";
import { redactSession } from "@/lib/session-public";

/**
 * Returns the caller's UserWallets document. On the FIRST authenticated
 * request after Auth0 signup, this is where the 4 XRPL testnet wallets are
 * provisioned (~5–10s). Subsequent calls are a single Mongo lookup.
 */
export async function GET() {
  const userWallets = await getOrCreateUserWallets();
  if (!userWallets) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Heal stale state: an issuedToken without a vault can only come from an
  // earlier IOU/MPT vault that was deleted. Leaving it on the record would
  // cause downstream code to mis-build Amount fields for a fresh XRP vault.
  if (userWallets.issuedToken && !userWallets.vaultId) {
    await UserWalletsModel.findByIdAndUpdate(userWallets._id, {
      $unset: { issuedToken: 1 },
    });
    userWallets.issuedToken = undefined;
  }

  return NextResponse.json({ session: redactSession(userWallets) });
}
```

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/session/me/route.ts
git commit -m "Migrate /api/session/me to Auth0-keyed UserWallets"
```

---

## Task 8: Migrate all other protected API routes

**Files:** (12 routes — all share the same mechanical change)
- Modify: `src/app/api/broker/route.ts`
- Modify: `src/app/api/loan/route.ts`
- Modify: `src/app/api/loan/[id]/route.ts`
- Modify: `src/app/api/loan/default/route.ts`
- Modify: `src/app/api/loan/repay/route.ts`
- Modify: `src/app/api/session/balances/route.ts`
- Modify: `src/app/api/session/topup/route.ts`
- Modify: `src/app/api/session/transfer/route.ts`
- Modify: `src/app/api/vault/route.ts`
- Modify: `src/app/api/vault/[id]/route.ts`
- Modify: `src/app/api/vault/delete/route.ts`
- Modify: `src/app/api/vault/deposit/route.ts`
- Modify: `src/app/api/vault/history/route.ts`
- Modify: `src/app/api/vault/withdraw/route.ts`

The pattern in every file today:
```typescript
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel } from "@/lib/db";
// ...
const sessionId = await requireAuthSession();
if (!sessionId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
await connectDB();
const session = await SessionModel.findById(sessionId);
if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
```

The replacement:
```typescript
import { getUserWallets } from "@/lib/user-wallets";
// ...
const session = await getUserWallets();
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

Note: `getUserWallets()` already calls `connectDB()` internally, so callers no longer need to. And the document IS the session — no separate `findById` step.

- [ ] **Step 1: Apply the swap to each of the 14 files above**

For each file:
1. Remove the `import { requireAuthSession } from "@/lib/auth";` line.
2. Remove `connectDB` and `SessionModel` from the `@/lib/db` import (keep `VaultModel`, `LoanModel`, etc. if used).
3. Add `import { getUserWallets } from "@/lib/user-wallets";`.
4. Replace the `requireAuthSession()` + `SessionModel.findById` block with the 2-line `getUserWallets()` block above.
5. Anywhere code later writes back to the session document (e.g., `await SessionModel.findByIdAndUpdate(sessionId, {...})`), replace `SessionModel` with `UserWalletsModel` (re-import as needed) and use `session._id` (Mongo `_id` of the `UserWallets` doc — same shape).

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If errors appear:
- "Cannot find module '@/lib/auth'": you missed removing an import.
- "Property '_id' does not exist": the var name might be different in that file — search for the previous `sessionId` references.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/broker src/app/api/loan src/app/api/session/balances src/app/api/session/topup src/app/api/session/transfer src/app/api/vault
git commit -m "Migrate protected routes to getUserWallets"
```

---

## Task 9: Drop passwordHash redaction from session-public.ts

**Files:**
- Modify: `src/lib/session-public.ts`

- [ ] **Step 1: Update the redactor**

Replace `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/session-public.ts` with:

```typescript
/**
 * Strip secret fields from a UserWallets document before sending it to the
 * client. Wallet `seed` and `privateKey` are server-only — they must never
 * appear in JSON responses.
 *
 * The XRPL accounts are custodial server-side, so the client never needs
 * the seeds; signing happens in API routes.
 */

interface RawWallet {
  role: string;
  address: string;
  publicKey?: string;
  privateKey?: string;
  seed?: string;
  balance?: string;
}

interface RawUserWallets {
  _id?: unknown;
  auth0Sub?: string;
  email?: string;
  wallets?: RawWallet[];
  vaultId?: string;
  loanBrokerId?: string;
  issuedToken?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => RawUserWallets;
}

export function redactSession(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== "object") return {};
  const raw = doc as RawUserWallets;
  const obj = typeof raw.toObject === "function" ? raw.toObject() : { ...raw };

  if (Array.isArray(obj.wallets)) {
    obj.wallets = obj.wallets.map((w) => {
      const copy = { ...w };
      delete copy.seed;
      delete copy.privateKey;
      return copy;
    });
  }

  return obj as Record<string, unknown>;
}
```

The `delete obj.passwordHash` line is gone — the field no longer exists.

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/session-public.ts
git commit -m "Drop passwordHash redaction (field no longer exists)"
```

---

## Task 10: Delete the homegrown auth API endpoints

**Files:**
- Delete: `src/app/api/session/route.ts`
- Delete: `src/app/api/session/logout/route.ts`

- [ ] **Step 1: Delete the files**

```bash
rm /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app/src/app/api/session/route.ts
rm /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app/src/app/api/session/logout/route.ts
```

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If references to `/api/session` (POST) or `/api/session/logout` remain in client code, they will be fixed in Tasks 11–12.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/session
git commit -m "Remove homegrown login/logout endpoints (Auth0 owns them)"
```

---

## Task 11: Update the client session hook (remove login, federated logout)

**Files:**
- Modify: `src/hooks/use-session.ts`

- [ ] **Step 1: Replace the hook**

Replace `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/hooks/use-session.ts` with:

```typescript
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Session } from "@/types/session";

interface SessionContextValue {
  session: Session | null;
  initializing: boolean;
  /** True while /api/session/me is in flight on first authenticated load. */
  provisioning: boolean;
  error: string | null;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  initializing: true,
  provisioning: false,
  error: null,
  logout: () => {},
  refreshSession: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export function useSessionProvider(): SessionContextValue {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    // Mark provisioning if the call takes longer than 2s — first-login
    // provisioning runs the testnet faucet 4× and takes ~5–10s.
    const provisioningTimer = setTimeout(() => setProvisioning(true), 2000);
    try {
      const res = await fetch("/api/session/me");
      if (res.status === 401) {
        setSession(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
      } else {
        setError(`Failed to load session (HTTP ${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      clearTimeout(provisioningTimer);
      setProvisioning(false);
    }
  }, []);

  useEffect(() => {
    fetchSession().finally(() => setInitializing(false));
  }, [fetchSession]);

  const logout = useCallback(() => {
    // Federated logout: SDK clears the local cookie, then bounces to the
    // Auth0 logout endpoint to clear the IdP session, then back to /.
    window.location.href = "/auth/logout";
  }, []);

  const refreshSession = useCallback(async () => {
    const res = await fetch("/api/session/me");
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
    }
  }, []);

  return { session, initializing, provisioning, error, logout, refreshSession };
}
```

- [ ] **Step 2: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: TypeScript will flag callers of the removed `login` and `loading` properties — those are fixed in Task 12 (`src/app/page.tsx`).

- [ ] **Step 3: Commit (leaves the build broken pending Task 12)**

```bash
git add src/hooks/use-session.ts
git commit -m "Remove client login; logout is federated via /auth/logout"
```

**Note:** the build is now broken because `src/app/page.tsx` still references `login` and `loading` from the hook. Task 12 fixes it.

---

## Task 12: Replace the landing-page login form with Auth0 sign-in button

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace the login card with a sign-in button**

In `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/app/page.tsx`:

1. Update the imports (remove `Input`, `Label`, the form state imports):

Replace lines 1-17 with:

```typescript
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { DotPattern } from "@/components/ui/dot-pattern";
import { BorderBeam } from "@/components/ui/border-beam";
import { ArrowRight, Briefcase, PiggyBank, HandCoins } from "lucide-react";
import { Footer } from "@/components/footer";
import { motion } from "motion/react";
```

2. Replace the `Home` component's body (the existing function `Home()` starting around line 42). Replace everything from `export default function Home() {` up to and including the matching closing `}` (~ line 322) with:

```typescript
export default function Home() {
  const { initializing, session } = useSession();
  const router = useRouter();

  // Auto-redirect if already logged in
  useEffect(() => {
    if (!initializing && session) {
      router.push("/dashboard");
    }
  }, [initializing, session, router]);

  return (
    <div className="relative flex min-h-screen flex-col bg-background overflow-hidden">
      <DotPattern className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] [mask-image:radial-gradient(900px_circle_at_center,white,transparent)]" />

      {/* Top bar */}
      <header className="relative z-10 container mx-auto px-6 pt-6 max-w-5xl flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">
          XLS-66 & XLS-65 - Test App
        </span>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            Devnet
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex-grow container mx-auto px-6 py-12 sm:py-20 max-w-5xl">
        {/* Hero */}
        <div className="mb-16">
          <motion.h1
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.08] mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            Lending & Vaults on the XRP Ledger
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <TextGenerateEffect
              words="Experience the full loan lifecycle on the XRP Ledger — create vaults, pool liquidity, issue uncollateralized loans, and manage repayments."
              className="text-lg sm:text-xl text-muted-foreground font-normal leading-relaxed"
            />
            <p className="mt-3 text-sm text-muted-foreground/70">
              KYC compliance, underwriting, and contracting should happen off-chain before the loan is issued on-ledger.
            </p>
          </motion.div>
        </div>

        {/* Sign-in card + Roles */}
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Sign-in — 2 cols */}
          <motion.div
            className="lg:col-span-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-b from-primary/[0.03] to-card shadow-xl shadow-primary/10 ring-1 ring-primary/10">
              <BorderBeam size={200} duration={8} />
              <CardContent className="p-6 sm:p-8 space-y-5">
                <div>
                  <h2 className="text-lg font-semibold mb-1">Start Demo</h2>
                  <p className="text-sm text-muted-foreground">
                    Sign in with your email — four wallets will be created and funded on Devnet on first login.
                  </p>
                </div>

                <Link href="/auth/login" className="block">
                  <ShimmerButton
                    className="w-full h-11 text-sm font-semibold"
                    shimmerColor="hsl(213, 100%, 60%)"
                    shimmerSize="0.1em"
                    background="hsl(213, 100%, 40%)"
                  >
                    <span className="flex items-center gap-2 text-white">
                      Sign in / Sign up
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </ShimmerButton>
                </Link>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  By using this website, you agree that the personal information
                  you provide will be used to facilitate your use of the services
                  within this website. For more details see our{" "}
                  <a
                    href="https://ripple.com/legal/privacy-policy/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-primary transition-colors"
                  >
                    Privacy Policy
                  </a>{" "}
                  and{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-primary transition-colors"
                  >
                    Terms of Service
                  </a>
                  .
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Roles — 3 cols */}
          <div className="lg:col-span-3 flex flex-col gap-3 justify-center">
            {[
              {
                icon: Briefcase,
                title: "Loan Broker",
                description:
                  "Create single-asset vaults and issue uncollateralized loans to borrowers.",
                step: "Step 1",
              },
              {
                icon: PiggyBank,
                title: "Depositor",
                description:
                  "Deposit assets into vaults to provide liquidity and earn yield from loan interest.",
                step: "Step 2",
              },
              {
                icon: HandCoins,
                title: "Borrower",
                description:
                  "Accept loan offers and make periodic repayments with configurable terms.",
                step: "Step 3",
              },
            ].map((role, i) => (
              <motion.div
                key={role.title}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
                className="group relative rounded-xl border bg-card p-5 transition-all hover:shadow-md hover:border-primary/30"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <role.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold">{role.title}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {role.step}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {role.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check and build**

```bash
npx tsc --noEmit
```

Expected: no errors (the build should now be unbroken since the hook's old API is fully replaced).

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "Replace landing login form with Auth0 sign-in button"
```

---

## Task 13: Show provisioning splash in dashboard layout

**Files:**
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: Add a provisioning state to the layout**

In `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/app/dashboard/layout.tsx`:

1. Add `provisioning` to the destructure on line 18:

```typescript
const { session, initializing, provisioning } = useSession();
```

2. Replace the initializing branch (the `if (initializing) { return (...) }` block, lines 27-40) with:

```typescript
  if (initializing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="container mx-auto px-6 py-8 max-w-md text-center space-y-6">
          {provisioning ? (
            <>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-2">
                  Setting up your demo wallets
                </h2>
                <p className="text-sm text-muted-foreground">
                  Funding 4 wallets on Devnet — this takes about 10 seconds on first login.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <div className="grid gap-6 md:grid-cols-2">
                <Skeleton className="h-48 rounded-xl" />
                <Skeleton className="h-48 rounded-xl" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
```

3. Add `Loader2` to the lucide imports (line 14 area is in `page.tsx`, but `layout.tsx` does NOT import lucide today — add a new import at top):

```typescript
import { Loader2 } from "lucide-react";
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "Show 'Setting up wallets' splash on first login"
```

---

## Task 14: Delete the homegrown auth module and the old Session model

**Files:**
- Delete: `src/lib/auth.ts`
- Delete: `src/lib/db/models/session.ts`
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Confirm no references remain**

```bash
cd /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app
grep -rn "from \"@/lib/auth\"" src/ || echo "no references to @/lib/auth"
grep -rn "SessionModel" src/ || echo "no references to SessionModel"
```

Both should print "no references" lines. If anything remains, fix it before deleting.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/auth.ts
rm src/lib/db/models/session.ts
```

- [ ] **Step 3: Drop SessionModel from db index**

Edit `/Users/maximed/Documents/DAP xls-66/xls66-lending-app/src/lib/db/index.ts` to:

```typescript
export { connectDB } from "./connection";
export { UserWalletsModel } from "./models/user-wallets";
export { VaultModel } from "./models/vault";
export { LoanModel } from "./models/loan";
export { DepositHistoryModel } from "./models/deposit-history";
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/auth.ts src/lib/db
git commit -m "Remove homegrown auth module and old Session model"
```

---

## Task 15: Update OpenAPI spec

**Files:**
- Modify: `docs/openapi.yaml` (this is the source file served by the route)

- [ ] **Step 1: Locate the openapi.yaml file**

```bash
ls /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app/docs/openapi.yaml
```

- [ ] **Step 2: Open and edit**

Find the `POST /api/session` and `POST /api/session/logout` path entries and **delete them entirely**.

In the `info.description` field (top of file), add a note about Auth0:

```yaml
info:
  description: |
    Authentication is handled by Auth0 Universal Login. Clients obtain a
    session by visiting /auth/login (browser only) — there is no programmatic
    login endpoint. Server-to-server callers should use a Machine-to-Machine
    Auth0 Application (out of scope for the demo).
    
    [... existing description ...]
```

(Adapt the wording to fit the existing description.)

- [ ] **Step 3: Verify YAML is still valid**

```bash
npm run dev
```

Then in another terminal:
```bash
curl -s http://localhost:3000/api/openapi | head -20
```

Expected: YAML output. If the route 500s with "YAMLParseError", you broke the syntax. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add docs/openapi.yaml
git commit -m "Remove auth endpoints from OpenAPI spec, document Auth0 flow"
```

---

## Task 16: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Auth0 setup section**

In the README's setup/installation section, add a subsection describing the Auth0 dashboard config required:

```markdown
### Auth0 Setup

This demo uses Auth0 Universal Login. To run it locally you need an Auth0
tenant and a Regular Web Application.

1. Sign up at https://auth0.com and create a new tenant (the free tier is
   sufficient for demo usage).
2. **Applications → Create Application** → "Regular Web Application".
3. In the application **Settings**:
   - Allowed Callback URLs: `http://localhost:3000/auth/callback`
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`
4. **Authentication → Database → Username-Password-Authentication → Settings**:
   - Enable "Requires Verified Email"
   - Set Password Policy to "Good" or stronger
5. **Authentication → Social**: disable all social connections (email-only
   for this demo).
6. Copy the application Domain, Client ID, and Client Secret into
   `.env.local` (see `.env.example` for the variable names).
7. Generate `AUTH0_SECRET` with `openssl rand -hex 32`.
```

Remove any references to the old `/api/session` POST / register flow.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document Auth0 setup in README"
```

---

## Task 17: Manual verification

**No file changes — verification only.**

- [ ] **Step 1: Wipe demo data in MongoDB**

The user said they would do this manually. Confirm with them before proceeding. The commands are (in `mongosh`):

```javascript
use xls66-lending
db.sessions.drop()
db.vaults.drop()
db.loans.drop()
db.deposithistories.drop()
```

- [ ] **Step 2: Start the dev server**

```bash
cd /Users/maximed/Documents/DAP\ xls-66/xls66-lending-app && npm run dev
```

- [ ] **Step 3: Run through the 8 scenarios from the spec**

Open http://localhost:3000 and verify each scenario manually. Mark each as it passes:

- [ ] (1) Signup with a new email → Auth0 sends verification email → login is blocked until verified
- [ ] (2) After clicking verification link, login → dashboard shows "Setting up your demo wallets" splash → 4 wallets appear after ~10s
- [ ] (3) Refresh dashboard → wallets appear instantly (no re-provisioning)
- [ ] (4) Create a vault → deposit → withdraw — flow works as before
- [ ] (5) Click Logout → redirected to landing → going back to /dashboard forces re-login
- [ ] (6) Log in from a different browser with the same Auth0 account → same wallets returned
- [ ] (7) `curl -X POST http://localhost:3000/api/vault` (no cookie) → 401 Unauthorized
- [ ] (8) `curl -X POST -H "Origin: http://evil.example" http://localhost:3000/api/vault` → 403 Cross-origin request blocked

- [ ] **Step 4: Stop dev server and report**

Report any failures to the user. No commit on this task.

---

## Self-Review Checklist (for the plan author)

1. **Spec coverage:**
   - Three flows (signup, login, logout) → Tasks 6 (middleware) + 7 (me route) + 17 verification ✓
   - UserWallets data model → Task 3 ✓
   - getOrCreateUserWallets / getUserWallets → Task 4 ✓
   - First-login UX splash → Task 13 ✓
   - File-level changes table → Tasks 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 cover every row ✓
   - Auth0 dashboard config → Task 16 (README) ✓
   - Mongo wipe → Task 17 step 1 ✓
   - Manual test plan (8 scenarios) → Task 17 step 3 ✓
   - Out of scope items not in plan (Phase 2) ✓

2. **Placeholders:** none found.

3. **Type consistency:**
   - `getUserWallets()` defined Task 4, called Tasks 7 (no — `/api/session/me` uses `getOrCreateUserWallets`) and 8 (yes). ✓
   - `getOrCreateUserWallets()` defined Task 4, called Task 7. ✓
   - `UserWalletsModel` defined Task 3, exported Task 3, imported Task 7 (for the `findByIdAndUpdate` heal step), used in Task 4. ✓
   - `Session` type (kept name) updated Task 5; consumers (`use-session.ts` Task 11, `session-public.ts` Task 9) compatible. ✓
   - `provisioning` field added to context value in Task 11; consumed in Task 13. ✓
