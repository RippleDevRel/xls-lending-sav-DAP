import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateObjectId, validateDrops, validateAmount } from "@/lib/validation";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildLoanPay, getLoanInfo } from "@/lib/xrpl/loan";
import { submitTransaction } from "@/lib/xrpl/vault";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const loanId = typeof body.loanId === "string" ? body.loanId.trim() : null;

    if (!sessionId || !loanId) {
      return NextResponse.json(
        { error: "Valid sessionId and loanId are required" },
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

    // Validate amount — use validateAmount for tokens, validateDrops for XRP
    const issuedToken = session.issuedToken;
    const isToken = !!issuedToken;
    const amount = isToken
      ? validateAmount(body.amountDrops)
      : validateDrops(body.amountDrops);

    if (!amount) {
      return NextResponse.json(
        { error: "Valid positive amount is required" },
        { status: 400 }
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

    // Build the proper Amount format for the asset type
    let payAmount: string | Record<string, string> = amount;
    if (isToken && issuedToken) {
      if (issuedToken.type === "IOU") {
        payAmount = {
          currency: issuedToken.currency,
          issuer: issuedToken.issuer,
          value: amount,
        };
      } else {
        // MPT — convert decimal to integer (AssetScale 2)
        payAmount = {
          mpt_issuance_id: issuedToken.mptIssuanceId,
          value: String(Math.round(parseFloat(amount) * 100)),
        };
      }
    }

    const tx = buildLoanPay(
      borrowerWallet.classicAddress,
      loanId,
      payAmount
    );
    const result = await submitTransaction(borrowerWallet, tx);

    // Verify on-chain loan state after payment
    try {
      const loanInfo = await getLoanInfo(loanId);
      const node = loanInfo.result?.node;

      if (node) {
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
