/**
 * XLS-66 LoanBroker transaction builders.
 * Spec: https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol
 *
 * Rate fields are expressed in 1/10 basis points (1 unit = 0.001%).
 *   - ManagementFeeRate: UINT16, range 0–10_000 (0–10%)
 *   - CoverRateMinimum/CoverRateLiquidation: UINT32, range 0–100_000 (0–100%)
 */
export interface BrokerOptions {
  /** 1/10 bps. Portion of loan interest that flows to the broker. */
  managementFeeRate?: number;
  /**
   * Hard cap on total outstanding debt the broker may originate. 0 = unlimited.
   * Accepted as a number or a numeric string — XLS-66 declares this UINT64,
   * and JS Number can only represent integers up to 2^53-1, so values above
   * that must arrive as a decimal string.
   */
  debtMaximum?: number | string;
  /** 1/10 bps. Minimum first-loss capital ratio; below this the broker can't issue new loans. */
  coverRateMinimum?: number;
  /** 1/10 bps. Liquidation threshold; must be < coverRateMinimum. */
  coverRateLiquidation?: number;
}

/**
 * LoanBrokerSet — create a broker for the supplied vault. (XLS-66 also
 * permits update via this transaction by including LoanBrokerID, but this
 * codebase only exercises the create path.)
 */
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
  if (options.managementFeeRate !== undefined) tx.ManagementFeeRate = options.managementFeeRate;
  if (options.debtMaximum !== undefined) tx.DebtMaximum = options.debtMaximum;
  if (options.coverRateMinimum !== undefined) tx.CoverRateMinimum = options.coverRateMinimum;
  if (options.coverRateLiquidation !== undefined) tx.CoverRateLiquidation = options.coverRateLiquidation;
  return tx;
}

/**
 * Deposit first-loss capital from the broker account. The Amount must match
 * the vault's asset type (drops for XRP, IOU object for IOU, MPT amount for MPT);
 * otherwise the ledger returns tecWRONG_ASSET.
 */
export function buildLoanBrokerCoverDeposit(
  brokerAddress: string,
  loanBrokerId: string,
  amount: string | Record<string, string>
) {
  return {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: brokerAddress,
    LoanBrokerID: loanBrokerId,
    Amount: amount,
  };
}

/** Withdraw cover capital. Required before LoanBrokerDelete if any cover remains. */
export function buildLoanBrokerCoverWithdraw(
  brokerAddress: string,
  loanBrokerId: string,
  amount: string | Record<string, string>
) {
  return {
    TransactionType: "LoanBrokerCoverWithdraw",
    Account: brokerAddress,
    LoanBrokerID: loanBrokerId,
    Amount: amount,
  };
}

/** LoanBrokerDelete — fails with tecHAS_OBLIGATIONS if any loans or cover remain. */
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
