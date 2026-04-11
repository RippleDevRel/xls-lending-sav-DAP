import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, VaultModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import {
  buildVaultCreate,
  submitTransaction,
  getVaultInfo,
} from "@/lib/xrpl/vault";
import { setupIOU, setupMPT } from "@/lib/xrpl/issuer";
import {
  validateObjectId,
  validateDrops,
  sanitizeString,
} from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const raw = body.vaultOptions || {};

    // Sanitize vault options server-side
    const vaultOptions: Record<string, unknown> = {};

    if (raw.name) vaultOptions.name = sanitizeString(raw.name, 64);
    if (raw.website) vaultOptions.website = sanitizeString(raw.website, 128);
    if (raw.nonTransferableShares) vaultOptions.nonTransferableShares = true;
    if (raw.assetsMaximum) {
      const valid = validateDrops(raw.assetsMaximum);
      if (valid) vaultOptions.assetsMaximum = valid;
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const brokerWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "broker"
    );
    if (!brokerWalletData) {
      return NextResponse.json(
        { error: "Broker wallet not found" },
        { status: 400 }
      );
    }

    const brokerWallet = walletFromSeed(brokerWalletData.seed);

    // Auto-setup IOU/MPT if requested
    const assetType = raw.asset?.type;
    let assetRecord: { currency: string; issuer?: string; mptIssuanceId?: string } = { currency: "XRP" };

    if (assetType === "IOU" || assetType === "MPT") {
      const issuerWalletData = session.wallets.find(
        (w: { role: string }) => w.role === "issuer"
      );
      const depositorWalletData = session.wallets.find(
        (w: { role: string }) => w.role === "depositor"
      );
      const borrowerWalletData = session.wallets.find(
        (w: { role: string }) => w.role === "borrower"
      );

      if (!issuerWalletData || !depositorWalletData || !borrowerWalletData) {
        return NextResponse.json(
          { error: "Missing wallets for IOU/MPT setup" },
          { status: 400 }
        );
      }

      const issuerWallet = walletFromSeed(issuerWalletData.seed);
      const depositorWallet = walletFromSeed(depositorWalletData.seed);
      const borrowerWallet = walletFromSeed(borrowerWalletData.seed);

      if (assetType === "IOU") {
        const iouResult = await setupIOU(
          issuerWallet,
          brokerWallet,
          depositorWallet,
          borrowerWallet
        );
        vaultOptions.asset = {
          type: "IOU",
          currency: iouResult.currency,
          issuer: iouResult.issuer,
        };
        assetRecord = { currency: iouResult.currency, issuer: iouResult.issuer };

        // Save issued token to session
        await SessionModel.findByIdAndUpdate(sessionId, {
          issuedToken: { type: "IOU", currency: iouResult.currency, issuer: iouResult.issuer },
        });
      } else {
        const mptResult = await setupMPT(
          issuerWallet,
          brokerWallet,
          depositorWallet,
          borrowerWallet
        );
        vaultOptions.asset = {
          type: "MPT",
          mptIssuanceId: mptResult.mptIssuanceId,
        };
        assetRecord = { currency: "TUSD", mptIssuanceId: mptResult.mptIssuanceId };

        // Save issued token to session
        await SessionModel.findByIdAndUpdate(sessionId, {
          issuedToken: { type: "MPT", mptIssuanceId: mptResult.mptIssuanceId },
        });
      }
    }

    // Sanitize share metadata
    if (raw.shareMetadata) {
      const sm: Record<string, string> = {};
      if (raw.shareMetadata.ticker) sm.ticker = sanitizeString(raw.shareMetadata.ticker, 6);
      if (raw.shareMetadata.name) sm.name = sanitizeString(raw.shareMetadata.name, 64);
      if (raw.shareMetadata.description) sm.description = sanitizeString(raw.shareMetadata.description, 256);
      if (raw.shareMetadata.icon) sm.icon = sanitizeString(raw.shareMetadata.icon, 128);
      if (raw.shareMetadata.issuerName) sm.issuerName = sanitizeString(raw.shareMetadata.issuerName, 64);
      if (Object.keys(sm).length > 0) vaultOptions.shareMetadata = sm;
    }

    const tx = buildVaultCreate(brokerWallet.classicAddress, vaultOptions || {});
    const result = await submitTransaction(brokerWallet, tx);

    // Extract vault ID from transaction metadata
    const meta = result.result.meta as unknown as Record<string, unknown>;
    const affectedNodes =
      (meta?.AffectedNodes as Array<Record<string, unknown>>) || [];
    let vaultId = "";
    for (const node of affectedNodes) {
      const created = node.CreatedNode as Record<string, unknown> | undefined;
      if (created?.LedgerEntryType === "Vault") {
        vaultId = created.LedgerIndex as string;
        break;
      }
    }

    if (!vaultId) {
      return NextResponse.json(
        { error: "Vault created but ID not found in metadata" },
        { status: 500 }
      );
    }

    // Fetch initial on-chain state
    let totalDeposited = "0";
    let sharesMinted = "0";
    try {
      const vaultInfo = await getVaultInfo(vaultId);
      const vault = vaultInfo.result?.vault;
      if (vault) {
        totalDeposited = vault.AssetsTotal || "0";
        sharesMinted = vault.shares?.OutstandingAmount || "0";
      }
    } catch {
      // New vault, defaults are fine
    }

    const vault = await VaultModel.create({
      sessionId: session._id,
      vaultId,
      ownerAddress: brokerWallet.classicAddress,
      asset: assetRecord,
      totalDeposited,
      sharesMinted,
      status: "active",
    });

    await SessionModel.findByIdAndUpdate(sessionId, { vaultId });

    return NextResponse.json({ vault, result: result.result }, { status: 201 });
  } catch (error) {
    console.error("Vault creation error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    await connectDB();
    const vaults = await VaultModel.find({ sessionId, status: "active" });

    // Enrich each vault with on-chain data
    const enriched = await Promise.all(
      vaults.map(async (v) => {
        const doc = v.toObject();
        try {
          const info = await getVaultInfo(doc.vaultId);
          doc.onLedger = info.result?.vault || null;
        } catch {
          doc.onLedger = null;
        }
        return doc;
      })
    );

    return NextResponse.json({ vaults: enriched });
  } catch (error) {
    console.error("Vault list error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
