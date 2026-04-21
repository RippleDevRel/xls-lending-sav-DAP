import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateDrops } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel, VaultModel, DepositHistoryModel } from "@/lib/db";
import { buildVaultDeposit, submitTransaction } from "@/lib/xrpl/vault";
import {
  getRoleWallet,
  buildAmountField,
  hasIssuedToken,
  fetchVaultSnapshot,
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

    let amount: string | Record<string, string>;
    let ledgerAmount: string;
    if (isToken && body.tokenAmount) {
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

    const tx = buildVaultDeposit(depositorWallet.classicAddress, vaultId, amount);
    const result = await submitTransaction(depositorWallet, tx);

    const txHash = (result.result as unknown as Record<string, unknown>).hash as string;
    await DepositHistoryModel.create({
      sessionId,
      vaultId,
      type: "deposit",
      amountDrops: ledgerAmount,
      txHash,
    });

    const snapshot = await fetchVaultSnapshot(vaultId);
    if (snapshot) {
      await VaultModel.findOneAndUpdate(
        { vaultId },
        { totalDeposited: snapshot.assetsTotal, sharesMinted: snapshot.sharesMinted }
      );
    }

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Vault deposit error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
