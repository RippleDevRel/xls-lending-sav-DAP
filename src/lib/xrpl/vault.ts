import { Wallet } from "xrpl";
import { getXrplClient } from "./client";

// XLS-65 types are not yet in xrpl.js TypeScript definitions,
// but the binary codec supports them at runtime.

export interface VaultAsset {
  type: "XRP" | "IOU" | "MPT";
  currency?: string; // for IOU, e.g. "USD"
  issuer?: string; // for IOU
  mptIssuanceId?: string; // for MPT
}

export interface VaultCreateOptions {
  asset?: VaultAsset;
  name?: string;
  website?: string;
  assetsMaximum?: string;
  nonTransferableShares?: boolean;
  shareMetadata?: {
    ticker?: string;
    name?: string;
    description?: string;
    icon?: string;
    issuerName?: string;
  };
}

export function buildVaultCreate(
  ownerAddress: string,
  options: VaultCreateOptions = {}
) {
  // Build asset field based on type
  let asset: Record<string, string>;
  const assetConfig = options.asset;
  if (assetConfig?.type === "IOU" && assetConfig.currency && assetConfig.issuer) {
    asset = { currency: assetConfig.currency, issuer: assetConfig.issuer };
  } else if (assetConfig?.type === "MPT" && assetConfig.mptIssuanceId) {
    asset = { mpt_issuance_id: assetConfig.mptIssuanceId };
  } else {
    asset = { currency: "XRP" };
  }

  const tx: Record<string, unknown> = {
    TransactionType: "VaultCreate",
    Account: ownerAddress,
    Asset: asset,
    Flags: options.nonTransferableShares ? 2 : 0, // tfVaultShareNonTransferable = 0x00000002
    WithdrawalPolicy: 1,
  };

  // Vault metadata (name, website) encoded as hex JSON
  if (options.name || options.website) {
    const data: Record<string, string> = {};
    if (options.name) data.n = options.name;
    if (options.website) data.w = options.website;
    tx.Data = Buffer.from(JSON.stringify(data)).toString("hex").toUpperCase();
  }

  // Max deposit cap
  if (options.assetsMaximum) {
    tx.AssetsMaximum = options.assetsMaximum;
  }

  // MPToken metadata for vault shares — XLS-89 compressed keys
  // Required: t (ticker), n (name), i (icon), ac (asset_class), in (issuer_name)
  // Optional: d (desc), as (asset_subclass), us (uris), ai (additional_info)
  if (options.shareMetadata) {
    const meta = options.shareMetadata;
    const mptMeta: Record<string, unknown> = {};
    if (meta.ticker) mptMeta.t = meta.ticker.toUpperCase();
    if (meta.name) mptMeta.n = meta.name;
    if (meta.description) mptMeta.d = meta.description;
    if (meta.icon) mptMeta.i = meta.icon;
    mptMeta.ac = "defi";
    mptMeta.in = meta.issuerName || "Vault Owner";
    tx.MPTokenMetadata = Buffer.from(JSON.stringify(mptMeta)).toString("hex").toUpperCase();
  }

  return tx;
}

export function buildVaultDeposit(
  depositorAddress: string,
  vaultId: string,
  amountDrops: string
) {
  return {
    TransactionType: "VaultDeposit",
    Account: depositorAddress,
    VaultID: vaultId,
    Amount: amountDrops,
  };
}

export function buildVaultWithdraw(
  address: string,
  vaultId: string,
  amountDrops: string
) {
  return {
    TransactionType: "VaultWithdraw",
    Account: address,
    VaultID: vaultId,
    Amount: amountDrops,
  };
}

export function buildVaultDelete(ownerAddress: string, vaultId: string) {
  return {
    TransactionType: "VaultDelete",
    Account: ownerAddress,
    VaultID: vaultId,
  };
}

export async function submitTransaction(
  wallet: Wallet,
  tx: Record<string, unknown>
) {
  const client = await getXrplClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  // Verify the transaction actually succeeded on-chain
  const meta = result.result.meta as unknown as Record<string, unknown>;
  const engineResult =
    (meta?.TransactionResult as string) ||
    (result.result as unknown as Record<string, unknown>).engine_result as string ||
    "";

  if (engineResult && engineResult !== "tesSUCCESS") {
    const txType = tx.TransactionType || "Transaction";
    const hash = (result.result as unknown as Record<string, unknown>).hash || "";
    throw new Error(
      `${txType} failed: ${engineResult} (tx: ${hash})`
    );
  }

  return result;
}

export async function getVaultInfo(vaultId: string) {
  const client = await getXrplClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).request({
    command: "vault_info",
    vault_id: vaultId,
  });
  return result;
}
