import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildLoanDelete, buildLoanManage, LOAN_MANAGE_FLAGS } from "@/lib/xrpl/loan";
import { submitTransaction } from "@/lib/xrpl/vault";
import { validateObjectId } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const loanId = typeof body.loanId === "string" ? body.loanId.trim() : null;
    const action = body.action || "default"; // "default" | "close"

    if (!sessionId || !loanId) {
      return NextResponse.json(
        { error: "sessionId and loanId are required" },
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

    if (action === "close") {
      // LoanDelete — only works on fully repaid loans
      const tx = buildLoanDelete(brokerWallet.classicAddress, loanId);
      const result = await submitTransaction(brokerWallet, tx);

      await LoanModel.findOneAndUpdate({ loanId }, { status: "closed" });
      return NextResponse.json({ result: result.result });
    }

    // LoanManage with tfLoanDefault — defaults an unpaid loan after grace period
    const tx = buildLoanManage(
      brokerWallet.classicAddress,
      loanId,
      LOAN_MANAGE_FLAGS.tfLoanDefault
    );
    const result = await submitTransaction(brokerWallet, tx);

    await LoanModel.findOneAndUpdate({ loanId }, { status: "defaulted" });
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Loan manage error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
