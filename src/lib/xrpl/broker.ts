export interface BrokerOptions {
  managementFeeRate?: number; // basis points (e.g. 100 = 1%)
  debtMaximum?: number; // max total debt the broker can issue
  coverRateMinimum?: number; // basis points — min first-loss capital ratio
  coverRateLiquidation?: number; // basis points — liquidation threshold
}

export function buildLoanBrokerSet(
  brokerAddress: string,
  vaultId: string,
  options: BrokerOptions = {}
) {
  const tx: Record<string, unknown> = {
    TransactionType: "LoanBrokerSet",
    Account: brokerAddress,
    VaultID: vaultId,
  };

  if (options.managementFeeRate !== undefined) {
    tx.ManagementFeeRate = options.managementFeeRate;
  }
  if (options.debtMaximum !== undefined) {
    tx.DebtMaximum = options.debtMaximum;
  }
  if (options.coverRateMinimum !== undefined) {
    tx.CoverRateMinimum = options.coverRateMinimum;
  }
  if (options.coverRateLiquidation !== undefined) {
    tx.CoverRateLiquidation = options.coverRateLiquidation;
  }

  return tx;
}

export function buildLoanBrokerCoverDeposit(
  brokerAddress: string,
  loanBrokerId: string,
  amountDrops: string
) {
  return {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: brokerAddress,
    LoanBrokerID: loanBrokerId,
    Amount: amountDrops,
  };
}

export function buildLoanBrokerCoverWithdraw(
  brokerAddress: string,
  loanBrokerId: string,
  amountDrops: string
) {
  return {
    TransactionType: "LoanBrokerCoverWithdraw",
    Account: brokerAddress,
    LoanBrokerID: loanBrokerId,
    Amount: amountDrops,
  };
}

export function buildLoanBrokerDelete(
  brokerAddress: string,
  loanBrokerId: string
) {
  return {
    TransactionType: "LoanBrokerDelete",
    Account: brokerAddress,
    LoanBrokerID: loanBrokerId,
  };
}
