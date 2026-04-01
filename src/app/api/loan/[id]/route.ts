import { NextRequest, NextResponse } from "next/server";
import { connectDB, LoanModel } from "@/lib/db";
import { getLoanInfo } from "@/lib/xrpl/loan";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: loanId } = await params;

    await connectDB();
    const loanDb = await LoanModel.findOne({ loanId });

    let onLedger = null;
    try {
      const info = await getLoanInfo(loanId);
      onLedger = info.result;
    } catch {
      // Loan may not exist on ledger
    }

    return NextResponse.json({ loan: loanDb, onLedger });
  } catch (error) {
    console.error("Loan details error:", error);
    return NextResponse.json(
      { error: "Failed to get loan details" },
      { status: 500 }
    );
  }
}
