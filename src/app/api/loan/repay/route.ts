import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateAssetAmount } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { buildLoanPay, getLoanInfo, LoanPayFlags } from "@/lib/xrpl/loan";
import { submitTransaction } from "@/lib/xrpl/vault";
import {
  getRoleWallet,
  buildAmountField,
  hasIssuedToken,
  computeFullPaymentAmount,
  computeLatePaymentAmount,
} from "@/lib/xrpl/helpers";
import { MPT_SCALE_MULTIPLIER } from "@/lib/constants";

type PayMode = "full" | "late" | "overpayment" | "regular";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const loanId = typeof body.loanId === "string" ? body.loanId.trim() : null;
    if (!loanId) {
      return NextResponse.json({ error: "Valid loanId is required" }, { status: 400 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const isToken = hasIssuedToken(session.issuedToken);
    const isMPT = isToken && session.issuedToken?.type === "MPT";
    const mode = body.mode as PayMode | undefined;

    // For full/late modes, derive the amount server-side using the latest
    // validated close time as the temporal reference. This removes client
    // clock drift and the risk of missing a tecINSUFFICIENT_PAYMENT threshold.
    let amount: string | null;
    if (mode === "full") {
      amount = (await computeFullPaymentAmount(loanId, isToken, isMPT)).amount;
    } else if (mode === "late") {
      amount = (await computeLatePaymentAmount(loanId, isToken, isMPT)).amount;
    } else {
      amount = validateAssetAmount(body.amountDrops, isToken);
    }
    if (!amount) {
      return NextResponse.json(
        { error: "Valid positive amount is required" },
        { status: 400 }
      );
    }

    const borrowerWallet = getRoleWallet(session, "borrower");
    const payAmount = isToken ? buildAmountField(session.issuedToken, amount) : amount;

    // Map intent → XLS-66 LoanPay flag. No flag → regular path.
    const flag =
      mode === "full"
        ? LoanPayFlags.tfLoanFullPayment
        : mode === "late"
        ? LoanPayFlags.tfLoanLatePayment
        : mode === "overpayment"
        ? LoanPayFlags.tfLoanOverpayment
        : undefined;

    const tx = buildLoanPay(borrowerWallet.classicAddress, loanId, payAmount, flag);
    const result = await submitTransaction(borrowerWallet, tx);

    try {
      const info = await getLoanInfo(loanId);
      const node = info.result?.node;
      if (node) {
        const remaining = node.PaymentRemaining ?? 0;
        const rawOutstanding = Number(node.TotalValueOutstanding ?? "0");
        const outstanding = isMPT
          ? (rawOutstanding / MPT_SCALE_MULTIPLIER).toString()
          : String(rawOutstanding);
        const status = remaining === 0 || rawOutstanding === 0 ? "repaid" : "active";
        await LoanModel.findOneAndUpdate(
          { loanId },
          { paymentsRemaining: remaining, principalOutstanding: outstanding, status }
        );
      } else {
        await LoanModel.findOneAndUpdate(
          { loanId },
          { paymentsRemaining: 0, principalOutstanding: "0", status: "repaid" }
        );
      }
    } catch {
      await LoanModel.findOneAndUpdate(
        { loanId },
        { paymentsRemaining: 0, principalOutstanding: "0", status: "repaid" }
      );
    }

    // Echo the server-computed amount so the client can display the real debit.
    return NextResponse.json({ result: result.result, amount });
  } catch (error) {
    console.error("Loan repay error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
