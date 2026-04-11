"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AmountDisplay } from "@/components/amount-display";
import { LoanStatusBadge } from "@/components/loan-status-badge";
import { Loader2, ExternalLink, Calendar, Clock, CheckCircle, Trash2 } from "lucide-react";
import { explorerObjectUrl } from "@/lib/explorer";
import { DROPS_PER_XRP } from "@/lib/constants";
import type { LoanState } from "@/types/loan";

interface RepaymentFormProps {
  sessionId: string;
  loan: LoanState;
  token?: string;
  onSuccess: (message: string, txHash?: string) => void;
  onError: (message: string) => void;
  onPending: (message: string) => void;
}

type PaymentMode = "installment" | "full" | "custom";

interface OnChainLoan {
  TotalValueOutstanding?: string;
  PaymentRemaining?: number;
  PaymentTotal?: number;
  PeriodicPayment?: string;
  NextPaymentDueDate?: number;
  PreviousPaymentDueDate?: number;
  PrincipalOutstanding?: string;
  PrincipalRequested?: string;
  InterestRate?: number;
  LoanServiceFee?: string;
  LoanOriginationFee?: string;
  GracePeriod?: number;
  PaymentInterval?: number;
}

export function RepaymentForm({
  sessionId,
  loan,
  token,
  onSuccess,
  onError,
  onPending,
}: RepaymentFormProps) {
  const unit = token || "XRP";
  const isToken = !!token;
  const [mode, setMode] = useState<PaymentMode>("installment");
  const [customAmount, setCustomAmount] = useState("10");
  const [loading, setLoading] = useState(false);
  const [onChain, setOnChain] = useState<OnChainLoan | null>(null);

  const fetchLoanInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/loan/${loan.loanId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.onLedger?.node) {
          setOnChain(data.onLedger.node);
        }
      }
    } catch { /* ignore */ }
  }, [loan.loanId]);

  useEffect(() => {
    fetchLoanInfo();
  }, [fetchLoanInfo]);

  // Always prefer on-chain values over DB
  const paymentsRemaining = onChain?.PaymentRemaining ?? loan.paymentsRemaining;
  const paymentTotal = onChain?.PaymentTotal ?? loan.paymentTotal;
  const totalOutstanding = onChain?.TotalValueOutstanding || loan.principalOutstanding;
  const principalRequested = onChain?.PrincipalRequested || loan.principalRequested;
  const interestRateDisplay = onChain?.InterestRate
    ? (onChain.InterestRate / 1000).toFixed(1)
    : (loan.interestRate / 100).toFixed(1);
  const serviceFee = onChain?.LoanServiceFee || loan.serviceFee || "0";
  const paid = paymentTotal - paymentsRemaining;
  const progress = paymentTotal > 0 ? (paid / paymentTotal) * 100 : 0;
  const isFullyRepaid =
    paymentsRemaining === 0 ||
    (Number(totalOutstanding) === 0 && paid > 0);

  // For XRP (drops), round up to nearest integer. For tokens, round to 6 decimals max (XRPL IOU limit).
  const ceil = isToken ? (n: number) => n : Math.ceil;
  const roundAmt = isToken
    ? (n: number) => parseFloat(n.toFixed(6))
    : (n: number) => Math.ceil(n);

  // Add a small buffer to avoid tecINSUFFICIENT_PAYMENT from interest accruing
  // between fetch and submission. The ledger caps overpayments automatically.
  function addBuffer(n: number): number {
    return isToken ? n * 1.02 : n + 1000; // +2% for tokens, +1000 drops for XRP
  }

  function getPaymentAmount(): string {
    if (mode === "full") {
      const outstanding = Number(totalOutstanding || "0");
      const svcFee = Number(serviceFee);
      const totalServiceFees = svcFee * paymentsRemaining;
      return String(roundAmt(addBuffer(outstanding + totalServiceFees)));
    }
    if (mode === "installment") {
      const periodicPayment = ceil(
        Number(onChain?.PeriodicPayment || "0")
      );
      const svcFee = Number(serviceFee);

      if (periodicPayment > 0) {
        return String(roundAmt(addBuffer(periodicPayment + svcFee)));
      }
      const outstanding = Number(totalOutstanding || "0");
      const remaining = paymentsRemaining || 1;
      return String(roundAmt(addBuffer(outstanding / remaining + svcFee)));
    }
    if (isToken) return String(parseFloat(customAmount || "0"));
    return String(Math.round(parseFloat(customAmount || "0") * DROPS_PER_XRP));
  }

  function formatVal(drops: string): string {
    return isToken ? parseFloat(drops).toFixed(2) : (parseInt(drops) / DROPS_PER_XRP).toFixed(2);
  }

  function formatDate(rippleTimestamp: number): string {
    // Ripple epoch is 2000-01-01 00:00:00 UTC
    const unixMs = (rippleTimestamp + 946684800) * 1000;
    return new Date(unixMs).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Refresh on-chain state first to get accurate numbers
    await fetchLoanInfo();
    const amountDrops = getPaymentAmount();
    const amountDisplay = formatVal(amountDrops);
    onPending(`Making payment of ${amountDisplay} ${unit}...`);

    try {
      // Re-fetch fresh on-chain state before paying in full
      let finalAmountDrops = amountDrops;
      if (mode === "full") {
        try {
          const freshRes = await fetch(`/api/loan/${loan.loanId}`);
          if (freshRes.ok) {
            const freshData = await freshRes.json();
            const node = freshData.onLedger?.node;
            if (node) {
              const freshOutstanding = Number(node.TotalValueOutstanding || "0");
              const freshRemaining = node.PaymentRemaining ?? 0;
              const svcFee = Number(serviceFee);
              finalAmountDrops = String(roundAmt(addBuffer(freshOutstanding + svcFee * freshRemaining)));
            }
          }
        } catch { /* use original calculation */ }
      }

      const finalDisplay = formatVal(finalAmountDrops);
      onPending(`Making payment of ${finalDisplay} ${unit}...`);

      const res = await fetch("/api/loan/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          loanId: loan.loanId,
          amountDrops: finalAmountDrops,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Refresh on-chain state after payment
      await fetchLoanInfo();
      onSuccess(`Payment of ${finalDisplay} ${unit} submitted`, data.result?.hash);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  }


  if (isFullyRepaid) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Loan Fully Repaid</CardTitle>
            <div className="flex items-center gap-2">
              <LoanStatusBadge status="repaid" />
              <a
                href={explorerObjectUrl(loan.loanId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Principal</p>
              <AmountDisplay drops={principalRequested} className="font-medium" token={token} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Payments made</p>
              <p className="font-mono font-medium">{paid}/{paymentTotal}</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary w-full" />
          </div>
          <div className="rounded-lg border border-success/50 bg-success/5 px-3 py-2.5 text-sm text-success flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            All payments completed. This loan is fully settled.
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              onPending("Removing loan from ledger...");
              try {
                const res = await fetch("/api/loan/default", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId, loanId: loan.loanId, action: "close" }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                onSuccess("Loan removed from ledger", data.result?.hash);
              } catch (err) {
                onError(err instanceof Error ? err.message : "Failed to close loan");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remove from ledger
          </Button>
          <p className="text-xs text-muted-foreground">
            Optional — removes the loan object from the ledger and frees the 2 XRP owner reserve. Required before deleting the vault.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Make a Payment</CardTitle>
          <div className="flex items-center gap-2">
            <LoanStatusBadge status={loan.status} />
            <a
              href={explorerObjectUrl(loan.loanId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Principal</p>
            <AmountDisplay drops={principalRequested} className="font-medium" token={token} />
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Outstanding</p>
            <AmountDisplay drops={totalOutstanding} className="font-medium" token={token} />
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Interest rate</p>
            <p className="font-mono font-medium">
              {interestRateDisplay}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Payments</p>
            <p className="font-mono font-medium">
              {paid}/{paymentTotal}
            </p>
          </div>
        </div>

        {/* Next payment due */}
        {onChain?.NextPaymentDueDate && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Next payment due:</span>
            <span className="font-medium">
              {formatDate(onChain.NextPaymentDueDate)}
            </span>
          </div>
        )}

        {onChain?.PeriodicPayment && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Periodic payment:</span>
            <AmountDisplay drops={onChain.PeriodicPayment} className="font-medium" token={token} />
          </div>
        )}

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">
            {paymentsRemaining} payment{paymentsRemaining !== 1 ? "s" : ""} remaining
          </p>
        </div>

        <Separator />

        {/* Payment mode selection */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Payment type</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "installment", label: "Next installment" },
                  { key: "full", label: "Pay in full" },
                  { key: "custom", label: "Custom" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    mode === opt.key
                      ? "border-primary bg-primary/5 text-primary"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview amount */}
          {mode === "installment" && (
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Amount: </span>
              <AmountDisplay drops={getPaymentAmount()} className="font-semibold" token={token} />
            </div>
          )}

          {mode === "full" && (() => {
            const outstanding = ceil(
              Number(onChain?.TotalValueOutstanding || loan.principalOutstanding || "0")
            );
            const remaining = onChain?.PaymentRemaining ?? loan.paymentsRemaining;
            const svcFee = Number(serviceFee);
            const totalSvcFees = svcFee * remaining;
            return (
              <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding (principal + interest)</span>
                  <AmountDisplay drops={String(outstanding)} token={token} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Service fees ({remaining} × {formatVal(String(svcFee))} {unit})
                  </span>
                  <AmountDisplay drops={String(totalSvcFees)} token={token} />
                </div>
                <div className="flex justify-between border-t pt-1.5 font-semibold">
                  <span>Total</span>
                  <AmountDisplay drops={getPaymentAmount()} token={token} />
                </div>
              </div>
            );
          })()}

          {mode === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="custom-amount">Amount ({unit})</Label>
              <Input
                id="custom-amount"
                type="number"
                min="0.1"
                step="0.1"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                required
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Pay ${formatVal(getPaymentAmount())} ${unit}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
