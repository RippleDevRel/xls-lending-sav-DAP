# XLS-66 Lending Protocol & XLS-65 Single Asset Vault

Demo application for the [XLS-66 Lending Protocol](https://xrpl.org/docs/concepts/tokens/lending-protocol) and [XLS-65 Single Asset Vault](https://xrpl.org/docs/concepts/tokens/single-asset-vaults) amendments on the XRP Ledger.

Three roles — **Loan Broker**, **Depositor**, and **Borrower** — experience the full lending lifecycle: vault creation, liquidity deposits, broker configuration, loan issuance with advanced fee options, repayments, defaults, and cleanup. All transactions execute on-chain on XRPL Devnet.

## Quick Start

```bash
cp .env.example .env.local
# Edit .env.local with your MongoDB Atlas URI
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter any email — three wallets are auto-generated and funded via the Devnet faucet (~100 XRP each).

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19, TypeScript)
- **Styling**: Tailwind CSS v4, shadcn/ui, Aceternity UI, Magic UI
- **Animations**: Motion (Framer Motion), tw-animate-css
- **Fonts**: Geist Sans + Geist Mono
- **3D**: Three.js + React Three Fiber (landing page)
- **Database**: MongoDB (Mongoose) — session cache, NOT source of truth
- **XRPL**: xrpl.js v4 (WebSocket, Devnet)
- **Network**: `wss://s.devnet.rippletest.net:51233/`

## Features

### Vault Configuration (Broker)
- Create public XRP vaults with configurable parameters
- Set **asset type** (XRP), **deposit cap** (`AssetsMaximum`), **non-transferable shares** (`tfMPTCanTransfer` unset)
- Attach **MPT metadata** via XLS-89 compressed keys (`t`, `n`, `d`, `i`, `ac`, `in`)
- Real-time vault state display: `AssetsTotal`, `AssetsAvailable`, `ShareMPTID`, `OutstandingAmount`

### Broker Configuration
- Register as loan broker linked to vault
- Set **management fee** (basis points on vault earnings)
- Set **debt maximum** (caps total outstanding loans)
- Configure **first-loss cover** rates and deposit cover capital
- `LoanBrokerCoverDeposit` / `LoanBrokerCoverWithdraw` for cover management

### Loan Lifecycle
- **Create loans** with full parameter control:
  - Principal, interest rate (1/10th basis points), payment count, payment interval, grace period
  - Origination fee, service fee (charged per installment)
  - **Advanced options**: late payment fee, close payment fee, overpayment fee, late interest rate, close interest rate, overpayment interest rate
  - Loan metadata (name stored as hex-encoded JSON)
- **Repay loans**: installment, full payoff, or custom amount
- **Default loans**: `LoanManage` with `tfLoanDefault` flag (65536)
- **Delete loans**: `LoanDelete` (only works on fully repaid or defaulted loans)
- **Full cleanup sequence**: default active loans → delete all loans → withdraw cover → delete broker → delete vault

### Depositor Experience
- Deposit XRP into vault (provides lending liquidity)
- Withdraw by redeeming vault shares
- **Deposit history** with PNL tracking
- Explorer links for all transactions and objects

### Input Validation
- Server-side validation for all parameters: drops amounts, numbers in range, XRPL addresses, currency codes, MPT issuance IDs, MongoDB ObjectIds
- String sanitization for metadata fields
- Ledger constraint enforcement (e.g., `GracePeriod` > 0, advanced fees > 0 when set)

## Architecture: On-chain vs Off-chain

### Principle

**The XRPL ledger is the single source of truth.** MongoDB is a cache layer that syncs from the ledger after every transaction.

### What lives on-chain (XRPL Devnet)

| Data | How it's accessed |
|------|-------------------|
| Wallet balances | `account_info` with `ledger_index: "validated"` |
| Vault state (assets, shares, cap) | `vault_info` command |
| Loan state (outstanding, payments remaining, next due) | `ledger_entry` with `ledger_index: "validated"` |
| All transactions | Signed and submitted via `submitAndWait` |

### What lives off-chain (MongoDB)

| Data | Purpose |
|------|---------|
| Session (email, wallet seeds, vault ID, broker ID) | Persist wallet credentials across visits |
| Vault record (vault ID, owner, status) | Quick lookup without hitting the ledger |
| Loan record (loan ID, terms, status) | Cache of immutable loan terms |
| Deposit history (amounts, timestamps, tx hashes) | PNL tracking for depositors |

### Sync flow

Every API route that modifies on-chain state follows this pattern:

```
1. Build transaction
2. Sign with wallet
3. Submit via submitAndWait()
4. Verify TransactionResult === "tesSUCCESS" (throw if not)
5. Re-query the ledger for updated state (vault_info / ledger_entry)
6. Update MongoDB cache with on-chain values
7. Return result + tx hash to frontend
```

If a transaction fails on-chain (e.g. `tecHAS_OBLIGATIONS`, `tecINSUFFICIENT_FUNDS`), the error code and tx hash are surfaced directly to the user. MongoDB is never updated on failure.

### Read flow

When fetching data for display:

```
1. Query MongoDB for cached records
2. For each active record, re-query the ledger
3. Update MongoDB cache with fresh on-chain values
4. Return merged data to frontend
```

- `GET /api/loan` syncs every active loan's `PaymentRemaining` and `TotalValueOutstanding` from the ledger
- `GET /api/vault` enriches every vault with live `vault_info` data
- `GET /api/session/balances` fetches real balances via `account_info`

### What is NOT from the ledger

Loan terms like `interestRate`, `originationFee`, `serviceFee`, `paymentInterval`, `gracePeriod` are stored in MongoDB at loan creation time. These are **immutable on-chain** — once a loan is created, its terms never change.

## User Flow

```
1. Enter email → 3 wallets funded on Devnet (~100 XRP each)
2. Broker tab → Create Vault (set deposit cap, metadata, share config)
3. Broker tab → Register Broker (set management fee, debt max, cover rates)
4. Broker tab → Deposit first-loss cover capital
5. Depositor tab → Deposit XRP into vault (provides lending liquidity)
6. Broker tab → Issue Loan (configure all terms + advanced fee options)
7. Borrower tab → Make payments (installment / full / custom amount)
8. Broker tab → Default or close loans
9. Broker tab → Cleanup: delete loans → withdraw cover → delete broker → delete vault
```

## XRPL Transaction Types Used

### XLS-65 (Single Asset Vault)

| Transaction | Purpose |
|-------------|---------|
| `VaultCreate` | Create public XRP vault with deposit cap and share config |
| `VaultDeposit` | Deposit XRP liquidity into vault |
| `VaultWithdraw` | Redeem shares for XRP |
| `VaultDelete` | Remove empty vault from ledger |

### XLS-66 (Lending Protocol)

| Transaction | Purpose |
|-------------|---------|
| `LoanBrokerSet` | Register/update loan broker (linked to vault) |
| `LoanBrokerCoverDeposit` | Deposit first-loss cover capital |
| `LoanBrokerCoverWithdraw` | Withdraw cover capital (required before broker delete) |
| `LoanBrokerDelete` | Remove broker from ledger |
| `LoanSet` | Create loan (multi-signed by broker + borrower) |
| `LoanPay` | Borrower makes a repayment |
| `LoanManage` | Manage loan state (e.g. default with `tfLoanDefault` flag) |
| `LoanDelete` | Remove repaid/defaulted loan from ledger |

### Multi-sign for LoanSet

`LoanSet` requires both broker and borrower signatures. Since this is a demo app controlling all wallets server-side:

1. Broker signs the transaction with `wallet.sign()`
2. Borrower counter-signs with `xrpl.signLoanSetByCounterparty(borrowerWallet, brokerSignedBlob)`
3. Fully-signed blob is submitted to the ledger

### Cleanup Order

Ledger objects must be deleted in dependency order:

```
Default active loans (LoanManage) → LoanDelete → LoanBrokerCoverWithdraw → LoanBrokerDelete → VaultDelete
```

Attempting to delete out of order returns `tecHAS_OBLIGATIONS`.

## API Routes

### Session

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/session` | Create session — generates 3 wallets, funds via faucet |
| `GET` | `/api/session?id=` | Fetch existing session |
| `GET` | `/api/session/balances?sessionId=` | Fetch live wallet balances from ledger |
| `POST` | `/api/session/topup` | Re-fund wallets via faucet |

### Vault

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/vault` | Create vault (VaultCreate) |
| `GET` | `/api/vault?sessionId=` | List vaults with live `vault_info` enrichment |
| `GET` | `/api/vault/[id]` | Get single vault details |
| `POST` | `/api/vault/deposit` | Deposit XRP (VaultDeposit) |
| `POST` | `/api/vault/withdraw` | Withdraw XRP (VaultWithdraw) |
| `POST` | `/api/vault/delete` | Delete vault (VaultDelete) |
| `GET` | `/api/vault/history?sessionId=` | Deposit/withdraw history with PNL |

### Broker

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/broker` | Create/update broker (LoanBrokerSet) + cover deposit |
| `DELETE` | `/api/broker` | Delete broker (cover withdraw + LoanBrokerDelete) |

### Loan

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/loan` | Create loan (LoanSet, multi-signed) |
| `GET` | `/api/loan?sessionId=` | List loans with on-chain sync |
| `GET` | `/api/loan/[id]` | Get single loan details from ledger |
| `POST` | `/api/loan/repay` | Repay loan (LoanPay) |
| `GET` | `/api/loan/default` | Default a loan (LoanManage + tfLoanDefault) |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Landing page (3D hero, email login)
│   ├── terms/page.tsx              # Terms of service
│   ├── dashboard/
│   │   ├── layout.tsx              # Dashboard shell (header, tabs, footer)
│   │   ├── page.tsx                # Dashboard redirect
│   │   ├── broker/
│   │   │   ├── page.tsx            # Broker dashboard (stepper flow)
│   │   │   ├── create-vault.tsx    # Vault creation form
│   │   │   ├── vault-details.tsx   # Live vault state display
│   │   │   ├── issue-loan.tsx      # Loan issuance with all fee options
│   │   │   └── manage-loans.tsx    # Loan list, default, delete, cleanup
│   │   ├── depositor/
│   │   │   ├── page.tsx            # Depositor dashboard
│   │   │   ├── deposit-form.tsx    # Deposit into vault
│   │   │   ├── withdraw-form.tsx   # Withdraw from vault
│   │   │   └── history.tsx         # Deposit history with PNL
│   │   └── borrower/
│   │       ├── page.tsx            # Borrower dashboard
│   │       ├── repayment.tsx       # Repayment form (installment/full/custom)
│   │       └── loan-history.tsx    # Loan history and status
│   └── api/                        # All API routes (see API Routes section)
├── components/
│   ├── ui/                         # shadcn/ui + Aceternity + Magic UI components
│   ├── session-header.tsx          # Header with wallet dropdown + balances
│   ├── session-provider.tsx        # Session context provider
│   ├── role-tabs.tsx               # Broker / Depositor / Borrower navigation
│   ├── transaction-status.tsx      # Success/error/pending with explorer link
│   ├── wallet-badge.tsx            # Truncated address + copy + explorer link
│   ├── fee-breakdown.tsx           # Loan cost visualization
│   ├── amount-display.tsx          # Drops → XRP formatting
│   ├── loan-status-badge.tsx       # Active/repaid/defaulted/closed badge
│   ├── step-indicator.tsx          # Multi-step broker flow indicator
│   ├── footer.tsx                  # Site footer
│   ├── theme-provider.tsx          # Dark/light mode
│   └── theme-toggle.tsx            # Theme switch
├── hooks/
│   └── use-session.ts              # Session context + localStorage persistence
├── lib/
│   ├── xrpl/                       # XRPL client, wallet, vault/broker/loan helpers
│   │   ├── client.ts               # WebSocket connection management
│   │   ├── wallet.ts               # Wallet generation + faucet funding
│   │   ├── vault.ts                # Vault tx builders + vault_info
│   │   ├── broker.ts               # Broker tx builders + cover management
│   │   └── loan.ts                 # Loan tx builders + multi-sign + loan info
│   ├── db/                         # MongoDB connection + Mongoose models
│   │   ├── connection.ts           # Connection pooling
│   │   └── models/                 # Session, Vault, Loan, DepositHistory
│   ├── constants.ts                # Network URLs, default loan terms
│   ├── explorer.ts                 # Devnet explorer URL helpers
│   ├── validation.ts               # Input validation (drops, numbers, addresses, IDs)
│   ├── api-error.ts                # Error message extraction
│   └── utils.ts                    # cn() classname utility
└── types/
    ├── session.ts                  # Session + WalletInfo types
    ├── vault.ts                    # VaultState type
    └── loan.ts                     # LoanState type
```

## Security

### Input Validation
All API routes validate inputs server-side before building transactions:
- **Amounts**: validated as positive numeric strings (drops)
- **Numbers**: validated within acceptable ranges
- **Addresses**: validated as proper XRPL classic addresses
- **IDs**: validated as hex strings of correct length
- **Strings**: sanitized to remove control characters

### On-chain Verification
- All state is verified against the ledger after every transaction
- Transaction results are checked for `tesSUCCESS` before updating any cache
- Failed transactions surface the exact XRPL error code to the user

### Wallet Seeds
This is a **demo/template application** where the server controls all three wallets (Broker, Depositor, Borrower). Wallet seeds are generated server-side and stored in MongoDB. They are exposed to the frontend only for display purposes (showing addresses in `WalletBadge` components). In a production lending application, each role would be a separate user with their own wallet — seeds would never leave the client.

## Environment Variables

```env
XRPL_NETWORK_URL=wss://s.devnet.rippletest.net:51233/
XRPL_FAUCET_URL=https://faucet.devnet.rippletest.net/accounts
MONGODB_URI=mongodb+srv://...
```

## References

- [XLS-66 Lending Protocol Spec](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol)
- [XLS-65 Single Asset Vault Spec](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0065-single-asset-vault)
- [XRPL Lending Protocol Docs](https://xrpl.org/docs/concepts/tokens/lending-protocol)
- [XRPL Single Asset Vault Docs](https://xrpl.org/docs/concepts/tokens/single-asset-vaults)
- [XRPL Devnet Explorer](https://devnet.xrpl.org)
- [xrpl.js Documentation](https://js.xrpl.org)

## License

ISC
