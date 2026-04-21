import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, VaultModel } from "@/lib/db";
import {
  buildVaultCreate,
  submitTransaction,
  getVaultInfo,
} from "@/lib/xrpl/vault";
import { setupIOU, setupMPT } from "@/lib/xrpl/issuer";
import {
  getRoleWallet,
  extractCreatedLedgerId,
  fetchVaultSnapshot,
  unscaleVaultNodeForMPT,
} from "@/lib/xrpl/helpers";
import { validateDrops, sanitizeString } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const raw = body.vaultOptions || {};

    const vaultOptions: Record<string, unknown> = {};
    if (raw.name) vaultOptions.name = sanitizeString(raw.name, 64);
    if (raw.website) vaultOptions.website = sanitizeString(raw.website, 128);
    if (raw.nonTransferableShares) vaultOptions.nonTransferableShares = true;
    if (raw.assetsMaximum) {
      const valid = validateDrops(raw.assetsMaximum);
      if (valid) vaultOptions.assetsMaximum = valid;
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const brokerWallet = getRoleWallet(session, "broker");

    const assetType = raw.asset?.type;
    let assetRecord: { currency: string; issuer?: string; mptIssuanceId?: string } = {
      currency: "XRP",
    };

    // XRP vault: make sure no prior issuedToken lingers on the session.
    if (assetType !== "IOU" && assetType !== "MPT") {
      await SessionModel.findByIdAndUpdate(sessionId, { $unset: { issuedToken: 1 } });
    }

    if (assetType === "IOU" || assetType === "MPT") {
      const issuerWallet = getRoleWallet(session, "issuer");
      const depositorWallet = getRoleWallet(session, "depositor");
      const borrowerWallet = getRoleWallet(session, "borrower");

      if (assetType === "IOU") {
        const iou = await setupIOU(issuerWallet, brokerWallet, depositorWallet, borrowerWallet);
        vaultOptions.asset = { type: "IOU", currency: iou.currency, issuer: iou.issuer };
        assetRecord = { currency: iou.currency, issuer: iou.issuer };
        await SessionModel.findByIdAndUpdate(sessionId, {
          issuedToken: { type: "IOU", currency: iou.currency, issuer: iou.issuer },
        });
      } else {
        const mpt = await setupMPT(issuerWallet, brokerWallet, depositorWallet, borrowerWallet);
        vaultOptions.asset = { type: "MPT", mptIssuanceId: mpt.mptIssuanceId };
        assetRecord = { currency: "TUSD", mptIssuanceId: mpt.mptIssuanceId };
        await SessionModel.findByIdAndUpdate(sessionId, {
          issuedToken: { type: "MPT", mptIssuanceId: mpt.mptIssuanceId },
        });
      }
    }

    if (raw.shareMetadata) {
      const sm: Record<string, string> = {};
      if (raw.shareMetadata.ticker) sm.ticker = sanitizeString(raw.shareMetadata.ticker, 6);
      if (raw.shareMetadata.name) sm.name = sanitizeString(raw.shareMetadata.name, 64);
      if (raw.shareMetadata.description) sm.description = sanitizeString(raw.shareMetadata.description, 256);
      if (raw.shareMetadata.icon) sm.icon = sanitizeString(raw.shareMetadata.icon, 128);
      if (raw.shareMetadata.issuerName) sm.issuerName = sanitizeString(raw.shareMetadata.issuerName, 64);
      if (Object.keys(sm).length > 0) vaultOptions.shareMetadata = sm;
    }

    const tx = buildVaultCreate(brokerWallet.classicAddress, vaultOptions);
    const result = await submitTransaction(brokerWallet, tx);
    const vaultId = extractCreatedLedgerId(result, "Vault");
    if (!vaultId) {
      return NextResponse.json(
        { error: "Vault created but ID not found in metadata" },
        { status: 500 }
      );
    }

    const snapshot = await fetchVaultSnapshot(vaultId);
    const vault = await VaultModel.create({
      sessionId: session._id,
      vaultId,
      ownerAddress: brokerWallet.classicAddress,
      asset: assetRecord,
      totalDeposited: snapshot?.assetsTotal || "0",
      sharesMinted: snapshot?.sharesMinted || "0",
      status: "active",
    });

    await SessionModel.findByIdAndUpdate(sessionId, { vaultId });

    return NextResponse.json({ vault, result: result.result }, { status: 201 });
  } catch (error) {
    console.error("Vault creation error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    const isMPT = session?.issuedToken?.type === "MPT";
    const vaults = await VaultModel.find({ sessionId, status: "active" });

    const enriched = await Promise.all(
      vaults.map(async (v) => {
        const doc = v.toObject();
        try {
          const info = await getVaultInfo(doc.vaultId);
          const vaultNode = info.result?.vault || null;
          unscaleVaultNodeForMPT(vaultNode, isMPT);
          doc.onLedger = vaultNode;
        } catch {
          doc.onLedger = null;
        }
        return doc;
      })
    );

    return NextResponse.json({ vaults: enriched });
  } catch (error) {
    console.error("Vault list error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
