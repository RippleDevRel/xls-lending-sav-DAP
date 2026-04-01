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
  const totalCost =
    principal + totalInterest + parseInt(originationFee) + totalServiceFees;
  const periodicPayment = Math.ceil(
    (principal + totalInterest + totalServiceFees) / paymentTotal
  );

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
      <Row label="Principal">
        <AmountDisplay drops={principalRequested} />
      </Row>
      <Row label={`Interest (${(interestRate / 100).toFixed(1)}%)`}>
        <AmountDisplay drops={totalInterest.toString()} />
      </Row>
      <Row label="Origination fee">
        <AmountDisplay drops={originationFee} />
      </Row>
      <Row label={`Service fees (${paymentTotal}x)`}>
        <AmountDisplay drops={totalServiceFees.toString()} />
      </Row>
      <Separator />
      <Row label="Total cost" className="font-medium text-foreground">
        <AmountDisplay drops={totalCost.toString()} />
      </Row>
      <Row label="Per payment" className="text-muted-foreground">
        <span className="font-mono">
          {(periodicPayment / DROPS_PER_XRP).toFixed(2)} XRP
        </span>
      </Row>
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
