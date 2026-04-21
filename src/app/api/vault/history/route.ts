import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, DepositHistoryModel } from "@/lib/db";
import { requireAuthSession } from "@/lib/auth";
import { MPT_SCALE_MULTIPLIER } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const vaultId = request.nextUrl.searchParams.get("vaultId");
    if (!vaultId) {
      return NextResponse.json({ error: "vaultId is required" }, { status: 400 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    const isMPT = session?.issuedToken?.type === "MPT";

    // History entries log the ledger-scaled value (integers for MPT). Unscale
    // before returning so the client can render them with the same convention
    // as every other amount it receives from the API.
    const unscale = (s: string | undefined): string =>
      isMPT ? (Number(s || "0") / MPT_SCALE_MULTIPLIER).toString() : String(s ?? "0");

    const raw = await DepositHistoryModel.find({ sessionId, vaultId })
      .sort({ createdAt: -1 })
      .lean();

    const history = raw.map((entry) => ({
      ...entry,
      amountDrops: unscale(entry.amountDrops),
    }));

    let totalDeposited = 0;
    let totalWithdrawn = 0;
    for (const entry of history) {
      const amount = parseFloat(entry.amountDrops || "0");
      if (entry.type === "deposit") totalDeposited += amount;
      else totalWithdrawn += amount;
    }
    const netInvested = totalDeposited - totalWithdrawn;

    return NextResponse.json({
      history,
      summary: {
        totalDeposited: String(totalDeposited),
        totalWithdrawn: String(totalWithdrawn),
        netInvested: String(netInvested),
      },
    });
  } catch (error) {
    console.error("Deposit history error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
