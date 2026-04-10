import { Separator } from "@/components/ui/separator";
import { AmountDisplay } from "@/components/amount-display";
import { DROPS_PER_XRP } from "@/lib/constants";

interface FeeBreakdownProps {
  principalRequested: string;
  interestRate: number;
  paymentTotal: number;
  originationFee: string;
  serviceFee: string;
}

export function FeeBreakdown({
  principalRequested,
  interestRate,
  paymentTotal,
  originationFee,
  serviceFee,
}: FeeBreakdownProps) {
  const principal = parseInt(principalRequested);
  const totalInterest = Math.floor((principal * interestRate) / 10000);
  const totalServiceFees = parseInt(serviceFee) * paymentTotal;
  const totalToRepay = principal + totalInterest + totalServiceFees;
  const periodicPayment = Math.ceil(totalToRepay / paymentTotal);

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
      <Row label="Principal">
        <AmountDisplay drops={principalRequested} />
      </Row>
      <Row label={`Interest (${(interestRate / 100).toFixed(1)}%)`}>
        <AmountDisplay drops={totalInterest.toString()} />
      </Row>
      <Row label={`Service fees (${paymentTotal}×)`}>
        <AmountDisplay drops={totalServiceFees.toString()} />
      </Row>
      <Separator />
      <Row label="Total to repay" className="font-medium text-foreground">
        <AmountDisplay drops={totalToRepay.toString()} />
      </Row>
      <Row label="Est. per payment" className="text-muted-foreground">
        <span className="font-mono">
          ~{(periodicPayment / DROPS_PER_XRP).toFixed(2)} XRP
        </span>
      </Row>
      {parseInt(originationFee) > 0 && (
        <>
          <Separator />
          <Row label="Origination fee (deducted from principal)" className="text-muted-foreground text-xs">
            <AmountDisplay drops={originationFee} />
          </Row>
          <Row label="Borrower receives" className="text-muted-foreground text-xs">
            <AmountDisplay drops={(principal - parseInt(originationFee)).toString()} />
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
