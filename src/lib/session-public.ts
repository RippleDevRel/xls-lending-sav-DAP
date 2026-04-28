/**
 * Strip secret fields from a session document before sending it to the
 * client. Both wallet `seed` / `privateKey` and the user's `passwordHash`
 * are server-only — they must never appear in JSON responses.
 *
 * The XRPL accounts are still custodial server-side, so the client never
 * needs the seeds; signing happens in API routes.
 */

interface RawWallet {
  role: string;
  address: string;
  publicKey?: string;
  privateKey?: string;
  seed?: string;
  balance?: string;
}

interface RawSession {
  _id?: unknown;
  email?: string;
  passwordHash?: string;
  wallets?: RawWallet[];
  vaultId?: string;
  loanBrokerId?: string;
  issuedToken?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => RawSession;
}

export function redactSession(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== "object") return {};
  const raw = doc as RawSession;
  const obj = typeof raw.toObject === "function" ? raw.toObject() : { ...raw };

  delete obj.passwordHash;

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
