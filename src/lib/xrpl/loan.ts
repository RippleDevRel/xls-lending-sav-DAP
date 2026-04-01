import * as xrpl from "xrpl";
import { type Wallet } from "xrpl";
import { getXrplClient } from "./client";

export interface LoanSetParams {
  brokerAddress: string;
  borrowerAddress: string;
  loanBrokerId: string;
  principalRequested: string;
  interestRate: number;
  paymentTotal: number;
  paymentInterval: number;
  gracePeriod: number;
  originationFee: string;
  serviceFee: string;
  // Optional advanced fields
  latePaymentFee?: string;
  closePaymentFee?: string;
  overpaymentFee?: number; // 1/10th basis points (0-100000)
  lateInterestRate?: number; // 1/10th basis points
  closeInterestRate?: number; // 1/10th basis points
  overpaymentInterestRate?: number; // 1/10th basis points
  data?: string; // hex-encoded metadata
}

export function buildLoanSet(params: LoanSetParams) {
  const tx: Record<string, unknown> = {
    TransactionType: "LoanSet",
    Account: params.brokerAddress,
    Counterparty: params.borrowerAddress,
    LoanBrokerID: params.loanBrokerId,
    PrincipalRequested: params.principalRequested,
    InterestRate: params.interestRate * 10, // Convert basis points to 1/10th basis points
    PaymentTotal: params.paymentTotal,
    PaymentInterval: params.paymentInterval,
    GracePeriod: params.gracePeriod,
    LoanOriginationFee: params.originationFee,
    LoanServiceFee: params.serviceFee,
    SigningPubKey: "",
  };

  if (params.latePaymentFee) tx.LatePaymentFee = params.latePaymentFee;
  if (params.closePaymentFee) tx.ClosePaymentFee = params.closePaymentFee;
  if (params.overpaymentFee !== undefined) tx.OverpaymentFee = params.overpaymentFee;
  if (params.lateInterestRate !== undefined) tx.LateInterestRate = params.lateInterestRate;
  if (params.closeInterestRate !== undefined) tx.CloseInterestRate = params.closeInterestRate;
  if (params.overpaymentInterestRate !== undefined) tx.OverpaymentInterestRate = params.overpaymentInterestRate;
  if (params.data) tx.Data = params.data;

  return tx;
}

export async function signAndSubmitLoanSet(
  brokerWallet: Wallet,
  borrowerWallet: Wallet,
  loanSetTx: Record<string, unknown>
) {
  const client = await getXrplClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(loanSetTx as any);

  // Step 1: Broker signs
  const brokerSigned = brokerWallet.sign(prepared);

  // Step 2: Borrower counter-signs
  const fullySigned = (
    xrpl as unknown as {
      signLoanSetByCounterparty: (
        wallet: Wallet,
        blob: string
      ) => { tx_blob: string };
    }
  ).signLoanSetByCounterparty(borrowerWallet, brokerSigned.tx_blob);

  // Step 3: Submit
  const result = await client.submitAndWait(fullySigned.tx_blob);

  // Verify the transaction actually succeeded on-chain
  const meta = result.result.meta as unknown as Record<string, unknown>;
  const engineResult =
    (meta?.TransactionResult as string) ||
    ((result.result as unknown as Record<string, unknown>).engine_result as string) ||
    "";

  if (engineResult && engineResult !== "tesSUCCESS") {
    const hash = (result.result as unknown as Record<string, unknown>).hash || "";
    throw new Error(`LoanSet failed: ${engineResult} (tx: ${hash})`);
  }

  return result;
}

export function buildLoanPay(
  borrowerAddress: string,
  loanId: string,
  amountDrops: string
) {
  return {
    TransactionType: "LoanPay",
    Account: borrowerAddress,
    LoanID: loanId,
    Amount: amountDrops,
  };
}

export function buildLoanDelete(accountAddress: string, loanId: string) {
  return {
    TransactionType: "LoanDelete",
    Account: accountAddress,
    LoanID: loanId,
  };
}

// LoanManage flags
export const LOAN_MANAGE_FLAGS = {
  tfLoanDefault: 65536,
  tfLoanImpair: 131072,
  tfLoanUnimpair: 262144,
} as const;

export function buildLoanManage(
  brokerAddress: string,
  loanId: string,
  flag: number
) {
  return {
    TransactionType: "LoanManage",
    Account: brokerAddress,
    LoanID: loanId,
    Flags: flag,
  };
}

export async function getLoanInfo(loanId: string) {
  const client = await getXrplClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).request({
    command: "ledger_entry",
    index: loanId,
    ledger_index: "validated",
  });
  return result;
}
