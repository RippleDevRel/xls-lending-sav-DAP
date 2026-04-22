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
    let dustFallbackUsed = false;
    let rawAvailable = "0";

    /** Builds the Amount for an asset-denominated VaultWithdraw. */
    const buildAssetAmount = (value: string): string | Record<string, string> => {
      if (issuedToken?.type === "MPT" && issuedToken.mptIssuanceId) {
        return { mpt_issuance_id: issuedToken.mptIssuanceId, value };
      }
      if (issuedToken?.type === "IOU" && issuedToken.currency && issuedToken.issuer) {
        return { currency: issuedToken.currency, issuer: issuedToken.issuer, value };
      }
      return value; // XRP drops
    };

    /** Reduce `rawAvailable` so the tx cannot empty the vault (avoids rippled
     *  100%-redemption invariant). IOU: truncate to cents. MPT scale 2: −1
     *  unit. XRP: −10 000 drops (= 0.01 XRP). */
    const buildDustFallbackValue = (): string => {
      if (issuedToken?.type === "IOU") {
        return (Math.floor(Number(rawAvailable) * 100) / 100).toFixed(2);
      }
      if (issuedToken?.type === "MPT") {
        return String(Math.max(0, Number(rawAvailable) - 1));
      }
      return String(Math.max(0, Number(rawAvailable) - 10_000));
    };

    if (redeemAll) {
      const vaultInfo = await getVaultInfo(vaultId);
      const vaultNode = vaultInfo.result?.vault;
      rawAvailable = String(vaultNode?.AssetsAvailable ?? "0");
      if (rawAvailable === "0") {
        return NextResponse.json(
          { error: "No assets available to withdraw" },
          { status: 400 }
        );
      }
      preAssetsTotal = Number(vaultNode?.AssetsTotal ?? "0");

      // First attempt: exact AssetsAvailable → empties the vault cleanly so
      // VaultDelete can follow. rippled < 3.1.3 rejects 100% IOU redemption
      // with tecINVARIANT_FAILED because the vault invariant didn't round
      // IOU/MPT balance deltas consistently (fixed by XRPLF/rippled#6955,
      // merged 2026-04-21). Devnet still runs the pre-fix build as of the
      // commit date, so we catch that tec code and retry with a sub-cent
      // dust left behind — depositor recovers their funds, VaultDelete
      // stays unavailable until devnet picks up the new rippled release.
      amount = buildAssetAmount(rawAvailable);
      ledgerAmount = rawAvailable;
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

    let result;
    try {
      const tx = buildVaultWithdraw(depositorWallet.classicAddress, vaultId, amount);
      result = await submitTransaction(depositorWallet, tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (redeemAll && msg.includes("tecINVARIANT_FAILED")) {
        // Known rippled limitation on 100% redemption. Retry with dust.
        dustFallbackUsed = true;
        const fallbackValue = buildDustFallbackValue();
        amount = buildAssetAmount(fallbackValue);
        ledgerAmount = fallbackValue;
        const retryTx = buildVaultWithdraw(depositorWallet.classicAddress, vaultId, amount);
        result = await submitTransaction(depositorWallet, retryTx);
      } else {
        throw err;
      }
    }

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

    return NextResponse.json({ result: result.result, dustFallbackUsed });
  } catch (error) {
    console.error("Vault withdraw error:", error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
