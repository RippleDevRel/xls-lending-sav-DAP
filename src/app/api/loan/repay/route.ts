import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateObjectId, validateDrops } from "@/lib/validation";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildLoanPay, getLoanInfo } from "@/lib/xrpl/loan";
import { submitTransaction } from "@/lib/xrpl/vault";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const loanId = typeof body.loanId === "string" ? body.loanId.trim() : null;
    const amountDrops = validateDrops(body.amountDrops);

    if (!sessionId || !loanId || !amountDrops) {
      return NextResponse.json(
        { error: "Valid sessionId, loanId, and positive amountDrops are required" },
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

    const borrowerWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "borrower"
    );
    if (!borrowerWalletData) {
      return NextResponse.json(
        { error: "Borrower wallet not found" },
        { status: 400 }
      );
    }

    const borrowerWallet = walletFromSeed(borrowerWalletData.seed);
    const tx = buildLoanPay(
      borrowerWallet.classicAddress,
      loanId,
      amountDrops
    );
    const result = await submitTransaction(borrowerWallet, tx);

    // Verify on-chain loan state after payment
    try {
      const loanInfo = await getLoanInfo(loanId);
      const node = loanInfo.result?.node;

      if (node) {
        // Loan still exists on ledger — update DB from chain state
        const remaining = node.PaymentRemaining ?? 0;
        const outstanding = node.TotalValueOutstanding ?? "0";
        const status = remaining === 0 || Number(outstanding) === 0 ? "repaid" : "active";
        await LoanModel.findOneAndUpdate(
          { loanId },
          {
            paymentsRemaining: remaining,
            principalOutstanding: outstanding,
            status,
          }
        );
      } else {
        // Loan no longer on ledger — fully repaid and removed
        await LoanModel.findOneAndUpdate(
          { loanId },
          {
            paymentsRemaining: 0,
            principalOutstanding: "0",
            status: "repaid",
          }
        );
      }
    } catch {
      // Loan not found on ledger = fully repaid
      await LoanModel.findOneAndUpdate(
        { loanId },
        {
          paymentsRemaining: 0,
          principalOutstanding: "0",
          status: "repaid",
        }
      );
    }

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Loan repay error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
