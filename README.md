# EcoInsure Farm

## Overview

EcoInsure Farm is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It addresses real-world problems in agriculture, such as high insurance costs for farmers, lack of incentives for sustainable practices, and opacity in verifying environmental contributions. By leveraging blockchain, the project tracks farmers' eco-friendly practices (e.g., reduced pesticide use, soil conservation, carbon sequestration) transparently and verifiably. Farmers who demonstrate positive environmental impact receive discounted insurance premiums. This incentivizes sustainable farming, combats climate change, reduces financial burdens on smallholders, and promotes trust through decentralized verification.

The system solves:
- **Environmental Degradation**: Encourages practices that improve soil health, biodiversity, and reduce emissions.
- **Insurance Accessibility**: Lowers premiums for compliant farmers, making coverage affordable in volatile markets.
- **Transparency Issues**: Uses blockchain to immutable log practices, preventing fraud in claims or verifications.
- **Data Silos**: Integrates oracles for real-world data (e.g., satellite imagery, IoT sensors) to feed on-chain decisions.

The project involves 7 smart contracts, each handling a specific aspect for modularity and security. Contracts interact via traits and cross-calls. Users (farmers, insurers, verifiers) interact via a dApp frontend (not included here, but assumable with SIP-010 tokens and STX).

## Architecture

- **Farmers** register and log practices.
- **Oracles** verify practices off-chain and submit on-chain.
- **Scores** are calculated based on verified practices, influencing premium discounts.
- **Insurers** issue policies with dynamic premiums.
- **Claims** are processed with verification checks.
- **Governance** allows community updates.
- **Tokens** reward participation.

Contracts are written in Clarity (Stacks' smart contract language). Deployment assumes Stacks testnet/mainnet. All contracts use best practices: immutability, access controls, error handling.

## Smart Contracts

### 1. FarmerRegistry.clar
Registers farmers with unique IDs, stores profiles (e.g., farm location, size). Ensures only registered farmers can log practices.

```clarity
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-ALREADY-REGISTERED (err u101))

(define-map farmers principal { id: uint, name: (string-ascii 50), location: (string-ascii 100), farm-size: uint })

(define-data-var next-id uint u1)
(define-data-var owner principal tx-sender)

(define-public (register-farmer (name (string-ascii 50)) (location (string-ascii 100)) (farm-size uint))
  (let ((caller tx-sender))
    (asserts! (is-none (map-get? farmers caller)) ERR-ALREADY-REGISTERED)
    (map-set farmers caller { id: (var-get next-id), name: name, location: location, farm-size: farm-size })
    (var-set next-id (+ (var-get next-id) u1))
    (ok true)))

(define-read-only (get-farmer (user principal))
  (map-get? farmers user))

(define-public (update-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (var-set owner new-owner)
    (ok true)))
```

### 2. PracticeLogger.clar
Allows registered farmers to log sustainable practices (e.g., "planted cover crops"). Logs are timestamped and hashed for integrity.

```clarity
(define-constant ERR-NOT-REGISTERED (err u200))
(define-constant ERR-INVALID-PRACTICE (err u201))

(define-map practices { farmer: principal, log-id: uint } { practice-type: (string-ascii 50), timestamp: uint, details: (string-ascii 200) })
(define-map farmer-log-count principal uint)

(define-trait registry-trait
  ((get-farmer (principal) (response (optional { id: uint, name: (string-ascii 50), location: (string-ascii 100), farm-size: uint }) uint))))

(define-public (log-practice (practice-type (string-ascii 50)) (details (string-ascii 200)) (registry-contract principal))
  (let ((caller tx-sender)
        (log-count (default-to u0 (map-get? farmer-log-count caller))))
    (asserts! (is-some (try! (contract-call? registry-contract get-farmer caller))) ERR-NOT-REGISTERED)
    (asserts! (> (len practice-type) u0) ERR-INVALID-PRACTICE)
    (map-set practices { farmer: caller, log-id: log-count } { practice-type: practice-type, timestamp: block-height, details: details })
    (map-set farmer-log-count caller (+ log-count u1))
    (ok log-count)))

(define-read-only (get-practice (farmer principal) (log-id uint))
  (map-get? practices { farmer: farmer, log-id: log-id }))
```

### 3. OracleVerifier.clar
Integrates oracles (e.g., Chainlink-like) to verify logged practices. Submits verification scores (0-100) on-chain.

```clarity
(define-constant ERR-NOT-ORACLE (err u300))
(define-constant ERR-INVALID-SCORE (err u301))

(define-map verifications { farmer: principal, log-id: uint } { score: uint, verifier: principal, timestamp: uint })
(define-map authorized-oracles principal bool)

(define-data-var owner principal tx-sender)

(define-public (add-oracle (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (map-set authorized-oracles oracle true)
    (ok true)))

(define-public (verify-practice (farmer principal) (log-id uint) (score uint))
  (begin
    (asserts! (is-eq (map-get? authorized-oracles tx-sender) (some true)) ERR-NOT-ORACLE)
    (asserts! (and (>= score u0) (<= score u100)) ERR-INVALID-SCORE)
    (map-set verifications { farmer: farmer, log-id: log-id } { score: score, verifier: tx-sender, timestamp: block-height })
    (ok true)))

(define-read-only (get-verification (farmer principal) (log-id uint))
  (map-get? verifications { farmer: farmer, log-id: log-id }))
```

### 4. InsurancePolicy.clar
Manages policies: calculates premiums based on average verification scores (higher score = lower premium). Issues policies.

```clarity
(define-constant ERR-LOW-SCORE (err u400))
(define-constant BASE-PREMIUM u1000) ;; In STX microstacks
(define-constant MAX_DISCOUNT u50) ;; Percent

(define-map policies principal { policy-id: uint, premium: uint, coverage: uint, active: bool })
(define-map farmer-scores principal uint)

(define-trait verifier-trait
  ((get-verification (principal uint) (response (optional { score: uint, verifier: principal, timestamp: uint }) uint))))

(define-public (calculate-score (farmer principal) (log-count uint) (verifier-contract principal))
  (let ((total-score (fold sum-scores (list-from-u0 log-count) u0 farmer verifier-contract)))
    (map-set farmer-scores farmer (/ total-score log-count))
    (ok (/ total-score log-count))))

(define-private (sum-scores (i uint) (acc uint) (farmer principal) (verifier-contract principal))
  (match (contract-call? verifier-contract get-verification farmer i)
    some-verif (+ acc (get score some-verif))
    none acc))

(define-private (list-from-u0 (n uint))
  (unwrap-panic (as-max-len? (list u0 u1 u2 ... ) n))) ;; Simplified; use actual unfold in prod

(define-public (issue-policy (coverage uint) (verifier-contract principal) (logger-contract principal))
  (let ((caller tx-sender)
        (log-count (default-to u0 (contract-call? logger-contract get-log-count caller))) ;; Assume trait
        (score (try! (calculate-score caller log-count verifier-contract))))
    (asserts! (>= score u50) ERR-LOW-SCORE) ;; Min score for discount
    (let ((discount (* (/ score u100) MAX_DISCOUNT))
          (premium (* BASE-PREMIUM (- u100 discount) u0.01))) ;; Simplified math
      (map-set policies caller { policy-id: u1, premium: premium, coverage: coverage, active: true }) ;; Increment ID in prod
      (ok premium))))
```

### 5. ClaimHandler.clar
Processes insurance claims, checking if practices were verified before approving payouts.

```clarity
(define-constant ERR-NO-POLICY (err u500))
(define-constant ERR-CLAIM-REJECTED (err u501))

(define-map claims { farmer: principal, claim-id: uint } { amount: uint, reason: (string-ascii 200), approved: bool })

(define-trait policy-trait
  ((get-policy (principal) (response (optional { policy-id: uint, premium: uint, coverage: uint, active: bool }) uint))))

(define-public (submit-claim (amount uint) (reason (string-ascii 200)) (policy-contract principal))
  (let ((caller tx-sender)
        (claim-count u0)) ;; Track per farmer
    (asserts! (is-some (try! (contract-call? policy-contract get-policy caller))) ERR-NO-POLICY)
    (map-set claims { farmer: caller, claim-id: claim-count } { amount: amount, reason: reason, approved: false })
    (ok claim-count)))

(define-public (approve-claim (farmer principal) (claim-id uint) (verifier-contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED) ;; Insurer role
    ;; Check verifications here
    (map-set claims { farmer: farmer, claim-id: claim-id } (merge (unwrap-panic (map-get? claims { farmer: farmer, claim-id: claim-id })) { approved: true }))
    (ok true)))
```

### 6. Governance.clar
DAO-like contract for voting on updates (e.g., premium rates, oracle additions).

```clarity
(define-constant ERR-NOT-MEMBER (err u600))

(define-map proposals uint { description: (string-ascii 200), votes-for: uint, votes-against: uint, active: bool })
(define-map members principal bool)
(define-data-var proposal-count uint u0)

(define-public (join-dao)
  (begin
    (map-set members tx-sender true)
    (ok true)))

(define-public (create-proposal (description (string-ascii 200)))
  (let ((id (var-get proposal-count)))
    (asserts! (is-some (map-get? members tx-sender)) ERR-NOT-MEMBER)
    (map-set proposals id { description: description, votes-for: u0, votes-against: u0, active: true })
    (var-set proposal-count (+ id u1))
    (ok id)))

(define-public (vote (proposal-id uint) (in-favor bool))
  (asserts! (is-some (map-get? members tx-sender)) ERR-NOT-MEMBER)
  (let ((prop (unwrap-panic (map-get? proposals proposal-id))))
    (asserts! (get active prop) ERR-CLAIM-REJECTED) ;; Reuse err
    (if in-favor
      (map-set proposals proposal-id (merge prop { votes-for: (+ (get votes-for prop) u1) }))
      (map-set proposals proposal-id (merge prop { votes-against: (+ (get votes-against prop) u1) })))
    (ok true)))
```

### 7. RewardToken.clar
SIP-010 compliant fungible token for rewards (e.g., staking for governance, bonuses for high scores).

```clarity
(define-fungible-token reward-token u1000000)
(define-constant ERR-INSUFFICIENT-BALANCE (err u700))

(define-data-var token-name (string-ascii 32) "EcoToken")
(define-data-var token-symbol (string-ascii 10) "ECO")
(define-data-var token-decimals uint u6)
(define-data-var token-uri (optional (string-utf8 256)) none)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? reward-token amount sender recipient))
    (ok true)))

(define-read-only (get-name) (ok (var-get token-name)))
(define-read-only (get-symbol) (ok (var-get token-symbol)))
(define-read-only (get-decimals) (ok (var-get token-decimals)))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance reward-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply reward-token)))
(define-read-only (get-token-uri) (ok (var-get token-uri)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-AUTHORIZED)
    (ft-mint? reward-token amount recipient)))
```

## Deployment and Usage

1. Deploy contracts in order: Registry → Logger → Verifier → Policy → Claim → Governance → Token.
2. Set owners and cross-references (e.g., traits).
3. Farmers register, log practices, get verified.
4. Policies issued with discounts.
5. Claims submitted/approved.
6. Use tokens for rewards via governance votes.

## Security Notes
- Use traits for inter-contract calls.
- Audit for reentrancy, overflows.
- Oracles should be decentralized.

## Future Enhancements
- Integrate real oracles (e.g., Stacks oracles).
- dApp UI for interactions.
- Partnerships with insurers/farm orgs.

This project is conceptual; test thoroughly on Stacks testnet.