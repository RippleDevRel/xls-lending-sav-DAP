import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel } from "@/lib/db";
import {
  buildLoanBrokerSet,
  buildLoanBrokerDelete,
  buildLoanBrokerCoverDeposit,
} from "@/lib/xrpl/broker";
import { submitTransaction } from "@/lib/xrpl/vault";
import {
  getRoleWallet,
  extractCreatedLedgerId,
  buildAmountField,
  hasIssuedToken,
} from "@/lib/xrpl/helpers";
import { validateNumber, validateAssetAmount } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";

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

    const brokerWallet = getRoleWallet(session, "broker");

    // XLS-66 rate fields are UINT16/UINT32 in 1/10 bps. Spec caps below.
    const brokerOptions: Record<string, number> = {};
    const opts = body.brokerOptions || {};
    const assign = (key: string, max: number) => {
      if (opts[key] === undefined) return;
      const v = validateNumber(opts[key], 0, max);
      if (v !== null) brokerOptions[key] = v;
    };
    assign("managementFeeRate", 10_000);
    assign("debtMaximum", Number.MAX_SAFE_INTEGER);
    assign("coverRateMinimum", 100_000);
    assign("coverRateLiquidation", 100_000);

    const tx = buildLoanBrokerSet(brokerWallet.classicAddress, vaultId, brokerOptions);
    const result = await submitTransaction(brokerWallet, tx);
    const loanBrokerId = extractCreatedLedgerId(result, "LoanBroker");

    if (loanBrokerId) {
      await SessionModel.findByIdAndUpdate(sessionId, { loanBrokerId });

      // First-loss cover must be denominated in the vault's asset, otherwise
      // the ledger returns tecWRONG_ASSET.
      const isToken = hasIssuedToken(session.issuedToken);
      const coverRaw = validateAssetAmount(body.coverAmountDrops, isToken);
      if (coverRaw) {
        const coverAmount = isToken
          ? buildAmountField(session.issuedToken, coverRaw)
          : coverRaw;
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
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session || !session.loanBrokerId) {
      return NextResponse.json({ error: "Session or broker not found" }, { status: 404 });
    }

    const brokerWallet = getRoleWallet(session, "broker");
    const tx = buildLoanBrokerDelete(brokerWallet.classicAddress, session.loanBrokerId);
    const result = await submitTransaction(brokerWallet, tx);

    await SessionModel.findByIdAndUpdate(sessionId, {
      $unset: { loanBrokerId: 1 },
    });

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Broker deletion error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
