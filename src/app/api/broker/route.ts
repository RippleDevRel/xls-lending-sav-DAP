import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildLoanBrokerSet, buildLoanBrokerDelete, buildLoanBrokerCoverDeposit } from "@/lib/xrpl/broker";
import { validateNumber, validateDrops, validateObjectId } from "@/lib/validation";
import { submitTransaction } from "@/lib/xrpl/vault";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const vaultId = typeof body.vaultId === "string" ? body.vaultId.trim() : null;

    if (!sessionId || !vaultId) {
      return NextResponse.json(
        { error: "sessionId and vaultId are required" },
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

    // Parse and validate broker options
    const brokerOptions: Record<string, number> = {};
    if (body.brokerOptions?.managementFeeRate !== undefined) {
      const v = validateNumber(body.brokerOptions.managementFeeRate, 0, 10000);
      if (v !== null) brokerOptions.managementFeeRate = v;
    }
    if (body.brokerOptions?.debtMaximum !== undefined) {
      const v = validateNumber(body.brokerOptions.debtMaximum, 0, Number.MAX_SAFE_INTEGER);
      if (v !== null) brokerOptions.debtMaximum = v;
    }
    if (body.brokerOptions?.coverRateMinimum !== undefined) {
      const v = validateNumber(body.brokerOptions.coverRateMinimum, 0, 10000);
      if (v !== null) brokerOptions.coverRateMinimum = v;
    }
    if (body.brokerOptions?.coverRateLiquidation !== undefined) {
      const v = validateNumber(body.brokerOptions.coverRateLiquidation, 0, 10000);
      if (v !== null) brokerOptions.coverRateLiquidation = v;
    }

    const tx = buildLoanBrokerSet(brokerWallet.classicAddress, vaultId, brokerOptions);
    const result = await submitTransaction(brokerWallet, tx);

    // Extract LoanBrokerID from metadata
    const meta = result.result.meta as unknown as Record<string, unknown>;
    const affectedNodes = (meta?.AffectedNodes as Array<Record<string, unknown>>) || [];
    let loanBrokerId = "";
    for (const node of affectedNodes) {
      const created = node.CreatedNode as Record<string, unknown> | undefined;
      if (created?.LedgerEntryType === "LoanBroker") {
        loanBrokerId = created.LedgerIndex as string;
        break;
      }
    }

    if (loanBrokerId) {
      await SessionModel.findByIdAndUpdate(sessionId, { loanBrokerId });

      // Deposit first-loss capital if specified
      const coverAmount = validateDrops(body.coverAmountDrops);
      if (coverAmount) {
        const coverTx = buildLoanBrokerCoverDeposit(
          brokerWallet.classicAddress,
          loanBrokerId,
          coverAmount
        );
        await submitTransaction(brokerWallet, coverTx);
      }
    }

    return NextResponse.json({ loanBrokerId, result: result.result });
  } catch (error) {
    console.error("Broker creation error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session || !session.loanBrokerId) {
      return NextResponse.json(
        { error: "Session or broker not found" },
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
    const tx = buildLoanBrokerDelete(
      brokerWallet.classicAddress,
      session.loanBrokerId
    );
    const result = await submitTransaction(brokerWallet, tx);

    await SessionModel.findByIdAndUpdate(sessionId, {
      $unset: { loanBrokerId: 1 },
    });

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Broker deletion error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
