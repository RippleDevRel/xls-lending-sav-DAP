import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateObjectId, validateAmount } from "@/lib/validation";
import { connectDB, SessionModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { submitTransaction } from "@/lib/xrpl/vault";
import { DROPS_PER_XRP } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateObjectId(body.sessionId);
    const from = body.from as string;
    const to = body.to as string;
    const amount = validateAmount(body.amount);
    const asset = body.asset as "XRP" | "TUSD" | undefined;

    if (!sessionId || !from || !to || !amount) {
      return NextResponse.json(
        { error: "sessionId, from, to, and amount are required" },
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
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const fromWallet = session.wallets.find(
      (w: { role: string }) => w.role === from
    );
    const toWallet = session.wallets.find(
      (w: { role: string }) => w.role === to
    );

    if (!fromWallet || !toWallet) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 400 }
      );
    }

    const senderWallet = walletFromSeed(fromWallet.seed);
    const issuedToken = session.issuedToken;

    // Build Payment transaction
    let paymentAmount: string | Record<string, string>;

    if (asset === "TUSD" && issuedToken) {
      if (issuedToken.type === "IOU") {
        paymentAmount = {
          currency: issuedToken.currency,
          issuer: issuedToken.issuer,
          value: amount,
        };
      } else {
        // MPT
        const mptValue = String(Math.round(parseFloat(amount) * 100));
        paymentAmount = {
          mpt_issuance_id: issuedToken.mptIssuanceId,
          value: mptValue,
        };
      }
    } else {
      // XRP — convert to drops
      paymentAmount = String(Math.round(parseFloat(amount) * DROPS_PER_XRP));
    }

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
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
