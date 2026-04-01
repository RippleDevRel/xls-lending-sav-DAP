export interface WalletInfo {
  address: string;
  publicKey: string;
  privateKey: string;
  seed: string;
  role: "broker" | "depositor" | "borrower";
  balance?: string;
}

export interface Session {
  _id: string;
  email: string;
  wallets: WalletInfo[];
  vaultId?: string;
  loanBrokerId?: string;
  createdAt: Date;
  updatedAt: Date;
}
