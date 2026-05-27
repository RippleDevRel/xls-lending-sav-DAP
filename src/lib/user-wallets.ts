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
