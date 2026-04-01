"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FeeBreakdown } from "@/components/fee-breakdown";
import { Loader2, AlertTriangle, Info, ChevronDown } from "lucide-react";
import {
  DROPS_PER_XRP,
  DEFAULT_INTEREST_RATE,
  DEFAULT_PAYMENT_TOTAL,
  DEFAULT_PAYMENT_INTERVAL,
  DEFAULT_GRACE_PERIOD,
  DEFAULT_ORIGINATION_FEE,
  DEFAULT_SERVICE_FEE,
} from "@/lib/constants";

interface IssueLoanProps {
  sessionId: string;
  vaultAssetTotal?: string;
  vaultAssetsMaximum?: string;
  brokerDebtMaximum?: string;
  brokerDebtTotal?: string;
  onCreated: (txHash?: string) => void;
  onError: (message: string) => void;
  onPending: (message: string) => void;
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-help">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function IssueLoan({
  sessionId,
  vaultAssetTotal,
  vaultAssetsMaximum,
  brokerDebtMaximum,
  brokerDebtTotal,
  onCreated,
  onError,
  onPending,
}: IssueLoanProps) {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Core terms
  const [principalXrp, setPrincipalXrp] = useState("20");
  const [interestRate, setInterestRate] = useState(DEFAULT_INTEREST_RATE);
  const [paymentTotal, setPaymentTotal] = useState(DEFAULT_PAYMENT_TOTAL);
  const [paymentInterval, setPaymentInterval] = useState(DEFAULT_PAYMENT_INTERVAL);
  const [gracePeriod, setGracePeriod] = useState(DEFAULT_GRACE_PERIOD);
  const [originationFee, setOriginationFee] = useState(
    (parseInt(DEFAULT_ORIGINATION_FEE) / DROPS_PER_XRP).toString()
  );
  const [serviceFee, setServiceFee] = useState(
    (parseInt(DEFAULT_SERVICE_FEE) / DROPS_PER_XRP).toString()
  );

  // Advanced - fees
  const [latePaymentFee, setLatePaymentFee] = useState("");
  const [closePaymentFee, setClosePaymentFee] = useState("");
  const [overpaymentFee, setOverpaymentFee] = useState("");

  // Advanced - rates
  const [lateInterestRate, setLateInterestRate] = useState("");
  const [closeInterestRate, setCloseInterestRate] = useState("");
  const [overpaymentInterestRate, setOverpaymentInterestRate] = useState("");

  // Metadata
  const [loanName, setLoanName] = useState("");

  const principalDrops = String(
    Math.round(parseFloat(principalXrp || "0") * DROPS_PER_XRP)
  );
  const originationFeeDrops = String(
    Math.round(parseFloat(originationFee || "0") * DROPS_PER_XRP)
  );
  const serviceFeeDrops = String(
    Math.round(parseFloat(serviceFee || "0") * DROPS_PER_XRP)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    onPending("Issuing loan (multi-sign: broker + borrower)...");

    try {
      const body: Record<string, unknown> = {
        sessionId,
        principalRequested: principalDrops,
        interestRate,
        paymentTotal,
        paymentInterval,
        gracePeriod,
        originationFee: originationFeeDrops,
        serviceFee: serviceFeeDrops,
      };

      // Advanced fees (drops) — only send if > 0
      if (latePaymentFee && parseFloat(latePaymentFee) > 0) {
        body.latePaymentFee = String(Math.round(parseFloat(latePaymentFee) * DROPS_PER_XRP));
      }
      if (closePaymentFee && parseFloat(closePaymentFee) > 0) {
        body.closePaymentFee = String(Math.round(parseFloat(closePaymentFee) * DROPS_PER_XRP));
      }
      // Rates in 1/10th basis points (% * 1000) — only send if > 0
      if (overpaymentFee && parseFloat(overpaymentFee) > 0) {
        body.overpaymentFee = Math.round(parseFloat(overpaymentFee) * 1000);
      }
      if (lateInterestRate && parseFloat(lateInterestRate) > 0) {
        body.lateInterestRate = Math.round(parseFloat(lateInterestRate) * 1000);
      }
      if (closeInterestRate && parseFloat(closeInterestRate) > 0) {
        body.closeInterestRate = Math.round(parseFloat(closeInterestRate) * 1000);
      }
      if (overpaymentInterestRate && parseFloat(overpaymentInterestRate) > 0) {
        body.overpaymentInterestRate = Math.round(parseFloat(overpaymentInterestRate) * 1000);
      }

      if (loanName.trim()) body.loanName = loanName.trim();

      const res = await fetch("/api/loan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.result?.hash);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to issue loan");
    } finally {
      setLoading(false);
    }
  }

  // Pre-checks
  const warnings: string[] = [];
  const principalNum = parseInt(principalDrops);

  if (vaultAssetTotal !== undefined && principalNum > parseInt(vaultAssetTotal || "0")) {
    warnings.push(
      `Insufficient vault liquidity: need ${parseFloat(principalXrp)} XRP but vault has ${(parseInt(vaultAssetTotal || "0") / DROPS_PER_XRP).toFixed(2)} XRP available. Deposit more via the Depositor tab.`
    );
  }

  if (vaultAssetsMaximum && vaultAssetsMaximum !== "0") {
    const cap = parseInt(vaultAssetsMaximum);
    const total = parseInt(vaultAssetTotal || "0");
    if (total > 0 && principalNum > cap) {
      warnings.push(
        `Vault deposit cap is ${(cap / DROPS_PER_XRP).toLocaleString()} XRP. The principal exceeds this limit.`
      );
    }
  }

  if (brokerDebtMaximum && Number(brokerDebtMaximum) > 0) {
    const maxDebt = Number(brokerDebtMaximum);
    const currentDebt = Number(brokerDebtTotal || "0");
    if (currentDebt + principalNum > maxDebt) {
      warnings.push(
        `Broker max debt is ${(maxDebt / DROPS_PER_XRP).toLocaleString()} XRP. Current debt: ${(currentDebt / DROPS_PER_XRP).toFixed(2)} XRP. This loan would exceed the limit.`
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issue a Loan</CardTitle>
        <CardDescription>
          Configure loan terms for the borrower wallet in this session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Loan name */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="loan-name">Loan name</Label>
              <InfoTip text="Optional label stored on-chain as metadata. Helps identify the loan (max 64 chars)." />
            </div>
            <Input
              id="loan-name"
              placeholder="e.g. Working capital Q2"
              value={loanName}
              onChange={(e) => setLoanName(e.target.value)}
              maxLength={64}
            />
          </div>

          {/* Core terms */}
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="principal">Principal (XRP)</Label>
                  <InfoTip text="The loan amount requested by the borrower. Must not exceed vault liquidity." />
                </div>
                <Input
                  id="principal"
                  type="number"
                  min="1"
                  step="1"
                  value={principalXrp}
                  onChange={(e) => setPrincipalXrp(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="payments">Number of payments</Label>
                  <InfoTip text="Total installments the borrower must make to repay the loan." />
                </div>
                <Input
                  id="payments"
                  type="number"
                  min="1"
                  max="120"
                  value={paymentTotal}
                  onChange={(e) =>
                    setPaymentTotal(parseInt(e.target.value) || 1)
                  }
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Label>Interest rate</Label>
                  <InfoTip text="Annualized interest rate charged on the outstanding principal." />
                </div>
                <span className="text-sm font-mono font-medium">
                  {(interestRate / 100).toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[interestRate]}
                onValueChange={(v) =>
                  setInterestRate(Array.isArray(v) ? v[0] : v)
                }
                min={100}
                max={5000}
                step={50}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1%</span>
                <span>50%</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="interval">Payment interval</Label>
                  <InfoTip text="Time between payments in seconds. 2592000 = 30 days, 604800 = 7 days." />
                </div>
                <Input
                  id="interval"
                  type="number"
                  min="60"
                  value={paymentInterval}
                  onChange={(e) =>
                    setPaymentInterval(parseInt(e.target.value) || DEFAULT_PAYMENT_INTERVAL)
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {Math.round(paymentInterval / 86400)} days
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="grace">Grace period</Label>
                  <InfoTip text="Seconds after a missed payment before the loan can be defaulted by the broker." />
                </div>
                <Input
                  id="grace"
                  type="number"
                  min="60"
                  value={gracePeriod}
                  onChange={(e) =>
                    setGracePeriod(parseInt(e.target.value) || 0)
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {Math.round(gracePeriod / 86400)} days
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="orig-fee">Origination fee (XRP)</Label>
                  <InfoTip text="One-time fee paid to the broker when the loan is created. Deducted from the principal." />
                </div>
                <Input
                  id="orig-fee"
                  type="number"
                  min="0"
                  step="0.1"
                  value={originationFee}
                  onChange={(e) => setOriginationFee(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="svc-fee">Service fee (XRP)</Label>
                  <InfoTip text="Fee paid to the broker with each loan payment. Charged per contractual installment even if repaid early." />
                </div>
                <Input
                  id="svc-fee"
                  type="number"
                  min="0"
                  step="0.1"
                  value={serviceFee}
                  onChange={(e) => setServiceFee(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
            Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Penalty Fees
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="late-fee" className="text-xs">Late payment fee (XRP)</Label>
                    <InfoTip text="Fixed fee charged when a payment is made after the due date but within the grace period." />
                  </div>
                  <Input
                    id="late-fee"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={latePaymentFee}
                    onChange={(e) => setLatePaymentFee(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="close-fee" className="text-xs">Early close fee (XRP)</Label>
                    <InfoTip text="Fee charged when the borrower repays the entire loan before all installments are due." />
                  </div>
                  <Input
                    id="close-fee"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={closePaymentFee}
                    onChange={(e) => setClosePaymentFee(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="over-fee" className="text-xs">Overpayment fee (%)</Label>
                    <InfoTip text="Percentage charged on any amount paid above the scheduled installment. 0-100%." />
                  </div>
                  <Input
                    id="over-fee"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="0"
                    value={overpaymentFee}
                    onChange={(e) => setOverpaymentFee(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Penalty Interest Rates
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="late-rate" className="text-xs">Late interest (%)</Label>
                    <InfoTip text="Additional interest rate applied on top of the base rate for late payments." />
                  </div>
                  <Input
                    id="late-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="0"
                    value={lateInterestRate}
                    onChange={(e) => setLateInterestRate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="close-rate" className="text-xs">Early close interest (%)</Label>
                    <InfoTip text="Interest rate charged as compensation when the borrower closes the loan early." />
                  </div>
                  <Input
                    id="close-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="0"
                    value={closeInterestRate}
                    onChange={(e) => setCloseInterestRate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="over-rate" className="text-xs">Overpayment interest (%)</Label>
                    <InfoTip text="Interest rate charged on overpayment amounts above the scheduled installment." />
                  </div>
                  <Input
                    id="over-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="0"
                    value={overpaymentInterestRate}
                    onChange={(e) => setOverpaymentInterestRate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

          <FeeBreakdown
            principalRequested={principalDrops}
            interestRate={interestRate}
            paymentTotal={paymentTotal}
            originationFee={originationFeeDrops}
            serviceFee={serviceFeeDrops}
          />

          {warnings.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/5 px-3 py-2.5 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <div className="space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs">{w}</p>
                ))}
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || warnings.length > 0}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Issuing loan...
              </>
            ) : (
              "Issue Loan"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
