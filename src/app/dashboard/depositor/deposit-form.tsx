"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { DROPS_PER_XRP } from "@/lib/constants";

interface DepositFormProps {
  sessionId: string;
  vaultId: string;
  onSuccess: (message: string, txHash?: string) => void;
  onError: (message: string) => void;
  onPending: (message: string) => void;
}

export function DepositForm({
  sessionId,
  vaultId,
  onSuccess,
  onError,
  onPending,
}: DepositFormProps) {
  const [amountXrp, setAmountXrp] = useState("50");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    onPending("Depositing into vault...");

    try {
      const amountDrops = String(Math.round(parseFloat(amountXrp) * DROPS_PER_XRP));
      const res = await fetch("/api/vault/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, vaultId, amountDrops }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess(`Deposited ${amountXrp} XRP into vault`, data.result?.hash);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="deposit-amount">Amount (XRP)</Label>
        <Input
          id="deposit-amount"
          type="number"
          min="1"
          step="1"
          value={amountXrp}
          onChange={(e) => setAmountXrp(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Depositing...
          </>
        ) : (
          "Deposit"
        )}
      </Button>
    </form>
  );
}
