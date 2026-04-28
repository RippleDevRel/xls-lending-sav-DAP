import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel } from "@/lib/db";
import { redactSession } from "@/lib/session-public";

/**
 * Lightweight session probe — returns the session document for the caller's
 * auth cookie or 401 if the cookie is missing/invalid. Does not touch XRPL.
 */
export async function GET() {
  const sessionId = await requireAuthSession();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const session = await SessionModel.findById(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Heal stale state: an issuedToken without a vault can only come from an
  // earlier IOU/MPT vault that was deleted. Leaving it on the session would
  // cause downstream code to mis-build Amount fields for a fresh XRP vault.
  if (session.issuedToken && !session.vaultId) {
    await SessionModel.findByIdAndUpdate(sessionId, { $unset: { issuedToken: 1 } });
    session.issuedToken = undefined;
  }

  return NextResponse.json({ session: redactSession(session) });
}
