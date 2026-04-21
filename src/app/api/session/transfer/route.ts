import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateAmount } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel } from "@/lib/db";
import { submitTransaction } from "@/lib/xrpl/vault";
import { getRoleWallet, buildAmountField, hasIssuedToken } from "@/lib/xrpl/helpers";
import { DROPS_PER_XRP } from "@/lib/constants";
import type { WalletInfo } from "@/types/session";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const from = body.from as WalletInfo["role"];
    const to = body.to as WalletInfo["role"];
    const amount = validateAmount(body.amount);
    const asset = body.asset as "XRP" | "TUSD" | undefined;

    if (!from || !to || !amount) {
      return NextResponse.json(
        { error: "from, to, and amount are required" },
        { status: 400 }
      );
    }
    if (from === to) {
      return NextResponse.json(
        { error: "Cannot transfer to the same wallet" },
        { status: 400 }
      );
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const toWallet = session.wallets.find((w: WalletInfo) => w.role === to);
    if (!toWallet) {
      return NextResponse.json({ error: "Destination wallet not found" }, { status: 400 });
    }
    const senderWallet = getRoleWallet(session, from);

    const paymentAmount =
      asset === "TUSD" && hasIssuedToken(session.issuedToken)
        ? buildAmountField(session.issuedToken, amount)
        : String(Math.round(parseFloat(amount) * DROPS_PER_XRP));

    const tx = {
      TransactionType: "Payment",
      Account: senderWallet.classicAddress,
      Destination: toWallet.address,
      Amount: paymentAmount,
    };

    const result = await submitTransaction(senderWallet, tx);
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Transfer error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
