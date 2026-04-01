import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel } from "@/lib/db";
import { getXrplClient } from "@/lib/xrpl/client";
import { Wallet } from "xrpl";
import { validateObjectId } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);

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

    // Fund each wallet via faucet
    const results = await Promise.all(
      session.wallets.map(
        async (w: { seed: string; role: string; address: string }) => {
          try {
            const wallet = Wallet.fromSeed(w.seed);
            const { balance } = await client.fundWallet(wallet);
            return { role: w.role, balance: balance.toString(), funded: true };
          } catch (err) {
            console.error(`Failed to fund ${w.role}:`, err);
            return { role: w.role, balance: "0", funded: false };
          }
        }
      )
    );

    // Fetch actual on-chain balances after funding
    const balances = await Promise.all(
      session.wallets.map(async (w: { address: string; role: string }) => {
        try {
          const response = await client.request({
            command: "account_info",
            account: w.address,
            ledger_index: "validated",
          });
          return {
            role: w.role,
            balance: response.result.account_data.Balance,
          };
        } catch {
          return { role: w.role, balance: "0" };
        }
      })
    );

    // Update balances in DB
    for (const b of balances) {
      const idx = session.wallets.findIndex(
        (sw: { role: string }) => sw.role === b.role
      );
      if (idx !== -1) {
        session.wallets[idx].balance = b.balance;
      }
    }
    await session.save();

    const allFunded = results.every((r) => r.funded);

    return NextResponse.json({
      success: allFunded,
      wallets: balances,
    });
  } catch (error) {
    console.error("Topup error:", error);
    return NextResponse.json(
      { error: "Failed to top up wallets" },
      { status: 500 }
    );
  }
}
