import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel, VaultModel } from "@/lib/db";
import { getVaultInfo } from "@/lib/xrpl/vault";
import { requireAuthSession } from "@/lib/auth";
import { unscaleVaultNodeForMPT } from "@/lib/xrpl/helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: vaultId } = await params;

    await connectDB();
    // Scope by sessionId — without this, any authenticated caller could
    // read another user's vault record by guessing/observing a vaultId.
    const vaultDb = await VaultModel.findOne({ vaultId, sessionId });
    if (!vaultDb) {
      return NextResponse.json({ error: "Vault not found" }, { status: 404 });
    }

    const session = await SessionModel.findById(sessionId);
    const isMPT = session?.issuedToken?.type === "MPT";

    let onLedger: unknown = null;
    try {
      const info = await getVaultInfo(vaultId);
      onLedger = info.result;
      const vaultNode = (info.result as { vault?: Record<string, unknown> } | undefined)?.vault;
      unscaleVaultNodeForMPT(vaultNode, isMPT);
    } catch {
      // Vault may not exist on ledger yet.
    }

    return NextResponse.json({ vault: vaultDb, onLedger });
  } catch (error) {
    console.error("Vault details error:", error);
    return NextResponse.json(
      { error: "Failed to get vault details" },
      { status: 500 }
    );
  }
}
