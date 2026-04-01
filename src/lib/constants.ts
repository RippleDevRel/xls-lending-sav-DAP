export const XRPL_NETWORK_URL =
  process.env.XRPL_NETWORK_URL || "wss://s.devnet.rippletest.net:51233/";

export const XRPL_FAUCET_URL =
  process.env.XRPL_FAUCET_URL ||
  "https://faucet.devnet.rippletest.net/accounts";

export const DROPS_PER_XRP = 1_000_000;

export const DEFAULT_INTEREST_RATE = 500; // 5% annualized in basis points
export const DEFAULT_PAYMENT_TOTAL = 3;
export const DEFAULT_PAYMENT_INTERVAL = 2_592_000; // 30 days in seconds
export const DEFAULT_GRACE_PERIOD = 604_800; // 7 days in seconds
export const DEFAULT_ORIGINATION_FEE = "1000000"; // 1 XRP in drops
export const DEFAULT_SERVICE_FEE = "500000"; // 0.5 XRP in drops
