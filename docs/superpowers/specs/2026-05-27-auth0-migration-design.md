# Auth0 Migration Design

**Date:** 2026-05-27
**Status:** Draft — awaiting user review
**Author:** brainstorm session with maximed@ripple.com

## Context

The XLS-66 lending demo currently runs a homegrown auth system: scrypt-hashed
passwords stored in MongoDB, session identified by an httpOnly cookie holding
the Mongo `Session._id`. A security review flagged this as inadequate and
recommended replacing it with Auth0.

This spec describes how the homegrown auth is replaced by Auth0 (Universal
Login, email/password only), while keeping the XRPL wallet provisioning and
the rest of the app behavior unchanged.

## Decisions taken in brainstorming

- **Auth strategy:** Auth0 Universal Login via `@auth0/nextjs-auth0` v4 SDK
  (App Router compatible). Custom embedded login and Auth.js wrapper were
  considered and rejected.
- **Auth methods:** Email + password only. No social providers in v1.
- **Email verification:** Required. Users cannot complete login until they
  click the verification link Auth0 sends at signup.
- **Sign-ups:** Open to anyone.
- **Logout:** Federated — clears the local app session and the Auth0 session.
- **Existing users:** Wiped. No migration of password hashes.
- **Wallet provisioning:** Lazy — the 4 XRPL testnet wallets are generated
  on the first authenticated `/api/session/me` call after signup.
- **Auth0 free tier:** Sufficient (25k MAU on current tier, demo usage is
  far below).

## Architecture

### Three user-facing flows

**Signup:**
```
/ → /auth/login (signup tab) → Auth0 Universal Login → email verification
  → user clicks link → /auth/callback → SDK sets session cookie → /dashboard
  → GET /api/session/me detects no UserWallets doc → provisions 4 wallets
  → returns wallets (≈5–10s first time)
```

**Returning login:**
```
/ → /auth/login → Auth0 Universal Login → /auth/callback
  → /dashboard → GET /api/session/me finds existing UserWallets → instant
```

**Federated logout:**
```
"Logout" button → /auth/logout (SDK) → clears local cookie
  → redirect to Auth0 /v2/logout → Auth0 clears its session
  → redirect back to /
```

### Server-side chokepoint

Today, every protected route calls `requireAuthSession()` from `src/lib/auth.ts`
to resolve the cookie to a Mongo `_id`. That function is replaced by two helpers
in `src/lib/user-wallets.ts`:

- `getOrCreateUserWallets()` — used **only** by `/api/session/me`. Reads the
  Auth0 `sub` from the SDK, looks up `UserWallets` by `auth0Sub`, and if absent
  provisions the 4 testnet wallets and inserts the doc. Handles the
  first-login race with a duplicate-key catch.
- `getUserWallets()` — used by every other protected route. Lookup only; if
  the doc does not exist, return null → caller responds 401.

Routes other than `/api/session/me` keep the same business logic; only the
auth chokepoint line changes (`requireAuthSession()` → `getUserWallets()`).

### Middleware

The existing `src/middleware.ts` is replaced by a chain:

1. **Auth0 SDK middleware** — handles `/auth/*` routes (login, logout,
   callback, profile) and refreshes the session cookie.
2. **Existing CSRF check** — same-origin enforcement for unsafe methods.
   Kept as-is, runs after the Auth0 middleware so OAuth callbacks are not
   blocked (Auth0 uses PKCE+state on its own routes).

The `PUBLIC_PATHS` allowlist drops `/api/session` and `/api/session/logout`
(both being removed) and the `/auth/*` namespace is implicitly public via the
SDK middleware.

## Data model

### New `UserWallets` collection

```
auth0Sub: string         // unique index — primary logical key, e.g. "auth0|abc123"
email: string            // denormalized from Auth0 for debugging/admin
wallets: [Wallet]        // 4 wallets: broker, depositor, borrower, issuer
vaultId?: string         // (unchanged from current Session schema)
loanBrokerId?: string    // (unchanged)
issuedToken?: {...}      // (unchanged)
createdAt, updatedAt
```

The wallet sub-schema is unchanged: `address`, `publicKey`, `privateKey`,
`seed`, `role`, `balance`. **Seeds remain in plaintext in Mongo** — see Out
of Scope below.

### Indexes

- `auth0Sub`: `unique: true` — protects against the first-login double-write
  race.
- `email`: none. Auth0 owns email-based lookup; the app never queries by
  email.

### Differences vs. current `Session`

| Field          | Before                 | After                          |
|----------------|------------------------|--------------------------------|
| Primary key    | `_id` (in the cookie)  | `auth0Sub` (never in cookie)   |
| `email`        | unique, required       | non-unique, informational      |
| `passwordHash` | required               | removed                        |
| Wallet shape   | unchanged              | unchanged                      |

## Provisioning logic

```typescript
// src/lib/user-wallets.ts (sketch)

export async function getOrCreateUserWallets() {
  const auth0Session = await auth0.getSession();
  if (!auth0Session?.user) return null;
  const { sub, email } = auth0Session.user;

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
      return await UserWalletsModel.findOne({ auth0Sub: sub });
    }
    throw err;
  }
}

export async function getUserWallets() {
  const auth0Session = await auth0.getSession();
  if (!auth0Session?.user) return null;
  await connectDB();
  return await UserWalletsModel.findOne({ auth0Sub: auth0Session.user.sub });
}
```

### First-login UX

`generateAndFundWallet()` × 4 takes ~5–10s on testnet. The dashboard surfaces
this with a splash state:

- `useSession().initializing === true` → "Loading…" (existing behavior)
- `initializing === false && session === null` → unexpected, send to landing
- `initializing === false && session.wallets.length === 0` → "Setting up
  your demo wallets…" (new state, ~10s)
- Wallets present → normal dashboard

## File-level changes

### New files

| Path | Purpose |
|---|---|
| `src/lib/auth0.ts` | SDK client singleton |
| `src/app/auth/[auth0]/route.ts` | SDK catch-all route handler |
| `src/lib/user-wallets.ts` | `getOrCreateUserWallets`, `getUserWallets` |
| `src/lib/db/models/user-wallets.ts` | Mongoose model (replaces `session.ts`) |

### Modified files

| Path | Change |
|---|---|
| `src/middleware.ts` | Chain Auth0 SDK middleware with existing CSRF logic |
| `src/lib/db/index.ts` | Export `UserWalletsModel` |
| `src/lib/session-public.ts` | Drop `passwordHash` redaction |
| `src/types/session.ts` | Rename `Session` → `UserWallets`, add `auth0Sub` |
| `src/hooks/use-session.ts` | Remove `login()`. `logout()` → `window.location = "/auth/logout"` |
| `src/components/session-provider.tsx` | Type updates only |
| `src/app/page.tsx` | Replace login form with `<Link href="/auth/login">` button |
| `src/app/dashboard/layout.tsx` | Use Auth0 server helper for redirect guard |
| `src/app/dashboard/page.tsx` | Add "Setting up wallets…" splash state |
| `src/app/api/session/me/route.ts` | Call `getOrCreateUserWallets()` |
| ~12 other API routes (`vault/*`, `loan/*`, `broker`, `session/balances`, `session/topup`, `session/transfer`) | Swap `requireAuthSession()` for `getUserWallets()` |
| `src/app/api/openapi/route.ts` | Drop removed endpoints, note Auth0 in description |
| `.env.example`, `.env.local` | Add `AUTH0_*` vars |
| `package.json` | + `@auth0/nextjs-auth0` |
| `README.md` | Setup steps for Auth0 dashboard + env vars |

### Deleted files

| Path | Reason |
|---|---|
| `src/lib/auth.ts` | Homegrown auth replaced |
| `src/app/api/session/route.ts` | POST register/login → Auth0 owns it |
| `src/app/api/session/logout/route.ts` | → `/auth/logout` from SDK |
| `src/lib/db/models/session.ts` | Replaced by `user-wallets.ts` |

## Auth0 dashboard configuration

One-time setup in the Auth0 portal:

**Application:**
- Type: Regular Web Application
- Token Endpoint Auth Method: Post
- Callback URL: `http://localhost:3000/auth/callback`
- Logout URL: `http://localhost:3000`
- Web Origins: `http://localhost:3000`

**Database connection (Username-Password-Authentication):**
- Enabled
- Disable Sign Ups: OFF (open sign-ups)
- Requires Username: OFF
- Password policy: Good or higher
- **Requires Verified Email: ON**

**Connections:**
- Disable all social providers.

**Email templates:**
- Customize "Verification Email" subject + sender to mention "XLS-66 Lending
  Demo" rather than Auth0. Cosmetic.

**Universal Login branding:**
- Set logo + primary color to match the app theme. Full custom HTML is out
  of scope for v1.

### Environment variables

```
AUTH0_SECRET=<openssl rand -hex 32>
AUTH0_DOMAIN=<tenant>.eu.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
APP_BASE_URL=http://localhost:3000
```

## Migration / wipe

Existing Mongo data is incompatible: the user collection key changes from
`ObjectId _id` to `auth0Sub`, and downstream collections reference the old
key. The user will manually drop the relevant collections in `mongosh`:

```
db.sessions.drop()
db.vaults.drop()
db.loans.drop()
db.deposithistories.drop()
```

No automated script — single one-off operation.

## Manual test plan

| # | Scenario | Expected |
|---|---|---|
| 1 | Signup with new email | Verification email sent; login blocked until verified |
| 2 | Login after verification | Redirect to dashboard, "Setting up wallets…" splash, 4 wallets visible after ~10s |
| 3 | Refresh dashboard | Wallets shown instantly, no re-provisioning |
| 4 | Vault create → deposit → withdraw | Flow functionally unchanged |
| 5 | Logout | Redirect to landing, cookie cleared, `/dashboard` forces re-login |
| 6 | Login from a different browser | Same wallets returned (via `auth0Sub`) |
| 7 | POST to any `/api/vault/*` without cookie | 401 |
| 8 | Cross-origin POST | 403 (existing CSRF middleware still active) |

No automated tests — consistent with the existing repo.

## Out of scope (Phase 2)

- **At-rest encryption of XRPL `seed` and `privateKey` in Mongo.** Currently
  stored plaintext. Auth0 does not address this; flagged in brainstorming
  for a follow-up spec.
- **MFA via Auth0.** One toggle, defer.
- **Custom HTML for Universal Login.** Cosmetic, defer.
- **Migration of existing demo accounts.** Wipe was the chosen path.
