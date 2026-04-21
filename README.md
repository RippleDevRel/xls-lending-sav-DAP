# XLS-66 Lending Protocol & XLS-65 SAV — DAP

A full-stack reference implementation of the XRP Ledger's lending amendments:
[**XLS-66** (Lending Protocol)](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol)
and [**XLS-65** (Single Asset Vault)](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0065-single-asset-vault).
Built as an open-source template for fintechs, asset managers, and devs who want a working starting point for lending/borrowing products on XRPL.

- Three roles — **Loan Broker**, **Depositor**, **Borrower** — each with a
  dedicated dashboard and wallet.
- Full loan lifecycle: origination (multi-sign), regular / late / early-full /
  overpayment repayment modes, default, and cleanup.
- Three asset types supported: **XRP**, **IOU**, **MPT** (XLS-33).
- On-chain correctness verified against the latest XLS-66 / XLS-65 / XLS-33
  master specs; every non-obvious calculation has a spec-section reference in
  the code.

## Quick Start

```bash
cp .env.example .env.local              # then edit MONGODB_URI
npm install
npm run dev                              # http://localhost:3000
```

Log in with any email/password. On first login the server generates four
wallets (broker, depositor, borrower, issuer), funds them via the devnet
faucet, and persists seeds in MongoDB for the session.

## Environment variables

| Variable           | Default                                              | Purpose                                   |
| ------------------ | ---------------------------------------------------- | ----------------------------------------- |
| `XRPL_NETWORK_URL` | `wss://s.devnet.rippletest.net:51233/`               | WebSocket endpoint                |
| `XRPL_FAUCET_URL`  | `https://faucet.devnet.rippletest.net/accounts`      | Devnet faucet                             |
| `MONGODB_URI`      | *(required, no default)*                             | Full MongoDB connection string            |

See `.env.example`. Network and faucet default to Devnet because XLS-66/65 are
only enabled there at the time of writing.

## Tech stack

- **Framework** – Next.js 16 (App Router, React 19, TypeScript, Turbopack)
- **Auth proxy** – `src/proxy.ts` (Next 16 convention, replaces `middleware`)
- **UI** – Tailwind CSS v4, shadcn/ui, Aceternity UI, Magic UI, Motion
- **XRPL** – xrpl.js v4 (includes XLS-65/66/33 validators and flag enums)
- **Database** – MongoDB (Mongoose) — see "On-chain vs off-chain" below

## Architecture: on-chain vs off-chain

**The XRPL ledger is the source of truth.** MongoDB caches only what's needed
to bridge HTTP requests between transactions.

### Written to the ledger

| Object / Tx                           | Path                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `Vault` (XLS-65)                      | `VaultCreate` / `VaultDeposit` / `VaultWithdraw` / `VaultDelete` |
| `LoanBroker` (XLS-66)                 | `LoanBrokerSet` / `LoanBrokerCoverDeposit` / `LoanBrokerCoverWithdraw` / `LoanBrokerDelete` |
| `Loan` (XLS-66)                       | `LoanSet` (multi-sign) / `LoanPay` / `LoanManage` / `LoanDelete` |
| `MPTokenIssuance` + `MPToken` (XLS-33) | `MPTokenIssuanceCreate` / `MPTokenAuthorize`            |
| IOU trust lines                       | `TrustSet` + `AccountSet` (`asfDefaultRipple`)          |
| Faucet top-ups, peer transfers        | `Payment`                                               |

### Read from the ledger on every request

| Data                                               | Method                                   |
| -------------------------------------------------- | ---------------------------------------- |
| Wallet XRP balance                                 | `account_info` → `Balance`               |
| IOU balance                                        | `account_lines` filtered by issuer       |
| MPT balance                                        | `account_objects` type `mptoken`         |
| Vault state (`AssetsTotal`, shares, MPTID, …)      | `vault_info` (returns the full entry)    |
| Loan / LoanBroker state                            | `ledger_entry` with the object id        |
| Validated close time (for interest accrual)        | `ledger` with `ledger_index: "validated"` |

### Stored off-chain (MongoDB, `src/lib/db/models/`)

| Collection       | Role                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| `Session`        | Email, password hash (scrypt), generated wallet seeds, current `vaultId` / `loanBrokerId` / `issuedToken` discriminator. **Seeds never leave the server.** |
| `Vault`          | Session ↔ `vaultId` mapping + asset record + cached `totalDeposited` / `sharesMinted`. Refreshed from `vault_info` on read. |
| `Loan`           | Session ↔ `loanId` mapping + immutable loan terms (copied from the `LoanSet` payload at origination) + cached `paymentsRemaining` / `principalOutstanding` / `status`. |
| `DepositHistory` | Audit trail of every `VaultDeposit` / `VaultWithdraw`, with tx hash, amount, type, timestamp. Used for PNL in the depositor view. |

**MongoDB is never the source of truth for balances or state** — every
protected route re-reads the ledger after a tx and after a page load. The DB
exists so the frontend can render without doing a full ledger scan on every
render and so historical tx data survives the ephemeral `Loan` / `Vault`
ledger entries (they're deleted at cleanup).

### Sync flow after a write

```
1. Build tx with lib/xrpl builders (buildVaultCreate, buildLoanSet, …)
2. Sign (or multi-sign for LoanSet)
3. submitAndWait → ledger processes in next close
4. assertTxSuccess() checks meta.TransactionResult === "tesSUCCESS"
5. Re-query the ledger (vault_info / ledger_entry) for fresh state
6. Update the matching Mongo document with the unscaled on-chain values
7. Return the tx hash + minimal cache to the client
```

## Amount conventions (important for forkers)

The three supported asset types represent amounts differently on-chain; the
template normalizes this at API boundaries:

| Asset | On-ledger                                   | DB / API payloads                     |
| ----- | ------------------------------------------- | ------------------------------------- |
| XRP   | integer **drops** (1 XRP = 1 000 000 drops) | drops                                 |
| IOU   | decimal string, up to 16 sig figs           | decimal string                        |
| MPT   | integer, scaled by `AssetScale` (demo = 2)  | **decimal string** (scaled at tx boundary) |

MPT scaling is the only place the client and the ledger disagree. Helpers in
`src/lib/xrpl/helpers.ts` scale / unscale at the exact two boundaries where
this matters:

- `buildAmountField(issuedToken, humanAmount)` — builds the `Amount` field
  for `VaultDeposit` / `VaultWithdraw` / `LoanPay` / `Payment` and scales
  up for MPT.
- `unscaleVaultNodeForMPT(vault, isMPT)` / `unscaleLoanNodeForMPT(node, isMPT)`
  scale down every amount-typed field before the API returns a ledger entry
  to the client.

Rate fields (`InterestRate`, `LateInterestRate`, `CloseInterestRate`,
`OverpaymentInterestRate`, `OverpaymentFee`, `ManagementFeeRate`,
`CoverRateMinimum`, `CoverRateLiquidation`) are always in **1/10 bps** on the
ledger (1 unit = 0.001%). Conversions live in `src/lib/constants.ts`:

```ts
percentToTenthBps(1)   // 1000        — UI % → on-chain units
bpsToTenthBps(500)     // 5000        — stored bps → on-chain units
tenthBpsToPercent(5000) // 5          — on-chain units → display %
```

## Loan math

All spec-critical calculations live in `src/lib/loan-math.ts` and are
deliberately isolated from UI and network code so they're easy to reuse
server-side or port to other clients.

| Function                 | XLS-66 reference            | Output                      |
| ------------------------ | --------------------------- | --------------------------- |
| `amortize(...)`          | §A-2.1 formulas (5)–(7)     | `{ periodicPayment, totalOutstanding, totalInterest }` |
| `earlyFullPayment(...)`  | §A-3.2.4 (early close)      | `{ accruedInterest, prepaymentPenalty, totalDue }` |
| `latePayment(...)`       | §A-3.2.2 (late payment)     | `{ lateInterest, totalDue }`                  |

For full-repay and late-repay modes the server re-computes the total on the
latest validated ledger close time via
`computeFullPaymentAmount` / `computeLatePaymentAmount` in
`src/lib/xrpl/helpers.ts`, so client clock drift can't push the amount below
the ledger's threshold.

## LoanPay flags (XLS-66 §A-3.3)

| Flag                  | Value      | When we set it                                                     |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| `tfLoanLatePayment`   | `0x040000` | Auto-set when `now > Loan.NextPaymentDueDate`                       |
| `tfLoanFullPayment`   | `0x020000` | UI "Pay in full" mode                                              |
| `tfLoanOverpayment`   | `0x010000` | UI "Overpayment" mode; loan must have been created with `tfLoanOverpayment` set on `LoanSet` |

Without the appropriate flag the ledger either rejects the tx or falls
through to the regular-installment path, which is why the close fees / late
fees configured at origination don't appear to be enforced unless the flag is
present.

## Cleanup order

Deleting a vault requires dismantling the dependency chain first:

```
For each active loan:
LoanManage (tfLoanDefault) → LoanDelete
LoanBrokerCoverWithdraw
LoanBrokerDelete
VaultDelete
```

`/api/vault/delete` runs this entire sequence in one call. Any out-of-order
step surfaces as `tecHAS_OBLIGATIONS`.

## User flow

```
Login (email) → 4 wallets created + faucet-funded
 ├── Broker    → Create vault → Register broker (+ first-loss cover) → Issue loan → Manage / default
 ├── Depositor → Deposit → Track PNL → Withdraw
 └── Borrower  → View loan → Make payment (installment / late / full / overpayment / custom)
```

## API surface

All routes below are described by an **OpenAPI 3.1** spec at
[`docs/openapi.yaml`](./docs/openapi.yaml). While running the dev server
the same file is served from:

- `GET /api/openapi` — raw YAML (or JSON with `Accept: application/json`)
- `GET /api/docs` — Swagger UI rendering of the spec

All routes are protected by `src/proxy.ts` — a valid `xls66-auth`
cookie (MongoDB ObjectId of the session) is required. `sessionId` is read
from the cookie, never the body, so cross-session IDOR is impossible.
Public exceptions: `POST /api/session`, `GET /api/openapi`, `GET /api/docs`,
and the `/terms` page.

### Session

| Method   | Route                     | Description                                     |
| -------- | ------------------------- | ----------------------------------------------- |
| `POST`   | `/api/session`            | Register or login (scrypt-verified)             |
| `GET`    | `/api/session/me`         | Cookie-only probe; no ledger roundtrip          |
| `GET`    | `/api/session/balances`   | XRP + IOU + MPT balances for each role          |
| `POST`   | `/api/session/topup`      | Re-fund every role from the devnet faucet       |
| `POST`   | `/api/session/transfer`   | Peer transfer between role wallets              |
| `POST`   | `/api/session/logout`     | Clear cookie                                    |

### Vault (XLS-65)

| Method   | Route                   | Description                                      |
| -------- | ----------------------- | ------------------------------------------------ |
| `POST`   | `/api/vault`            | `VaultCreate` (+ IOU/MPT bootstrap if needed)    |
| `GET`    | `/api/vault`            | List active vaults with live `vault_info`        |
| `GET`    | `/api/vault/[id]`       | Single vault detail (unscaled for MPT)           |
| `POST`   | `/api/vault/deposit`    | `VaultDeposit`                                   |
| `POST`   | `/api/vault/withdraw`   | `VaultWithdraw`                                  |
| `POST`   | `/api/vault/delete`     | Full teardown: loans → broker → vault            |
| `GET`    | `/api/vault/history`    | Deposit / withdraw audit log + PNL summary       |

### Broker (XLS-66)

| Method   | Route            | Description                                 |
| -------- | ---------------- | ------------------------------------------- |
| `POST`   | `/api/broker`    | `LoanBrokerSet` + optional `LoanBrokerCoverDeposit` |
| `DELETE` | `/api/broker`    | `LoanBrokerDelete` (caller must withdraw cover first) |

### Loan (XLS-66)

| Method | Route                   | Description                                                  |
| ------ | ----------------------- | ------------------------------------------------------------ |
| `POST` | `/api/loan`             | `LoanSet` with broker+borrower multi-sign                    |
| `GET`  | `/api/loan`             | List with on-chain sync                                      |
| `GET`  | `/api/loan/[id]`        | Single loan / LoanBroker entry (unscaled for MPT)            |
| `POST` | `/api/loan/repay`       | `LoanPay` — `mode: "full" \| "late" \| "overpayment" \| "regular"` |
| `POST` | `/api/loan/default`     | `LoanManage` (`tfLoanDefault`) or `LoanDelete` (`action: "close"`) |

## Project layout

```
src/
├── app/
│   ├── page.tsx, terms/page.tsx, layout.tsx
│   ├── dashboard/
│   │   ├── layout.tsx, page.tsx
│   │   ├── broker/     (create-vault, vault-details, issue-loan, manage-loans, actions.ts)
│   │   ├── depositor/  (deposit-form, withdraw-form, history)
│   │   └── borrower/   (repayment, loan-history)
│   └── api/
│       ├── session/    (route, me, balances, topup, transfer, logout)
│       ├── vault/      (route, [id], deposit, withdraw, delete, history)
│       ├── broker/     (route)
│       └── loan/       (route, [id], repay, default)
├── proxy.ts                      # Next 16 auth gate (was middleware.ts)
├── components/                   # Domain + UI primitives (ui/*)
├── hooks/use-session.ts          # Client session context
├── lib/
│   ├── xrpl/                     # ALL XRPL interaction lives here
│   │   ├── client.ts             # Connection singleton
│   │   ├── wallet.ts             # Generation + faucet funding
│   │   ├── vault.ts              # XLS-65 tx builders + submitTransaction
│   │   ├── broker.ts             # LoanBroker* tx builders
│   │   ├── loan.ts               # XLS-66 tx builders + multi-sign + flag enums
│   │   ├── issuer.ts             # IOU / MPT bootstrap for demo
│   │   ├── helpers.ts            # Role wallet, amount scaling, close-time, server-side compute
│   │   └── index.ts              # Barrel export
│   ├── db/                       # Mongoose models + pooled connection
│   ├── loan-math.ts              # XLS-66 amortization / late / early-full formulas
│   ├── constants.ts              # Network URLs, MPT scale, rate conversions, defaults
│   ├── auth.ts                   # scrypt password + cookie helpers
│   ├── validation.ts             # Route-input validators
│   ├── explorer.ts               # Devnet explorer URL helpers
│   └── utils.ts, api-error.ts
└── types/                        # Session, Vault, Loan shared types
```

## Security notes

> ### ⚠️ Wallet seeds are stored in **plaintext** in MongoDB
>
> The four per-session wallets (broker, depositor, borrower, issuer) are
> generated server-side and persisted **as-is** in the `Session.wallets`
> array (see `src/lib/db/models/session.ts`: `seed`, `privateKey`,
> `publicKey` fields). That's acceptable for a Devnet template because
> the wallets only ever hold test-net XRP / IOUs / MPTs with no monetary
> value.
>
> **Before shipping any fork to production you must:**
>
> 1. **Never reuse these generated wallets on Testnet or Mainnet.** Seeds
>    that transit the DB, the app server, and (in the current flow) the
>    client-side session lookup should be treated as compromised.
> 2. **Replace the storage model.** Encrypt seeds at rest with a KMS
>    (AWS KMS, Google Cloud KMS, HashiCorp Vault…), or — preferred — move
>    wallet key material out of the server entirely: have each real user
>    hold their own wallet in a browser extension / hardware wallet and
>    co-sign transactions client-side. `LoanSet` already supports multi-sign
>    via `xrpl.signLoanSetByCounterparty`.
> 3. **Re-scope access.** The current demo exposes `session.wallets[*].seed`
>    to the authenticated client for display convenience. Any production
>    rewrite should stop returning seeds from `/api/session/me` and friends
>    altogether.

- **Password storage**: scrypt + random 16-byte salt, compared with
  `timingSafeEqual`. See `src/lib/auth.ts`.
- **Session routing**: `sessionId` always read from the httpOnly cookie,
  never from a request body or query — `src/proxy.ts` gates every API route
  and `requireAuthSession()` re-validates on the handler.
- **Server-side validation**: every amount / number / id is validated before
  being used in a tx. See `src/lib/validation.ts`.
- **On-chain verification**: `assertTxSuccess(result, txType)` throws on
  anything other than `tesSUCCESS`, so the DB never records an assumed state.
- **Demo wallets are server-controlled.** Beyond the plaintext-seed issue
  above, a real lending product wouldn't give one server custody of the
  broker, depositor, and borrower keys at the same time — each role should
  be a distinct user with their own wallet.

## Out of scope (TBD)

- Private vaults with `PermissionedDomain` credentials (XLS-80)
- Collateralized loans using `TokenEscrow` (XLS-85)
- Batch issuance with XLS-56
- Secondary share market (vault share trading)

## References

- **Specs** — [XLS-65 Single Asset Vault](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0065-single-asset-vault) · [XLS-66 Lending Protocol](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol) · [XLS-33 Multi-Purpose Tokens](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0033-multi-purpose-tokens) · [XLS-89 MPT Metadata](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0089-metadata-for-mpt)
- **Docs** — [xrpl.org lending concepts](https://xrpl.org/docs/concepts/tokens/lending-protocol) · [xrpl.org single-asset vaults](https://xrpl.org/docs/concepts/tokens/single-asset-vaults)
- **Tools** — [xrpl.js](https://js.xrpl.org) · [Devnet Explorer](https://devnet.xrpl.org)

## License

ISC
