"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { CreateVault } from "./create-vault";
import { VaultDetails } from "./vault-details";
import { IssueLoan } from "./issue-loan";
import { ManageLoans } from "./manage-loans";
import { TransactionStatus } from "@/components/transaction-status";
import { StepIndicator } from "@/components/step-indicator";
import { motion, AnimatePresence } from "motion/react";
import type { LoanState } from "@/types/loan";

const steps = [
  { label: "Create Vault" },
  { label: "Issue Loan" },
  { label: "Manage" },
];

export default function BrokerPage() {
  const { session } = useSession();
  const [vaultId, setVaultId] = useState<string | null>(
    session?.vaultId || null
  );
  const [loanBrokerId, setLoanBrokerId] = useState<string | null>(
    session?.loanBrokerId || null
  );
  const [loans, setLoans] = useState<LoanState[]>([]);
  const [vaultAssetTotal, setVaultAssetTotal] = useState<string | undefined>(undefined);
  const [vaultAssetsMaximum, setVaultAssetsMaximum] = useState<string | undefined>(undefined);
  const [brokerDebtMaximum, setBrokerDebtMaximum] = useState<string | undefined>(undefined);
  const [brokerDebtTotal, setBrokerDebtTotal] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "pending";
    message: string;
    txHash?: string;
  } | null>(null);

  const fetchVaultInfo = useCallback(async () => {
    if (!vaultId) return;
    try {
      const res = await fetch(`/api/vault/${vaultId}`);
      if (res.ok) {
        const data = await res.json();
        const v = data.onLedger?.vault;
        setVaultAssetTotal(v?.AssetsTotal || "0");
        setVaultAssetsMaximum(v?.AssetsMaximum);
      }
      // Fetch broker data for debt limits
      if (loanBrokerId) {
        const bRes = await fetch(`/api/loan/${loanBrokerId}`);
        if (bRes.ok) {
          const bData = await bRes.json();
          const node = bData.onLedger?.node;
          if (node) {
            setBrokerDebtMaximum(String(node.DebtMaximum ?? 0));
            setBrokerDebtTotal(String(node.DebtTotal ?? 0));
          }
        }
      }
    } catch { /* ignore */ }
  }, [vaultId, loanBrokerId]);

  const sessionId = session?._id;

  const fetchLoans = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/loan?sessionId=${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setLoans(data.loans);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchLoans();
    fetchVaultInfo();
  }, [fetchLoans, fetchVaultInfo]);

  useEffect(() => {
    if (session?.vaultId) setVaultId(session.vaultId);
    if (session?.loanBrokerId) setLoanBrokerId(session.loanBrokerId);
  }, [session]);

  if (!session) return null;

  let currentStep = 0;
  if (vaultId && loanBrokerId) currentStep = 1;
  if (loans.length > 0) currentStep = 2;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Loan Broker</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create a vault, register as broker, and issue loans.
          </p>
        </div>
        <StepIndicator steps={steps} currentStep={currentStep} />
      </div>

      <AnimatePresence mode="wait">
        {status && (
          <motion.div
            key="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <TransactionStatus status={status.type} message={status.message} txHash={status.txHash} />
          </motion.div>
        )}
      </AnimatePresence>

      {!vaultId ? (
        <motion.div
          key="create"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <CreateVault
            sessionId={session._id}
            onCreated={(id, brokerId, txHash) => {
              setVaultId(id);
              setLoanBrokerId(brokerId);
              setStatus({
                type: "success",
                message: "Vault and broker created on XRPL",
                txHash,
              });
            }}
            onError={(msg) => setStatus({ type: "error", message: msg })}
            onPending={(msg) => setStatus({ type: "pending", message: msg })}
          />
        </motion.div>
      ) : (
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <VaultDetails
              vaultId={vaultId}
              sessionId={session._id}
              loanBrokerId={loanBrokerId}
              onDeleted={(txHash) => {
                setVaultId(null);
                setLoanBrokerId(null);
                setLoans([]);
                setStatus({ type: "success", message: "Vault deleted", txHash });
              }}
            />
          </motion.div>

          {loanBrokerId && (
            <div className="space-y-8">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <IssueLoan
                  sessionId={session._id}
                  vaultAssetTotal={vaultAssetTotal}
                  vaultAssetsMaximum={vaultAssetsMaximum}
                  brokerDebtMaximum={brokerDebtMaximum}
                  brokerDebtTotal={brokerDebtTotal}
                  onCreated={(txHash) => {
                    fetchLoans();
                    fetchVaultInfo();
                    setStatus({
                      type: "success",
                      message: "Loan issued successfully",
                      txHash,
                    });
                  }}
                  onError={(msg) => setStatus({ type: "error", message: msg })}
                  onPending={(msg) =>
                    setStatus({ type: "pending", message: msg })
                  }
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <ManageLoans
                  loans={loans}
                  sessionId={session._id}
                  onUpdate={fetchLoans}
                  onStatus={(type, message, txHash) =>
                    setStatus({ type, message, txHash })
                  }
                />
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
