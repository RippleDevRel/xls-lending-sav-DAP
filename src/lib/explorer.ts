const EXPLORER_BASE = "https://devnet.xrpl.org";

export function explorerAccountUrl(address: string) {
  return `${EXPLORER_BASE}/accounts/${address}`;
}

export function explorerTransactionUrl(hash: string) {
  return `${EXPLORER_BASE}/transactions/${hash}`;
}

export function explorerObjectUrl(id: string) {
  return `${EXPLORER_BASE}/object/${id}`;
}

export function explorerMptUrl(mptIssuanceId: string) {
  return `${EXPLORER_BASE}/mpt/${mptIssuanceId}`;
}
