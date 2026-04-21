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
    const { id: vaultId } = await params;

    await connectDB();
    const vaultDb = await VaultModel.findOne({ vaultId });

    // Detect MPT vault to unscale on-chain amount fields to human decimals
    // before returning to the UI.
    const sessionId = await requireAuthSession();
    const session = sessionId ? await SessionModel.findById(sessionId) : null;
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
