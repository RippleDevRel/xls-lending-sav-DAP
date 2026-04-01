import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel } from "@/lib/db";
import { getXrplClient } from "@/lib/xrpl/client";

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
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const client = await getXrplClient();

    const wallets = await Promise.all(
      session.wallets.map(async (w: { address: string; role: string }) => {
        try {
          const response = await client.request({
            command: "account_info",
            account: w.address,
            ledger_index: "validated",
          });
          const balance = response.result.account_data.Balance;
          return { role: w.role, balance };
        } catch {
          return { role: w.role, balance: "0" };
        }
      })
    );

    // Update balances in DB
    for (const w of wallets) {
      const idx = session.wallets.findIndex(
        (sw: { role: string }) => sw.role === w.role
      );
      if (idx !== -1) {
        session.wallets[idx].balance = w.balance;
      }
    }
    await session.save();

    return NextResponse.json({ wallets });
  } catch (error) {
    console.error("Balance fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch balances" },
      { status: 500 }
    );
  }
}
