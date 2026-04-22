import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateDrops } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel, VaultModel, DepositHistoryModel } from "@/lib/db";
import { buildVaultWithdraw, submitTransaction, getVaultInfo } from "@/lib/xrpl/vault";
import {
  getRoleWallet,
  buildAmountField,
  hasIssuedToken,
  fetchVaultSnapshot,
  getXrplClient,
} from "@/lib/xrpl/helpers";
import { MPT_SCALE_MULTIPLIER } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const vaultId = typeof body.vaultId === "string" ? body.vaultId.trim() : null;
    if (!vaultId) {
      return NextResponse.json({ error: "vaultId is required" }, { status: 400 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const depositorWallet = getRoleWallet(session, "depositor");
    const issuedToken = session.issuedToken;
    const isToken = hasIssuedToken(issuedToken);

    // "Redeem all" (XLS-65 §3.2.2): Amount may be denominated in the vault's
    // SHARE MPT rather than the vault's asset. We read the depositor's exact
    // share holding from account_objects and pass it through as-is — no
    // client-side math, so no precision drift that would trip the ledger's
    // invariant checker.
    const redeemAll = body.redeemAll === true;

    let amount: string | Record<string, string>;
    let ledgerAmount: string;
    // Captured when redeemAll: assetsTotal on-ledger before the withdraw,
    // used to derive the delivered asset amount for DepositHistory.
    let preAssetsTotal: number | null = null;
    if (redeemAll) {
      const vaultInfo = await getVaultInfo(vaultId);
      const vaultNode = vaultInfo.result?.vault;
      const shareMPTID = vaultNode?.ShareMPTID as string | undefined;
      if (!shareMPTID) {
        return NextResponse.json(
          { error: "Vault has no share MPT ID on ledger" },
          { status: 500 }
        );
      }
      preAssetsTotal = Number(vaultNode?.AssetsTotal ?? "0");
      const client = await getXrplClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objs = await (client as any).request({
        command: "account_objects",
        account: depositorWallet.classicAddress,
        type: "mptoken",
        ledger_index: "validated",
      });
      const shareHolding = objs.result?.account_objects?.find(
        (o: { MPTokenIssuanceID?: string }) => o.MPTokenIssuanceID === shareMPTID
      );
      const shareBalance = String(shareHolding?.MPTAmount ?? "0");
      if (shareBalance === "0") {
        return NextResponse.json(
          { error: "No shares held in this vault" },
          { status: 400 }
        );
      }
      amount = { mpt_issuance_id: shareMPTID, value: shareBalance };
      // `ledgerAmount` is a provisional value; overwritten below with the
      // actual asset delivered (pre - post AssetsTotal) after the tx lands.
      ledgerAmount = "0";
    } else if (isToken && body.tokenAmount) {
      amount = buildAmountField(issuedToken, body.tokenAmount);
      ledgerAmount =
        issuedToken.type === "IOU"
          ? body.tokenAmount
          : String(Math.round(parseFloat(body.tokenAmount) * MPT_SCALE_MULTIPLIER));
    } else {
      const drops = validateDrops(body.amountDrops);
      if (!drops) {
        return NextResponse.json(
          { error: "Valid positive amount is required" },
          { status: 400 }
        );
      }
      amount = drops;
      ledgerAmount = drops;
    }

    const tx = buildVaultWithdraw(depositorWallet.classicAddress, vaultId, amount);
    const result = await submitTransaction(depositorWallet, tx);

    const snapshot = await fetchVaultSnapshot(vaultId);

    // For redeemAll, convert the share-denominated tx into an asset-denominated
    // history entry so the PNL view shows a coherent number. Falls back to
    // "0" if snapshot failed or the vault was emptied and removed.
    if (redeemAll && preAssetsTotal !== null) {
      const postAssetsTotal = snapshot ? Number(snapshot.assetsTotal) : 0;
      ledgerAmount = String(Math.max(0, preAssetsTotal - postAssetsTotal));
    }

    const txHash = (result.result as unknown as Record<string, unknown>).hash as string;
    await DepositHistoryModel.create({
      sessionId,
      vaultId,
      type: "withdraw",
      amountDrops: ledgerAmount,
      txHash,
    });

    if (snapshot) {
      await VaultModel.findOneAndUpdate(
        { vaultId },
        { totalDeposited: snapshot.assetsTotal, sharesMinted: snapshot.sharesMinted }
      );
    }

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Vault withdraw error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
