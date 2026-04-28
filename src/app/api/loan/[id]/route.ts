import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel, LoanModel } from "@/lib/db";
import { getLoanInfo } from "@/lib/xrpl/loan";
import { requireAuthSession } from "@/lib/auth";
import { unscaleLoanNodeForMPT } from "@/lib/xrpl/helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: loanId } = await params;

    await connectDB();
    // Scope by sessionId — without this, any authenticated caller could
    // read another user's loan record by guessing/observing a loanId.
    const loanDb = await LoanModel.findOne({ loanId, sessionId });
    if (!loanDb) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    const session = await SessionModel.findById(sessionId);
    const isMPT = session?.issuedToken?.type === "MPT";

    let onLedger: unknown = null;
    try {
      const info = await getLoanInfo(loanId);
      onLedger = info.result;
      const node = (info.result as { node?: Record<string, unknown> } | undefined)?.node;
      unscaleLoanNodeForMPT(node, isMPT);
    } catch {
      // Loan may not exist on ledger.
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
