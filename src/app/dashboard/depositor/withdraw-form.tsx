"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { DROPS_PER_XRP } from "@/lib/constants";

interface WithdrawFormProps {
  sessionId: string;
  vaultId: string;
  vaultAssetsTotal?: string;
  vaultAssetsAvailable?: string;
  onSuccess: (message: string, txHash?: string) => void;
  onError: (message: string) => void;
  onPending: (message: string) => void;
}

export function WithdrawForm({
  sessionId,
  vaultId,
  vaultAssetsTotal,
  vaultAssetsAvailable,
  onSuccess,
  onError,
  onPending,
}: WithdrawFormProps) {
  const [amountXrp, setAmountXrp] = useState("10");
  const [loading, setLoading] = useState(false);

  async function handleWithdraw(amountDrops: string) {
    setLoading(true);
    const xrp = (parseInt(amountDrops) / DROPS_PER_XRP).toFixed(2);
    onPending(`Withdrawing ${xrp} XRP from vault...`);

    try {
      const res = await fetch("/api/vault/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, vaultId, amountDrops }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess(`Redeemed ${xrp} XRP from vault`, data.result?.hash);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountDrops = String(Math.round(parseFloat(amountXrp) * DROPS_PER_XRP));
    await handleWithdraw(amountDrops);
  }

  async function handleWithdrawAll() {
    // Fetch fresh vault state — use AssetsAvailable (not Total)
    let availableDrops = vaultAssetsAvailable || vaultAssetsTotal || "0";
    try {
      const res = await fetch(`/api/vault/${vaultId}`);
      if (res.ok) {
        const data = await res.json();
        const v = data.onLedger?.vault;
        availableDrops = v?.AssetsAvailable || v?.AssetsTotal || availableDrops;
      }
    } catch { /* use prop value */ }

    if (Number(availableDrops) === 0) {
      onError("No available assets to withdraw. Some may be locked in active loans.");
      return;
    }

    await handleWithdraw(availableDrops);
  }

  // Use AssetsAvailable (not Total) — some assets may be locked in loans
  const withdrawable = vaultAssetsAvailable || vaultAssetsTotal;
  const availableXrp = withdrawable
    ? (parseInt(withdrawable) / DROPS_PER_XRP).toFixed(2)
    : null;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="withdraw-amount">Shares to redeem</Label>
            {availableXrp && (
              <button
                type="button"
                onClick={() => setAmountXrp(availableXrp)}
                className="text-xs text-primary hover:underline"
              >
                Max available: {availableXrp} XRP
              </button>
            )}
          </div>
          <Input
            id="withdraw-amount"
            type="number"
            min="0.1"
            step="0.1"
            value={amountXrp}
            onChange={(e) => setAmountXrp(e.target.value)}
            required
          />
        </div>
        <Button type="submit" variant="outline" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Withdrawing...
            </>
          ) : (
            "Withdraw"
          )}
        </Button>
      </form>

      {availableXrp && Number(availableXrp) > 0 && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={loading}
          onClick={handleWithdrawAll}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redeeming...
            </>
          ) : (
            `Redeem max available (${availableXrp} XRP)`
          )}
        </Button>
      )}
    </div>
  );
}
