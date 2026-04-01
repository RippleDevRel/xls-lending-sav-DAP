"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletBadge } from "@/components/wallet-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LogOut,
  Briefcase,
  PiggyBank,
  HandCoins,
  ChevronDown,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { DROPS_PER_XRP } from "@/lib/constants";

const roleConfig = {
  broker: {
    icon: Briefcase,
    label: "Broker",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  depositor: {
    icon: PiggyBank,
    label: "Depositor",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  borrower: {
    icon: HandCoins,
    label: "Borrower",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

export function SessionHeader() {
  const { session, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<
    Record<string, string> | null
  >(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);

  const fetchBalances = useCallback(async () => {
    if (!session?._id) return;
    setLoadingBalances(true);
    try {
      const res = await fetch(
        `/api/session/balances?sessionId=${session._id}`
      );
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const w of data.wallets) {
          map[w.role] = w.balance;
        }
        setBalances(map);
      }
    } finally {
      setLoadingBalances(false);
    }
  }, [session?._id]);

  useEffect(() => {
    if (open && !balances) {
      fetchBalances();
    }
  }, [open, balances, fetchBalances]);

  if (!session) return null;

  function handleLogout() {
    logout();
    router.push("/");
  }

  function formatXrp(drops: string) {
    return (parseInt(drops) / DROPS_PER_XRP).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <h1 className="text-base font-semibold tracking-tight">
          XLS-66 & XLS-65
        </h1>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          Devnet
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Accounts dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Accounts</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setOpen(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border bg-card p-2 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Session wallets
                  </p>
                  <button
                    onClick={fetchBalances}
                    disabled={loadingBalances}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Refresh balances"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${loadingBalances ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>

                {session.wallets.map((w) => {
                  const config =
                    roleConfig[w.role as keyof typeof roleConfig];
                  const Icon = config.icon;
                  const balance = balances?.[w.role];

                  return (
                    <div
                      key={w.role}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${config.color}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold">
                            {config.label}
                          </p>
                          {loadingBalances && !balance ? (
                            <Skeleton className="h-4 w-16" />
                          ) : balance ? (
                            <p className="text-xs font-mono font-semibold">
                              {formatXrp(balance)}{" "}
                              <span className="text-muted-foreground font-normal">
                                XRP
                              </span>
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              —
                            </p>
                          )}
                        </div>
                        <div className="mt-0.5">
                          <WalletBadge address={w.address} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="border-t mt-1 pt-1 space-y-1">
                  <button
                    onClick={async () => {
                      setToppingUp(true);
                      try {
                        const res = await fetch("/api/session/topup", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ sessionId: session._id }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          const map: Record<string, string> = {};
                          for (const w of data.wallets) {
                            map[w.role] = w.balance;
                          }
                          setBalances(map);
                        }
                      } finally {
                        setToppingUp(false);
                      }
                    }}
                    disabled={toppingUp}
                    className="w-full flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                  >
                    {toppingUp ? (
                      <>
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Funding via faucet...
                      </>
                    ) : (
                      <>
                        <Wallet className="h-3 w-3" />
                        Top up all wallets
                      </>
                    )}
                  </button>
                  <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                    <span className="truncate">{session.email}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          className="text-muted-foreground h-8 w-8"
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
