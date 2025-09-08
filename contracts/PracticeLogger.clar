;; PracticeLogger.clar
;; This contract allows verified farmers to log sustainable practices with timestamps and details.
;; It integrates with FarmerRegistry via trait for verification checks. Logs are immutable and can be queried.
;; Enhanced with categories, evidence submission, and admin moderation.

;; Constants
(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-NOT-REGISTERED u201)
(define-constant ERR-NOT-VERIFIED u202)
(define-constant ERR-INVALID-INPUT u203)
(define-constant ERR-LOG-NOT-FOUND u204)
(define-constant ERR-ALREADY-MODERATED u205)

;; Traits
(define-trait registry-trait
  (
    (get-farmer-profile (principal) (response (optional {verification-status: (string-ascii 20)}) uint))
    (is-farmer-verified (principal) (response bool uint))
  )
)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var moderator principal tx-sender)

;; Data Maps
(define-map practices {farmer: principal, log-id: uint} 
  {
    practice-type: (string-ascii 100),
    category: (string-ascii 50),
    timestamp: uint,
    details: (string-utf8 1000),
    evidence-hash: (optional (buff 32)), ;; Hash of evidence (e.g., photo/IPFS)
    moderation-status: (string-ascii 20), ;; "pending", "approved", "rejected"
    moderation-notes: (optional (string-utf8 500)),
    moderation-timestamp: (optional uint)
  }
)

(define-map farmer-log-count principal uint)

;; Private Functions
(define-private (is-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (is-moderator (caller principal))
  (is-eq caller (var-get moderator))
)

;; Public Functions

;; Log a new practice
(define-public (log-practice 
  (practice-type (string-ascii 100)) 
  (category (string-ascii 50))
  (details (string-utf8 1000))
  (evidence-hash (optional (buff 32)))
  (registry <registry-trait>))
  (let 
    (
      (caller tx-sender)
      (log-count (default-to u0 (map-get? farmer-log-count caller)))
      (verified (unwrap! (contract-call? registry is-farmer-verified caller) (err ERR-NOT-VERIFIED)))
    )
    (asserts! verified (err ERR-NOT-VERIFIED))
    (asserts! (> (len practice-type) u0) (err ERR-INVALID-INPUT))
    (asserts! (> (len category) u0) (err ERR-INVALID-INPUT))
    (asserts! (> (len details) u0) (err ERR-INVALID-INPUT))
    (map-set practices {farmer: caller, log-id: log-count} 
      {
        practice-type: practice-type,
        category: category,
        timestamp: block-height,
        details: details,
        evidence-hash: evidence-hash,
        moderation-status: "pending",
        moderation-notes: none,
        moderation-timestamp: none
      }
    )
    (map-set farmer-log-count caller (+ log-count u1))
    (print { event: "practice-logged", farmer: caller, log-id: log-count })
    (ok log-count)
  )
)

;; Moderate a log
(define-public (moderate-log (farmer principal) (log-id uint) (status (string-ascii 20)) (notes (optional (string-utf8 500))))
  (let 
    (
      (caller tx-sender)
      (log (map-get? practices {farmer: farmer, log-id: log-id}))
    )
    (asserts! (is-moderator caller) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-some log) (err ERR-LOG-NOT-FOUND))
    (asserts! (or (is-eq status "approved") (is-eq status "rejected")) (err ERR-INVALID-INPUT))
    (asserts! (is-eq (get moderation-status (unwrap-panic log)) "pending") (err ERR-ALREADY-MODERATED))
    (map-set practices {farmer: farmer, log-id: log-id} 
      (merge (unwrap-panic log) 
        {
          moderation-status: status,
          moderation-notes: notes,
          moderation-timestamp: (some block-height)
        }
      )
    )
    (print { event: "log-moderated", farmer: farmer, log-id: log-id, status: status })
    (ok true)
  )
)

;; Update log details (only before moderation)
(define-public (update-log (log-id uint) (details (string-utf8 1000)) (evidence-hash (optional (buff 32))))
  (let 
    (
      (caller tx-sender)
      (log (map-get? practices {farmer: caller, log-id: log-id}))
    )
    (asserts! (is-some log) (err ERR-LOG-NOT-FOUND))
    (asserts! (is-eq (get moderation-status (unwrap-panic log)) "pending") (err ERR-ALREADY-MODERATED))
    (map-set practices {farmer: caller, log-id: log-id} 
      (merge (unwrap-panic log) 
        {
          details: details,
          evidence-hash: evidence-hash
        }
      )
    )
    (print { event: "log-updated", farmer: caller, log-id: log-id })
    (ok true)
  )
)

;; Admin functions
(define-public (set-moderator (new-moderator principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set moderator new-moderator)
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
(define-read-only (get-practice (farmer principal) (log-id uint))
  (map-get? practices {farmer: farmer, log-id: log-id})
)

(define-read-only (get-farmer-log-count (farmer principal))
  (default-to u0 (map-get? farmer-log-count farmer))
)

(define-read-only (get-contract-owner)
  (ok (var-get contract-owner))
)

(define-read-only (get-moderator)
  (ok (var-get moderator))
)

;; Additional features: Get all logs for farmer (paginated simulation via offset/limit)
(define-read-only (get-farmer-logs (farmer principal) (offset uint) (limit uint))
  (let 
    (
      (total (get-farmer-log-count farmer))
      (end (min (+ offset limit) total))
      (indices (range offset end))
    )
    (ok (filter is-some (map get-log-iter indices)))
  )
)

(define-private (get-log-iter (id uint))
  (map-get? practices {farmer: tx-sender, log-id: id})
)

(define-private (range (start uint) (end uint))
  (let
    (
      (max-items (if (<= end start) u0 (- end start)))
      (initial-list (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9)) ;; Limited to 10 for simplicity
    )
    (if (> max-items u10)
      (list) ;; Return empty list if range too large
      (unwrap-panic (slice? initial-list start max-items))
    )
  )
)

(define-private (min (a uint) (b uint))
  (if (< a b) a b)
)