;; FarmerRegistry.clar
;; This contract manages farmer registrations with detailed profiles, verification processes,
;; and administrative controls. It serves as the foundational registry for the EcoInsure Farm project,
;; ensuring only verified farmers can participate in sustainable practice logging and insurance benefits.

;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-ALREADY-REGISTERED u101)
(define-constant ERR-INVALID-INPUT u102)
(define-constant ERR-NOT-REGISTERED u103)
(define-constant ERR-NOT-VERIFIED u104)
(define-constant ERR-ALREADY-VERIFIED u105)
(define-constant ERR-INVALID-STATUS u106)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var registration-fee uint u1000000) ;; 1 STX in microstacks
(define-data-var verifier principal tx-sender) ;; Initial verifier is owner

;; Data Maps
(define-map farmers principal 
  {
    id: uint,
    name: (string-ascii 100),
    location: (string-ascii 200),
    farm-size: uint, ;; in acres
    registration-timestamp: uint,
    verification-status: (string-ascii 20), ;; "pending", "verified", "rejected"
    verification-timestamp: (optional uint),
    additional-info: (string-utf8 500),
    active: bool
  }
)

(define-map farmer-ids uint principal) ;; Reverse lookup for ID to principal

(define-data-var next-farmer-id uint u1)

;; Private Functions
(define-private (is-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (is-verifier (caller principal))
  (is-eq caller (var-get verifier))
)

(define-private (pay-fee)
  (try! (stx-transfer? (var-get registration-fee) tx-sender (as-contract tx-sender)))
)

;; Public Functions

;; Register a new farmer with detailed profile
(define-public (register-farmer 
  (name (string-ascii 100)) 
  (location (string-ascii 200)) 
  (farm-size uint)
  (additional-info (string-utf8 500)))
  (let 
    (
      (caller tx-sender)
      (current-id (var-get next-farmer-id))
    )
    (asserts! (is-none (map-get? farmers caller)) (err ERR-ALREADY-REGISTERED))
    (asserts! (> (len name) u0) (err ERR-INVALID-INPUT))
    (asserts! (> (len location) u0) (err ERR-INVALID-INPUT))
    (asserts! (> farm-size u0) (err ERR-INVALID-INPUT))
    (try! (pay-fee))
    (map-set farmers caller 
      {
        id: current-id,
        name: name,
        location: location,
        farm-size: farm-size,
        registration-timestamp: block-height,
        verification-status: "pending",
        verification-timestamp: none,
        additional-info: additional-info,
        active: true
      }
    )
    (map-set farmer-ids current-id caller)
    (var-set next-farmer-id (+ current-id u1))
    (print { event: "farmer-registered", farmer: caller, id: current-id })
    (ok current-id)
  )
)

;; Verify a farmer's registration
(define-public (verify-farmer (farmer principal) (status (string-ascii 20)))
  (let 
    (
      (caller tx-sender)
      (profile (map-get? farmers farmer))
    )
    (asserts! (is-verifier caller) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-some profile) (err ERR-NOT-REGISTERED))
    (asserts! (or (is-eq status "verified") (is-eq status "rejected")) (err ERR-INVALID-STATUS))
    (asserts! (is-eq (get verification-status (unwrap-panic profile)) "pending") (err ERR-ALREADY-VERIFIED))
    (map-set farmers farmer 
      (merge (unwrap-panic profile) 
        {
          verification-status: status,
          verification-timestamp: (some block-height)
        }
      )
    )
    (print { event: "farmer-verified", farmer: farmer, status: status })
    (ok true)
  )
)

;; Update farmer profile (only by farmer after verification)
(define-public (update-profile 
  (name (optional (string-ascii 100))) 
  (location (optional (string-ascii 200))) 
  (farm-size (optional uint))
  (additional-info (optional (string-utf8 500))))
  (let 
    (
      (caller tx-sender)
      (profile (map-get? farmers caller))
    )
    (asserts! (is-some profile) (err ERR-NOT-REGISTERED))
    (asserts! (is-eq (get verification-status (unwrap-panic profile)) "verified") (err ERR-NOT-VERIFIED))
    (map-set farmers caller 
      (merge (unwrap-panic profile) 
        {
          name: (default-to (get name (unwrap-panic profile)) name),
          location: (default-to (get location (unwrap-panic profile)) location),
          farm-size: (default-to (get farm-size (unwrap-panic profile)) farm-size),
          additional-info: (default-to (get additional-info (unwrap-panic profile)) additional-info)
        }
      )
    )
    (print { event: "profile-updated", farmer: caller })
    (ok true)
  )
)

;; Deactivate farmer (admin only)
(define-public (deactivate-farmer (farmer principal))
  (let 
    (
      (caller tx-sender)
      (profile (map-get? farmers farmer))
    )
    (asserts! (is-owner caller) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-some profile) (err ERR-NOT-REGISTERED))
    (map-set farmers farmer 
      (merge (unwrap-panic profile) { active: false })
    )
    (print { event: "farmer-deactivated", farmer: farmer })
    (ok true)
  )
)

;; Admin functions
(define-public (set-registration-fee (new-fee uint))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set registration-fee new-fee)
    (ok true)
  )
)

(define-public (set-verifier (new-verifier principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set verifier new-verifier)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; Read-only Functions
(define-read-only (get-farmer-profile (farmer principal))
  (map-get? farmers farmer)
)

(define-read-only (get-farmer-by-id (id uint))
  (let ((farmer (map-get? farmer-ids id)))
    (match farmer
      some-farmer (map-get? farmers some-farmer)
      none
    )
  )
)

(define-read-only (get-contract-owner)
  (ok (var-get contract-owner))
)

(define-read-only (get-registration-fee)
  (ok (var-get registration-fee))
)

(define-read-only (get-verifier)
  (ok (var-get verifier))
)

(define-read-only (is-farmer-verified (farmer principal))
  (match (map-get? farmers farmer)
    profile (is-eq (get verification-status profile) "verified")
    false
  )
)

;; Additional robust features: Withdraw fees (admin only)
(define-public (withdraw-fees (amount uint) (recipient principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (as-contract (stx-transfer? amount tx-sender recipient))
  )
)

;; Batch register (admin only, for testing/migration)
(define-public (batch-register-farmers (entries (list 10 {farmer: principal, name: (string-ascii 100), location: (string-ascii 200), farm-size: uint, additional-info: (string-utf8 500)})))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (fold batch-register-iter entries (ok u0))
  )
)

(define-private (batch-register-iter (entry {farmer: principal, name: (string-ascii 100), location: (string-ascii 200), farm-size: uint, additional-info: (string-utf8 500)}) (prev (response uint uint)))
  (match prev
    count (let ((current-id (var-get next-farmer-id)))
            (map-set farmers (get farmer entry) 
              {
                id: current-id,
                name: (get name entry),
                location: (get location entry),
                farm-size: (get farm-size entry),
                registration-timestamp: block-height,
                verification-status: "verified", ;; Auto-verify in batch
                verification-timestamp: (some block-height),
                additional-info: (get additional-info entry),
                active: true
              }
            )
            (map-set farmer-ids current-id (get farmer entry))
            (var-set next-farmer-id (+ current-id u1))
            (print { event: "batch-farmer-registered", farmer: (get farmer entry), id: current-id })
            (ok (+ count u1))
          )
    err (err err)
  )
)