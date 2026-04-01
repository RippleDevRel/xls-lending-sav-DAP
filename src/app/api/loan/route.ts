import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateObjectId, validateDrops, validateNumber } from "@/lib/validation";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildLoanSet, signAndSubmitLoanSet } from "@/lib/xrpl/loan";
import {
  DEFAULT_INTEREST_RATE,
  DEFAULT_PAYMENT_TOTAL,
  DEFAULT_PAYMENT_INTERVAL,
  DEFAULT_GRACE_PERIOD,
  DEFAULT_ORIGINATION_FEE,
  DEFAULT_SERVICE_FEE,
} from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);

    if (!sessionId) {
      return NextResponse.json(
        { error: "Valid sessionId is required" },
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
    const borrowerWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "borrower"
    );
    if (!brokerWalletData || !borrowerWalletData) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 400 }
      );
    }

    const brokerWallet = walletFromSeed(brokerWalletData.seed);
    const borrowerWallet = walletFromSeed(borrowerWalletData.seed);

    const principalRequested = validateDrops(body.principalRequested) || "20000000";
    const interestRate = validateNumber(body.interestRate, 0, 50000) ?? DEFAULT_INTEREST_RATE;
    const paymentTotal = validateNumber(body.paymentTotal, 1, 120) ?? DEFAULT_PAYMENT_TOTAL;
    const paymentInterval = validateNumber(body.paymentInterval, 60, 31536000) ?? DEFAULT_PAYMENT_INTERVAL;
    const gracePeriod = validateNumber(body.gracePeriod, 1, 31536000) ?? DEFAULT_GRACE_PERIOD;
    const originationFee = validateDrops(body.originationFee) || DEFAULT_ORIGINATION_FEE;
    const serviceFee = validateDrops(body.serviceFee) || DEFAULT_SERVICE_FEE;

    // Optional advanced fields — only include if > 0 (ledger rejects 0 values)
    const latePaymentFee = validateDrops(body.latePaymentFee) || undefined;
    const closePaymentFee = validateDrops(body.closePaymentFee) || undefined;
    const overpaymentFee = validateNumber(body.overpaymentFee, 1, 100000) ?? undefined;
    const lateInterestRate = validateNumber(body.lateInterestRate, 1, 100000) ?? undefined;
    const closeInterestRate = validateNumber(body.closeInterestRate, 1, 100000) ?? undefined;
    const overpaymentInterestRate = validateNumber(body.overpaymentInterestRate, 1, 100000) ?? undefined;

    // Loan metadata
    let loanData: string | undefined;
    if (body.loanName && typeof body.loanName === "string") {
      const name = body.loanName.trim().slice(0, 64).replace(/[\x00-\x1F\x7F]/g, "");
      if (name) loanData = Buffer.from(JSON.stringify({ n: name })).toString("hex").toUpperCase();
    }

    const loanSetTx = buildLoanSet({
      brokerAddress: brokerWallet.classicAddress,
      borrowerAddress: borrowerWallet.classicAddress,
      loanBrokerId: session.loanBrokerId,
      principalRequested,
      interestRate,
      paymentTotal,
      paymentInterval,
      gracePeriod,
      originationFee,
      serviceFee,
      latePaymentFee,
      closePaymentFee,
      overpaymentFee,
      lateInterestRate,
      closeInterestRate,
      overpaymentInterestRate,
      data: loanData,
    });

    const result = await signAndSubmitLoanSet(
      brokerWallet,
      borrowerWallet,
      loanSetTx
    );

    // Extract loan ID from metadata
    const meta = result.result.meta as unknown as Record<string, unknown>;
    const affectedNodes = (meta?.AffectedNodes as Array<Record<string, unknown>>) || [];
    let loanId = "";
    for (const node of affectedNodes) {
      const created = node.CreatedNode as Record<string, unknown> | undefined;
      if (created?.LedgerEntryType === "Loan") {
        loanId = created.LedgerIndex as string;
        break;
      }
    }

    if (loanId) {
      await LoanModel.create({
        sessionId: session._id,
        loanId,
        loanBrokerId: session.loanBrokerId,
        borrowerAddress: borrowerWallet.classicAddress,
        principalRequested,
        interestRate,
        paymentTotal,
        paymentInterval,
        gracePeriod,
        originationFee,
        serviceFee,
        status: "active",
        paymentsRemaining: paymentTotal,
        principalOutstanding: principalRequested,
      });
    }

    return NextResponse.json({ loanId, result: result.result }, { status: 201 });
  } catch (error) {
    console.error("Loan creation error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    await connectDB();
    const loans = await LoanModel.find({ sessionId });

    // Sync loans with on-chain state
    const { getLoanInfo } = await import("@/lib/xrpl/loan");
    const synced = await Promise.all(
      loans.map(async (loan) => {
        const doc = loan.toObject();
        // Skip loans already marked as closed/defaulted and confirmed off-ledger
        if (doc.status === "defaulted" || doc.status === "closed") return doc;

        try {
          const info = await getLoanInfo(doc.loanId);
          const node = info.result?.node;
          if (node) {
            doc.paymentsRemaining = node.PaymentRemaining ?? doc.paymentsRemaining;
            doc.principalOutstanding = node.TotalValueOutstanding ?? doc.principalOutstanding;
            if (doc.paymentsRemaining === 0 || Number(doc.principalOutstanding) === 0) {
              doc.status = "repaid";
            }
            await LoanModel.findByIdAndUpdate(doc._id, {
              paymentsRemaining: doc.paymentsRemaining,
              principalOutstanding: doc.principalOutstanding,
              status: doc.status,
            });
          }
        } catch {
          // Loan not on ledger — it was deleted (closed or defaulted)
          if (doc.status === "repaid" || doc.paymentsRemaining === 0) {
            // Was repaid then closed via LoanDelete
            doc.status = "closed";
          } else {
            doc.status = "defaulted";
          }
          doc.paymentsRemaining = 0;
          doc.principalOutstanding = "0";
          await LoanModel.findByIdAndUpdate(doc._id, {
            status: doc.status,
            paymentsRemaining: 0,
            principalOutstanding: "0",
          });
        }
        return doc;
      })
    );

    return NextResponse.json({ loans: synced });
  } catch (error) {
    console.error("Loan list error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
