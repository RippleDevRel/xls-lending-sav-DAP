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
 * Shape of the session as the client receives it. `wallets` excludes
 * `seed` / `privateKey`, and `passwordHash` is omitted entirely. See
 * `lib/session-public.ts:redactSession`.
 */
export interface Session {
  _id: string;
  email: string;
  wallets: PublicWallet[];
  vaultId?: string;
  loanBrokerId?: string;
  issuedToken?: IssuedToken;
  createdAt: Date;
  updatedAt: Date;
}
