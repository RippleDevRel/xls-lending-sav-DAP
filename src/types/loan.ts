export interface LoanState {
  sessionId: string;
  loanId: string;
  loanBrokerId: string;
  borrowerAddress: string;
  principalRequested: string;
  interestRate: number;
  paymentTotal: number;
  paymentInterval: number;
  gracePeriod: number;
  originationFee: string;
  serviceFee: string;
  status: "pending" | "active" | "repaid" | "closed" | "defaulted";
  paymentsRemaining: number;
  principalOutstanding: string;
  createdAt: Date;
  updatedAt: Date;
}
