import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { buildLoanDelete, buildLoanManage, LoanManageFlags } from "@/lib/xrpl/loan";
import { submitTransaction } from "@/lib/xrpl/vault";
import { getRoleWallet } from "@/lib/xrpl/helpers";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const loanId = typeof body.loanId === "string" ? body.loanId.trim() : null;
    const action = body.action || "default"; // "default" | "close"
    if (!loanId) {
      return NextResponse.json({ error: "loanId is required" }, { status: 400 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const brokerWallet = getRoleWallet(session, "broker");

    if (action === "close") {
      const tx = buildLoanDelete(brokerWallet.classicAddress, loanId);
      const result = await submitTransaction(brokerWallet, tx);
      await LoanModel.findOneAndUpdate({ loanId }, { status: "closed" });
      return NextResponse.json({ result: result.result });
    }

    // LoanManage with tfLoanDefault defaults an unpaid loan past its grace period.
    const tx = buildLoanManage(brokerWallet.classicAddress, loanId, LoanManageFlags.tfLoanDefault);
    const result = await submitTransaction(brokerWallet, tx);
    await LoanModel.findOneAndUpdate({ loanId }, { status: "defaulted" });
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Loan manage error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
