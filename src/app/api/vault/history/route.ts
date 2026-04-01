import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, DepositHistoryModel } from "@/lib/db";
import { validateObjectId } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const sessionId = validateObjectId(
      request.nextUrl.searchParams.get("sessionId")
    );
    const vaultId = request.nextUrl.searchParams.get("vaultId");

    if (!sessionId || !vaultId) {
      return NextResponse.json(
        { error: "sessionId and vaultId are required" },
        { status: 400 }
      );
    }

    await connectDB();

    const history = await DepositHistoryModel.find({ sessionId, vaultId })
      .sort({ createdAt: -1 })
      .lean();

    // Calculate PNL
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    for (const entry of history) {
      const amount = parseInt(entry.amountDrops || "0");
      if (entry.type === "deposit") {
        totalDeposited += amount;
      } else {
        totalWithdrawn += amount;
      }
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
