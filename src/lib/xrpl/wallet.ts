import { Wallet } from "xrpl";
import { getXrplClient } from "./client";

export async function generateAndFundWallet(): Promise<{
  address: string;
  publicKey: string;
  privateKey: string;
  seed: string;
  balance: string;
}> {
  const client = await getXrplClient();
  const { wallet, balance } = await client.fundWallet();
  return {
    address: wallet.classicAddress,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    seed: wallet.seed!,
    balance: balance.toString(),
  };
}

export function walletFromSeed(seed: string): Wallet {
  return Wallet.fromSeed(seed);
}
