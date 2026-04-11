import { Wallet } from "xrpl";
import { getXrplClient } from "./client";
import { submitTransaction } from "./vault";

const TUSD_DISTRIBUTION_AMOUNT = "10000"; // 10,000 TUSD to depositor

/**
 * Setup IOU token: create trustlines for all 3 wallets, send TUSD to depositor.
 * Returns { currency, issuer } for use in VaultCreate.
 */
export async function setupIOU(
  issuerWallet: Wallet,
  brokerWallet: Wallet,
  depositorWallet: Wallet,
  borrowerWallet: Wallet
): Promise<{ currency: string; issuer: string }> {
  const currency = "USD";
  const issuerAddress = issuerWallet.classicAddress;
  const limit = "1000000"; // 1M trust limit

  // Step 0: Enable DefaultRipple on issuer (required for IOU vaults)
  await submitTransaction(issuerWallet, {
    TransactionType: "AccountSet",
    Account: issuerAddress,
    SetFlag: 8, // asfDefaultRipple
  });

  // Step 1: TrustSet for all 3 wallets (parallel)
  await Promise.all([
    submitTransaction(brokerWallet, {
      TransactionType: "TrustSet",
      Account: brokerWallet.classicAddress,
      LimitAmount: { currency, issuer: issuerAddress, value: limit },
    }),
    submitTransaction(depositorWallet, {
      TransactionType: "TrustSet",
      Account: depositorWallet.classicAddress,
      LimitAmount: { currency, issuer: issuerAddress, value: limit },
    }),
    submitTransaction(borrowerWallet, {
      TransactionType: "TrustSet",
      Account: borrowerWallet.classicAddress,
      LimitAmount: { currency, issuer: issuerAddress, value: limit },
    }),
  ]);

  // Step 2: Send TUSD to depositor
  await submitTransaction(issuerWallet, {
    TransactionType: "Payment",
    Account: issuerAddress,
    Destination: depositorWallet.classicAddress,
    Amount: { currency, issuer: issuerAddress, value: TUSD_DISTRIBUTION_AMOUNT },
  });

  return { currency, issuer: issuerAddress };
}

/**
 * Setup MPT token: create issuance, authorize all 3 wallets, send TUSD to depositor.
 * Returns { mptIssuanceId } for use in VaultCreate.
 */
export async function setupMPT(
  issuerWallet: Wallet,
  brokerWallet: Wallet,
  depositorWallet: Wallet,
  borrowerWallet: Wallet
): Promise<{ mptIssuanceId: string }> {
  const issuerAddress = issuerWallet.classicAddress;

  // Step 1: Create MPT issuance
  const metadata = { t: "TUSD", n: "Test USD", d: "Test stablecoin for demo", ac: "stablecoin" };
  const metadataHex = Buffer.from(JSON.stringify(metadata)).toString("hex").toUpperCase();

  const createResult = await submitTransaction(issuerWallet, {
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuerAddress,
    AssetScale: 2,
    MaximumAmount: "100000000000", // 1 billion units (with scale 2 = 10B tokens)
    Flags: 32, // tfMPTCanTransfer
    MPTokenMetadata: metadataHex,
  });

  // Extract MPT issuance ID from metadata
  const meta = createResult.result.meta as unknown as Record<string, unknown>;
  const affectedNodes = (meta?.AffectedNodes as Array<Record<string, unknown>>) || [];
  let mptIssuanceId = "";
  for (const node of affectedNodes) {
    const created = node.CreatedNode as Record<string, unknown> | undefined;
    if (created?.LedgerEntryType === "MPTokenIssuance") {
      mptIssuanceId = created.LedgerIndex as string;
      break;
    }
  }

  if (!mptIssuanceId) {
    throw new Error("MPTokenIssuanceCreate succeeded but issuance ID not found in metadata");
  }

  // Step 2: MPTokenAuthorize for all 3 wallets (parallel)
  await Promise.all([
    submitTransaction(brokerWallet, {
      TransactionType: "MPTokenAuthorize",
      Account: brokerWallet.classicAddress,
      MPTokenIssuanceID: mptIssuanceId,
    }),
    submitTransaction(depositorWallet, {
      TransactionType: "MPTokenAuthorize",
      Account: depositorWallet.classicAddress,
      MPTokenIssuanceID: mptIssuanceId,
    }),
    submitTransaction(borrowerWallet, {
      TransactionType: "MPTokenAuthorize",
      Account: borrowerWallet.classicAddress,
      MPTokenIssuanceID: mptIssuanceId,
    }),
  ]);

  // Step 3: Send TUSD to depositor (10,000 TUSD = 1,000,000 with AssetScale 2)
  const client = await getXrplClient();
  const paymentTx = {
    TransactionType: "Payment",
    Account: issuerAddress,
    Destination: depositorWallet.classicAddress,
    Amount: { mpt_issuance_id: mptIssuanceId, value: "1000000" },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(paymentTx as any);
  const signed = issuerWallet.sign(prepared);
  await client.submitAndWait(signed.tx_blob);

  return { mptIssuanceId };
}
