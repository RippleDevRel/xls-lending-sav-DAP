import { Separator } from "@/components/ui/separator";
import { AmountDisplay } from "@/components/amount-display";
import { DROPS_PER_XRP } from "@/lib/constants";

interface FeeBreakdownProps {
  principalRequested: string;
  interestRate: number;
  paymentTotal: number;
  originationFee: string;
  serviceFee: string;
  token?: string;
}

export function FeeBreakdown({
  principalRequested,
  interestRate,
  paymentTotal,
  originationFee,
  serviceFee,
  token,
}: FeeBreakdownProps) {
  const unit = token || "XRP";
  const parse = token ? parseFloat : parseInt;
  const principal = parse(principalRequested);
  const totalInterest = Math.floor((principal * interestRate) / 10000);
  const totalServiceFees = parse(serviceFee) * paymentTotal;
  const totalToRepay = principal + totalInterest + totalServiceFees;
  const periodicPayment = Math.ceil(totalToRepay / paymentTotal);

  const formatAmount = (drops: number) =>
    token ? drops.toFixed(2) : (drops / DROPS_PER_XRP).toFixed(2);

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
      <Row label="Principal">
        <AmountDisplay drops={principalRequested} token={token} />
      </Row>
      <Row label={`Interest (${(interestRate / 100).toFixed(1)}%)`}>
        <AmountDisplay drops={totalInterest.toString()} token={token} />
      </Row>
      <Row label={`Service fees (${paymentTotal}×)`}>
        <AmountDisplay drops={totalServiceFees.toString()} token={token} />
      </Row>
      <Separator />
      <Row label="Total to repay" className="font-medium text-foreground">
        <AmountDisplay drops={totalToRepay.toString()} token={token} />
      </Row>
      <Row label="Est. per payment" className="text-muted-foreground">
        <span className="font-mono">
          ~{formatAmount(periodicPayment)} {unit}
        </span>
      </Row>
      {parse(originationFee) > 0 && (
        <>
          <Separator />
          <Row label="Origination fee (deducted from principal)" className="text-muted-foreground text-xs">
            <AmountDisplay drops={originationFee} token={token} />
          </Row>
          <Row label="Borrower receives" className="text-muted-foreground text-xs">
            <AmountDisplay drops={(principal - parse(originationFee)).toString()} token={token} />
          </Row>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between text-muted-foreground ${className || ""}`}>
      <span>{label}</span>
      {children}
    </div>
  );
}
