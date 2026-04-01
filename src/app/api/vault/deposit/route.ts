import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateObjectId, validateDrops } from "@/lib/validation";
import { connectDB, SessionModel, VaultModel, DepositHistoryModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import {
  buildVaultDeposit,
  submitTransaction,
  getVaultInfo,
} from "@/lib/xrpl/vault";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const vaultId = typeof body.vaultId === "string" ? body.vaultId.trim() : null;
    const amountDrops = validateDrops(body.amountDrops);

    if (!sessionId || !vaultId || !amountDrops) {
      return NextResponse.json(
        { error: "Valid sessionId, vaultId, and positive amountDrops are required" },
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

    const depositorWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "depositor"
    );
    if (!depositorWalletData) {
      return NextResponse.json(
        { error: "Depositor wallet not found" },
        { status: 400 }
      );
    }

    const depositorWallet = walletFromSeed(depositorWalletData.seed);
    const tx = buildVaultDeposit(
      depositorWallet.classicAddress,
      vaultId,
      amountDrops
    );
    const result = await submitTransaction(depositorWallet, tx);

    // Log deposit
    const txHash = (result.result as unknown as Record<string, unknown>).hash as string;
    await DepositHistoryModel.create({
      sessionId,
      vaultId,
      type: "deposit",
      amountDrops,
      txHash,
    });

    // Sync vault state from on-chain after deposit
    try {
      const vaultInfo = await getVaultInfo(vaultId);
      const vault = vaultInfo.result?.vault;
      if (vault) {
        await VaultModel.findOneAndUpdate(
          { vaultId },
          {
            totalDeposited: vault.AssetsTotal || "0",
            sharesMinted: vault.shares?.OutstandingAmount || "0",
          }
        );
      }
    } catch {
      // vault_info failed — leave DB as-is
    }

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Vault deposit error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
