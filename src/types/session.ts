export interface WalletInfo {
  address: string;
  publicKey: string;
  privateKey: string;
  seed: string;
  role: "broker" | "depositor" | "borrower" | "issuer";
  balance?: string;
}

export interface IssuedToken {
  type: "IOU" | "MPT";
  currency?: string;
  issuer?: string;
  mptIssuanceId?: string;
}

export interface Session {
  _id: string;
  email: string;
  wallets: WalletInfo[];
  vaultId?: string;
  loanBrokerId?: string;
  issuedToken?: IssuedToken;
  createdAt: Date;
  updatedAt: Date;
}
