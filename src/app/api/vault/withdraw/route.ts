import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { validateDrops } from "@/lib/validation";
import { requireAuthSession } from "@/lib/auth";
import { connectDB, SessionModel, VaultModel, DepositHistoryModel } from "@/lib/db";
import { buildVaultWithdraw, submitTransaction, getVaultInfo } from "@/lib/xrpl/vault";
import {
  getRoleWallet,
  buildAmountField,
  hasIssuedToken,
  fetchVaultSnapshot,
} from "@/lib/xrpl/helpers";
import { MPT_SCALE_MULTIPLIER } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const sessionId = await requireAuthSession();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const vaultId = typeof body.vaultId === "string" ? body.vaultId.trim() : null;
    if (!vaultId) {
      return NextResponse.json({ error: "vaultId is required" }, { status: 400 });
    }

    await connectDB();
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const depositorWallet = getRoleWallet(session, "depositor");
    const issuedToken = session.issuedToken;
    const isToken = hasIssuedToken(issuedToken);

    // "Redeem all" (XLS-65 §3.2.2, asset-denominated path): take the vault's
    // current AssetsAvailable as a raw on-chain integer and pass it through
    // unchanged. rippled computes the matching share burn via the Withdraw
    // formula (§2.1.7.2.3). No client-side math → no precision drift, no
    // dependence on share-denominated edge cases (which as of 2026-04 still
    // trip tecINVARIANT_FAILED on full redemption).
    //
    // The demo uses a single depositor per session so AssetsAvailable maps
    // 1:1 to their share; for a multi-depositor fork this helper should
    // instead compute shares × (AssetsAvailable / OutstandingAmount).
    const redeemAll = body.redeemAll === true;

    let amount: string | Record<string, string>;
    let ledgerAmount: string;
    let preAssetsTotal: number | null = null;
    if (redeemAll) {
      const vaultInfo = await getVaultInfo(vaultId);
      const vaultNode = vaultInfo.result?.vault;
      const rawAvailable = String(vaultNode?.AssetsAvailable ?? "0");
      if (rawAvailable === "0") {
        return NextResponse.json(
          { error: "No assets available to withdraw" },
          { status: 400 }
        );
      }
      preAssetsTotal = Number(vaultNode?.AssetsTotal ?? "0");

      // Truncate the submitted amount to cents (2 decimals). rippled's
      // invariant checker rejects VaultWithdraw that would leave both
      // AssetsTotal and OutstandingAmount at exactly zero — by always
      // leaving sub-cent dust in the vault we stay under 100% redemption
      // and the tx lands cleanly. The dust is invisible to the depositor.
      const truncatedValue = (Math.floor(Number(rawAvailable) * 100) / 100).toFixed(2);

      if (issuedToken?.type === "MPT" && issuedToken.mptIssuanceId) {
        // MPT on-chain values are already integer-scaled. Truncation to
        // cents is the same as subtracting the sub-cent MPT units, which
        // for AssetScale 2 is a no-op — so we instead keep one unit
        // (= 0.01 human) of dust to guarantee < 100% redemption.
        const safeValue = String(
          Math.max(0, Math.round(parseFloat(truncatedValue) * MPT_SCALE_MULTIPLIER) - 1)
        );
        amount = { mpt_issuance_id: issuedToken.mptIssuanceId, value: safeValue };
        ledgerAmount = safeValue;
      } else if (issuedToken?.type === "IOU" && issuedToken.currency && issuedToken.issuer) {
        amount = { currency: issuedToken.currency, issuer: issuedToken.issuer, value: truncatedValue };
        ledgerAmount = truncatedValue;
      } else {
        // XRP: leave 10_000 drops (0.01 XRP) of dust for the same reason.
        const rawDrops = Number(rawAvailable);
        amount = String(Math.max(0, rawDrops - 10_000));
        ledgerAmount = amount;
      }
    } else if (isToken && body.tokenAmount) {
      amount = buildAmountField(issuedToken, body.tokenAmount);
      ledgerAmount =
        issuedToken.type === "IOU"
          ? body.tokenAmount
          : String(Math.round(parseFloat(body.tokenAmount) * MPT_SCALE_MULTIPLIER));
    } else {
      const drops = validateDrops(body.amountDrops);
      if (!drops) {
        return NextResponse.json(
          { error: "Valid positive amount is required" },
          { status: 400 }
        );
      }
      amount = drops;
      ledgerAmount = drops;
    }

    const tx = buildVaultWithdraw(depositorWallet.classicAddress, vaultId, amount);
    const result = await submitTransaction(depositorWallet, tx);

    const snapshot = await fetchVaultSnapshot(vaultId);

    // For redeemAll, the submitted AssetsAvailable may have shifted by the
    // time the tx landed (other vault activity). Prefer the pre/post delta
    // as the authoritative history amount when we have both values.
    if (redeemAll && preAssetsTotal !== null) {
      const postAssetsTotal = snapshot ? Number(snapshot.assetsTotal) : 0;
      ledgerAmount = String(Math.max(0, preAssetsTotal - postAssetsTotal));
    }

    const txHash = (result.result as unknown as Record<string, unknown>).hash as string;
    await DepositHistoryModel.create({
      sessionId,
      vaultId,
      type: "withdraw",
      amountDrops: ledgerAmount,
      txHash,
    });

    if (snapshot) {
      await VaultModel.findOneAndUpdate(
        { vaultId },
        { totalDeposited: snapshot.assetsTotal, sharesMinted: snapshot.sharesMinted }
      );
    }

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Vault withdraw error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
