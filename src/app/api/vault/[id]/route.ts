import { NextRequest, NextResponse } from "next/server";
import { connectDB, VaultModel } from "@/lib/db";
import { getVaultInfo } from "@/lib/xrpl/vault";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: vaultId } = await params;

    await connectDB();
    const vaultDb = await VaultModel.findOne({ vaultId });

    let onLedger = null;
    try {
      const info = await getVaultInfo(vaultId);
      onLedger = info.result;
    } catch {
      // Vault may not exist on ledger yet or connection issue
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
