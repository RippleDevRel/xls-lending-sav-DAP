import { DROPS_PER_XRP } from "@/lib/constants";

interface AmountDisplayProps {
  drops: string;
  className?: string;
}

export function AmountDisplay({ drops, className }: AmountDisplayProps) {
  const xrp = (parseInt(drops) / DROPS_PER_XRP).toFixed(2);
  return (
    <span className={className}>
      <span className="font-mono font-semibold">{xrp}</span>
      <span className="ml-1 text-muted-foreground">XRP</span>
    </span>
  );
}
