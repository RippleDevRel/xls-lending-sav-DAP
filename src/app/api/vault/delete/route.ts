import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api-error";
import { connectDB, SessionModel, VaultModel, LoanModel } from "@/lib/db";
import { walletFromSeed } from "@/lib/xrpl/wallet";
import { buildVaultDelete, submitTransaction, getVaultInfo } from "@/lib/xrpl/vault";
import { buildLoanBrokerDelete, buildLoanBrokerCoverWithdraw } from "@/lib/xrpl/broker";
import { buildLoanDelete, buildLoanManage, LOAN_MANAGE_FLAGS } from "@/lib/xrpl/loan";
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
    if (!session || !session.vaultId) {
      return NextResponse.json(
        { error: "Session or vault not found" },
        { status: 404 }
      );
    }

    const brokerWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "broker"
    );
    const borrowerWalletData = session.wallets.find(
      (w: { role: string }) => w.role === "borrower"
    );
    if (!brokerWalletData) {
      return NextResponse.json(
        { error: "Broker wallet not found" },
        { status: 400 }
      );
    }

    const brokerWallet = walletFromSeed(brokerWalletData.seed);
    const borrowerWallet = borrowerWalletData
      ? walletFromSeed(borrowerWalletData.seed)
      : null;

    // Pre-check: vault must have 0 assets (all deposits withdrawn)
    try {
      const vaultInfo = await getVaultInfo(session.vaultId);
      const vault = vaultInfo.result?.vault;
      const assetsTotal = Number(vault?.AssetsTotal || "0");
      if (assetsTotal > 0) {
        return NextResponse.json(
          {
            error: `Cannot delete vault: assets still deposited (${assetsTotal}). Withdraw all funds from the Depositor tab first.`,
          },
          { status: 400 }
        );
      }
    } catch {
      // vault_info failed — proceed anyway
    }

    // Step 1: Handle loans still on ledger
    const { getLoanInfo } = await import("@/lib/xrpl/loan");
    // Include ALL loans except "closed" (already deleted from ledger)
    const allLoans = await LoanModel.find({
      sessionId,
      status: { $ne: "closed" },
    });
    for (const loan of allLoans) {
      try {
        const info = await getLoanInfo(loan.loanId);
        const node = info.result?.node;
        if (!node) continue;

        // If loan is active with outstanding payments, default it first
        if (node.PaymentRemaining > 0) {
          try {
            const defaultTx = buildLoanManage(
              brokerWallet.classicAddress,
              loan.loanId,
              LOAN_MANAGE_FLAGS.tfLoanDefault
            );
            await submitTransaction(brokerWallet, defaultTx);
          } catch {
            // Default may fail (e.g. grace period not expired) — try delete anyway
          }
        }

        // Now delete the loan
        const wallet = borrowerWallet || brokerWallet;
        const tx = buildLoanDelete(wallet.classicAddress, loan.loanId);
        await submitTransaction(wallet, tx);
      } catch {
        // Loan not on ledger or delete failed — skip
      }
    }

    // Step 2: Handle broker — withdraw first-loss capital then delete
    if (session.loanBrokerId) {
      try {
        const brokerInfo = await getLoanInfo(session.loanBrokerId);
        const brokerNode = brokerInfo.result?.node;
        if (brokerNode) {
          // Withdraw all first-loss capital if any
          const coverAvailable = Number(brokerNode.CoverAvailable || 0);
          if (coverAvailable > 0) {
            try {
              const withdrawTx = buildLoanBrokerCoverWithdraw(
                brokerWallet.classicAddress,
                session.loanBrokerId,
                String(coverAvailable)
              );
              await submitTransaction(brokerWallet, withdrawTx);
            } catch {
              // Cover withdraw failed — try delete anyway
            }
          }

          // Delete broker
          const deleteTx = buildLoanBrokerDelete(
            brokerWallet.classicAddress,
            session.loanBrokerId
          );
          await submitTransaction(brokerWallet, deleteTx);
        }
      } catch {
        // Broker not on ledger — skip
      }
    }

    // Step 3: Delete vault on-chain
    const tx = buildVaultDelete(brokerWallet.classicAddress, session.vaultId);
    const result = await submitTransaction(brokerWallet, tx);

    // All on-chain operations succeeded — update DB
    for (const loan of allLoans) {
      const newStatus = loan.paymentsRemaining === 0 ? "closed" : "defaulted";
      await LoanModel.findByIdAndUpdate(loan._id, { status: newStatus });
    }
    await VaultModel.findOneAndUpdate(
      { vaultId: session.vaultId },
      { status: "deleted" }
    );
    await SessionModel.findByIdAndUpdate(sessionId, {
      $unset: { vaultId: 1, loanBrokerId: 1 },
    });

    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Vault delete error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
