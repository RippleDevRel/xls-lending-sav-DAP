"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BorderBeam } from "@/components/ui/border-beam";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Loader2, ArrowRight, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from "motion/react";
import { DROPS_PER_XRP } from "@/lib/constants";

interface CreateVaultProps {
  sessionId: string;
  onCreated: (vaultId: string, brokerId: string, txHash?: string) => void;
  onError: (message: string) => void;
  onPending: (message: string) => void;
}

export function CreateVault({
  sessionId,
  onCreated,
  onError,
  onPending,
}: CreateVaultProps) {
  const [loading, setLoading] = useState(false);

  // Asset type
  const [assetType, setAssetType] = useState<"XRP" | "IOU" | "MPT">("XRP");
  const [iouCurrency, setIouCurrency] = useState("");
  const [iouIssuer, setIouIssuer] = useState("");
  const [mptIssuanceId, setMptIssuanceId] = useState("");

  // Vault metadata
  const [vaultName, setVaultName] = useState("");
  const [website, setWebsite] = useState("");

  // Max deposit cap
  const [hasMaxCap, setHasMaxCap] = useState(false);
  const [maxCapXrp, setMaxCapXrp] = useState("1000");

  // Non-transferable shares
  const [nonTransferable, setNonTransferable] = useState(false);

  // Broker config
  const [managementFee, setManagementFee] = useState("");
  const [debtMaximum, setDebtMaximum] = useState("");
  const [coverRateMin, setCoverRateMin] = useState("");
  const [coverRateLiq, setCoverRateLiq] = useState("");
  const [firstLossCapital, setFirstLossCapital] = useState("");

  // Share metadata (MPT - XLS-89 compressed keys)
  const [shareTicker, setShareTicker] = useState("");
  const [shareName, setShareName] = useState("");
  const [shareDesc, setShareDesc] = useState("");
  const [shareIcon, setShareIcon] = useState("");
  const [shareIssuerName, setShareIssuerName] = useState("");

  async function handleCreate() {
    setLoading(true);
    onPending("Creating vault and broker on XRPL Devnet...");

    try {
      const vaultOptions: Record<string, unknown> = {};

      // Asset
      if (assetType === "IOU" && iouCurrency.trim() && iouIssuer.trim()) {
        vaultOptions.asset = {
          type: "IOU",
          currency: iouCurrency.trim().toUpperCase(),
          issuer: iouIssuer.trim(),
        };
      } else if (assetType === "MPT" && mptIssuanceId.trim()) {
        vaultOptions.asset = {
          type: "MPT",
          mptIssuanceId: mptIssuanceId.trim(),
        };
      } else {
        vaultOptions.asset = { type: "XRP" };
      }

      if (vaultName.trim()) vaultOptions.name = vaultName.trim();
      if (website.trim()) vaultOptions.website = website.trim();
      if (nonTransferable) vaultOptions.nonTransferableShares = true;
      if (hasMaxCap && maxCapXrp) {
        vaultOptions.assetsMaximum = String(
          Math.round(parseFloat(maxCapXrp) * DROPS_PER_XRP)
        );
      }
      if (shareTicker.trim() || shareName.trim() || shareDesc.trim() || shareIcon.trim() || shareIssuerName.trim()) {
        vaultOptions.shareMetadata = {
          ...(shareTicker.trim() && { ticker: shareTicker.trim() }),
          ...(shareName.trim() && { name: shareName.trim() }),
          ...(shareDesc.trim() && { description: shareDesc.trim() }),
          ...(shareIcon.trim() && { icon: shareIcon.trim() }),
          ...(shareIssuerName.trim() && { issuerName: shareIssuerName.trim() }),
        };
      }

      const vaultRes = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, vaultOptions }),
      });
      const vaultData = await vaultRes.json();
      if (!vaultRes.ok) throw new Error(vaultData.error);

      const vaultId = vaultData.vault.vaultId;

      // Build broker options
      const brokerOptions: Record<string, number> = {};
      if (managementFee) brokerOptions.managementFeeRate = Math.round(parseFloat(managementFee) * 100);
      if (debtMaximum) brokerOptions.debtMaximum = Math.round(parseFloat(debtMaximum) * DROPS_PER_XRP);
      if (coverRateMin) brokerOptions.coverRateMinimum = Math.round(parseFloat(coverRateMin) * 100);
      if (coverRateLiq) brokerOptions.coverRateLiquidation = Math.round(parseFloat(coverRateLiq) * 100);

      const coverAmountDrops = firstLossCapital
        ? String(Math.round(parseFloat(firstLossCapital) * DROPS_PER_XRP))
        : undefined;

      const brokerRes = await fetch("/api/broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          vaultId,
          brokerOptions: Object.keys(brokerOptions).length > 0 ? brokerOptions : undefined,
          coverAmountDrops,
        }),
      });
      const brokerData = await brokerRes.json();
      if (!brokerRes.ok) throw new Error(brokerData.error);

      onCreated(vaultId, brokerData.loanBrokerId, brokerData.result?.hash);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create vault");
    } finally {
      setLoading(false);
    }
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden">
        <BorderBeam size={150} duration={10} />
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">Create a Vault</CardTitle>
          <CardDescription>
            Configure and deploy a public XRP vault on the ledger. A loan broker
            will be registered automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Asset type */}
          <div className="space-y-4">
            <p className="text-sm font-medium">Asset</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { key: "XRP", label: "XRP" },
                  { key: "RLUSD", label: "RLUSD", disabled: true },
                  { key: "IOU", label: "Custom IOU" },
                  { key: "MPT", label: "MPT" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={"disabled" in opt && opt.disabled}
                  onClick={() => {
                    if ("disabled" in opt && opt.disabled) return;
                    if (opt.key === "RLUSD") {
                      setAssetType("IOU");
                      setIouCurrency("USD");
                      setIouIssuer("rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV");
                    } else if (opt.key === "IOU") {
                      setAssetType("IOU");
                      setIouCurrency("");
                      setIouIssuer("");
                    } else if (opt.key === "MPT") {
                      setAssetType("MPT");
                    } else {
                      setAssetType("XRP");
                    }
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    "disabled" in opt && opt.disabled
                      ? "opacity-40 cursor-not-allowed text-muted-foreground"
                      : (opt.key === "XRP" && assetType === "XRP") ||
                          (opt.key === "RLUSD" && assetType === "IOU" && iouIssuer === "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV") ||
                          (opt.key === "IOU" && assetType === "IOU" && iouIssuer !== "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV") ||
                          (opt.key === "MPT" && assetType === "MPT")
                        ? "border-primary bg-primary/5 text-primary"
                        : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                  {"disabled" in opt && opt.disabled && (
                    <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                      (Testnet only)
                    </span>
                  )}
                </button>
              ))}
            </div>

            {assetType === "IOU" && (() => {
              const isRlusd = iouIssuer === "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
              return (
                <div className="space-y-3">
                  {isRlusd && (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary">
                      RLUSD — Ripple&apos;s USD stablecoin on XRPL Devnet
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="iou-currency">Currency code</Label>
                      <Input
                        id="iou-currency"
                        placeholder="e.g. USD"
                        value={iouCurrency}
                        onChange={(e) => setIouCurrency(e.target.value)}
                        maxLength={3}
                        readOnly={isRlusd}
                        className={isRlusd ? "bg-muted" : ""}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="iou-issuer">Issuer address</Label>
                      <Input
                        id="iou-issuer"
                        placeholder="rXXXX..."
                        value={iouIssuer}
                        onChange={(e) => setIouIssuer(e.target.value)}
                        className={`font-mono text-xs ${isRlusd ? "bg-muted" : ""}`}
                        readOnly={isRlusd}
                        required
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            {assetType === "MPT" && (
              <div className="space-y-2">
                <Label htmlFor="mpt-id">MPT Issuance ID</Label>
                <Input
                  id="mpt-id"
                  placeholder="0000012FFD9EE5DA93AC614B..."
                  value={mptIssuanceId}
                  onChange={(e) => setMptIssuanceId(e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Vault identity */}
          <div className="space-y-4">
            <p className="text-sm font-medium">Vault Identity</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vault-name">Name</Label>
                <Input
                  id="vault-name"
                  placeholder="e.g. XRP Lending Pool"
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  maxLength={64}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vault-website">Website</Label>
                <Input
                  id="vault-website"
                  placeholder="e.g. example.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={128}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Vault settings */}
          <div className="space-y-4">
            <p className="text-sm font-medium">Settings</p>

            {/* Max cap */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="has-max-cap"
                  checked={hasMaxCap}
                  onChange={(e) => setHasMaxCap(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <Label htmlFor="has-max-cap" className="text-sm font-normal">
                  Set a maximum deposit cap
                </Label>
              </div>
              {hasMaxCap && (
                <div className="space-y-2 pl-6">
                  <Label htmlFor="max-cap">Max assets (XRP)</Label>
                  <Input
                    id="max-cap"
                    type="number"
                    min="1"
                    step="1"
                    value={maxCapXrp}
                    onChange={(e) => setMaxCapXrp(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Non-transferable shares */}
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="non-transferable"
                checked={nonTransferable}
                onChange={(e) => setNonTransferable(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <div>
                <Label
                  htmlFor="non-transferable"
                  className="text-sm font-normal"
                >
                  Non-transferable shares
                </Label>
                <p className="text-xs text-muted-foreground">
                  Vault shares cannot be transferred between accounts.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Share metadata */}
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">
                Share Token Metadata{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                MPToken metadata for the vault&apos;s share tokens.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="share-ticker">Ticker</Label>
                <Input
                  id="share-ticker"
                  placeholder="e.g. SHARE1"
                  value={shareTicker}
                  onChange={(e) => setShareTicker(e.target.value)}
                  maxLength={12}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-name">Name</Label>
                <Input
                  id="share-name"
                  placeholder="e.g. Vault Shares"
                  value={shareName}
                  onChange={(e) => setShareName(e.target.value)}
                  maxLength={64}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-desc">Description</Label>
              <Input
                id="share-desc"
                placeholder="e.g. Proportional ownership shares of the vault"
                value={shareDesc}
                onChange={(e) => setShareDesc(e.target.value)}
                maxLength={256}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="share-icon">Icon URL</Label>
                <Input
                  id="share-icon"
                  placeholder="e.g. example.com/icon.png"
                  value={shareIcon}
                  onChange={(e) => setShareIcon(e.target.value)}
                  maxLength={128}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-issuer">Issuer name</Label>
                <Input
                  id="share-issuer"
                  placeholder="e.g. MyBank"
                  value={shareIssuerName}
                  onChange={(e) => setShareIssuerName(e.target.value)}
                  maxLength={64}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Broker config */}
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">
                Broker Configuration{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Risk management and fee parameters for the loan broker.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="mgmt-fee">Management fee (%)</Label>
                  <InfoTip text="Percentage the broker earns on loan interest. E.g. 1% means the broker takes 1% of all interest generated, the rest goes to vault depositors." />
                </div>
                <Input
                  id="mgmt-fee"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 1.0"
                  value={managementFee}
                  onChange={(e) => setManagementFee(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="debt-max">Max debt (XRP)</Label>
                  <InfoTip text="Maximum total debt the broker can issue across all loans. Leave empty for unlimited." />
                </div>
                <Input
                  id="debt-max"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Unlimited"
                  value={debtMaximum}
                  onChange={(e) => setDebtMaximum(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cover-min">Min cover rate (%)</Label>
                  <InfoTip text="Minimum ratio of first-loss capital to total debt. If cover drops below this, the broker can't issue new loans and fees are redirected to replenish the capital." />
                </div>
                <Input
                  id="cover-min"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 10.0"
                  value={coverRateMin}
                  onChange={(e) => setCoverRateMin(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="cover-liq">Liquidation rate (%)</Label>
                  <InfoTip text="Critical threshold below min cover rate. If first-loss capital falls below this ratio, the broker is fully restricted. Must be lower than min cover rate." />
                </div>
                <Input
                  id="cover-liq"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 5.0"
                  value={coverRateLiq}
                  onChange={(e) => setCoverRateLiq(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="first-loss">First-loss capital (XRP)</Label>
                <InfoTip text="Assets deposited by the broker as a buffer against loan defaults. Protects depositors by absorbing initial losses. Deposited from the broker wallet after creation." />
              </div>
              <Input
                id="first-loss"
                type="number"
                min="0"
                step="1"
                placeholder="Amount to deposit as first-loss capital"
                value={firstLossCapital}
                onChange={(e) => setFirstLossCapital(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Deposited from the broker wallet after creation. Acts as a buffer against loan defaults.
              </p>
            </div>
          </div>

          <Separator />

          {/* Summary */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Asset</span>
              <span className="font-medium font-mono">
                {assetType === "XRP"
                  ? "XRP"
                  : assetType === "IOU"
                    ? iouIssuer === "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV"
                      ? "RLUSD"
                      : iouCurrency.toUpperCase() || "—"
                    : mptIssuanceId
                      ? `MPT:${mptIssuanceId.slice(0, 8)}...`
                      : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">Public</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Deposit cap</span>
              <span className="font-medium">
                {hasMaxCap ? `${maxCapXrp} XRP` : "Unlimited"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shares</span>
              <span className="font-medium">
                {nonTransferable ? "Non-transferable" : "Transferable"}
              </span>
            </div>
            {managementFee && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Management fee</span>
                <span className="font-medium">{managementFee}%</span>
              </div>
            )}
            {firstLossCapital && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">First-loss capital</span>
                <span className="font-medium">{firstLossCapital} XRP</span>
              </div>
            )}
          </div>

          <ShimmerButton
            className="w-full h-10 text-sm font-semibold"
            shimmerColor="hsl(213, 100%, 60%)"
            shimmerSize="0.1em"
            background="hsl(213, 100%, 40%)"
            disabled={loading}
            onClick={handleCreate}
          >
            {loading ? (
              <span className="flex items-center gap-2 text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating vault...
              </span>
            ) : (
              <span className="flex items-center gap-2 text-white">
                Create Vault & Register Broker
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </ShimmerButton>
        </CardContent>
      </Card>
    </motion.div>
  );
}
