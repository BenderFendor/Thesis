---------------- MODULE EmbeddingGeneration ----------------
(***************************************************************************)
(*
 * This is a small, finite safety model for the embedding-generation
 * protocol.  The two Workers are also the two producers that may hold the
 * leadership lease and enqueue work.  A work item is an article/generation
 * pair; it is intentionally not a representation of a Python object,
 * database transaction, vector-store API, or scheduler implementation.
 *
 * The model is an abstract protocol, not an implementation refinement or
 * Rust refinement, and not an embedding-quality model.  A passing TLC run
 * transitions preserve the stated properties for the configured finite
 * state space.
 *
 * The model permits a successful stale vector write to finish after
 * invalidation or cancellation.  Such a write is retained in vectorWritten
 * as an observable side effect, but it cannot commit a database marker.
 ***************************************************************************)

EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Articles, Workers, QueueCapacity, MaxGeneration, MaxRetries

NoLeader == "no-leader"
(*
 * Claims are article/generation tuples.  The sentinel keeps the same tuple
 * shape while using a generation outside GenerationRange, so TLC never
 * compares a string claim to a WorkItems tuple.
 *)
NoClaim == <<"no-claim", MaxGeneration + 1>>
NoGeneration == MaxGeneration + 1

GenerationRange == 0..MaxGeneration
WorkItems == Articles \X GenerationRange

Statuses == {
  "available",
  "queued",
  "claimed",
  "running",
  "retryable",
  "written",
  "committed",
  "invalidated",
  "cancelled",
  "dropped",
  "exhausted"
}

ClaimStatuses == {"claimed", "running", "invalidated", "cancelled"}
QueueResidentStatuses == {"queued", "invalidated", "cancelled"}
RetryableStatuses == {"available", "retryable"}
InvalidatableStatuses == {
  "available",
  "queued",
  "claimed",
  "running",
  "retryable",
  "written"
}
DropReasons == {"none", "saturated"}
ClaimValues == WorkItems \cup {NoClaim}

VARIABLE st
vars == <<st>>

(***************************************************************************)
(* Derived values.  A queue is represented as a finite set because FIFO
 * ordering is not relevant to these safety properties.  An invalidated or
 * cancelled queued item remains as a tombstone until DiscardQueued or
 * shutdown removes it, so it can still consume bounded queue capacity. *)

CurrentItem(state, article) ==
  <<article, state.currentGeneration[article]>>

InFlight(state) ==
  {item \in WorkItems : \E worker \in Workers : state.claimedBy[worker] = item}

ItemStatus(state, item) ==
  IF item = NoClaim THEN "none" ELSE state.status[item]

ItemRetryCount(state, item) ==
  IF item = NoClaim THEN 0 ELSE state.retryCount[item]

ClaimStatus(state, worker) ==
  ItemStatus(state, state.claimedBy[worker])
(***************************************************************************)
(* Initial state.  Generation zero starts available.  Later generations are
 * marked invalidated until an explicit Invalidate transition advances an
 * article to that generation. *)

Init ==
  st = [
    currentGeneration |-> [article \in Articles |-> 0],
    queue |-> {},
    status |-> [item \in WorkItems |-> IF item[2] = 0 THEN "available" ELSE "invalidated"],
    claimedBy |-> [worker \in Workers |-> NoClaim],
    retryCount |-> [item \in WorkItems |-> 0],
    vectorWritten |-> {},
    markerCommitted |-> {},
    finalResultCount |-> [item \in WorkItems |-> 0],
    commitGeneration |-> [item \in WorkItems |-> NoGeneration],
    invalidatedItems |-> {item \in WorkItems : item[2] # 0},
    cancelledItems |-> {},
    dropReason |-> [item \in WorkItems |-> "none"],
    dropWitness |-> [item \in WorkItems |-> 0],
    leader |-> NoLeader,
    shutdown |-> FALSE,
    shutdownSnapshot |-> {}
  ]

(***************************************************************************)
(* Leadership.  Leadership controls producers, not already queued work. *)

AcquireLeadership(worker) ==
  /\ worker \in Workers
  /\ st.leader = NoLeader
  /\ ~st.shutdown
  /\ st' = [st EXCEPT !.leader = worker]

ReleaseLeadership(worker) ==
  /\ worker \in Workers
  /\ st.leader = worker
  /\ ~st.shutdown
  /\ st' = [st EXCEPT !.leader = NoLeader]

(***************************************************************************)
(* Enqueue and bounded drop.  A saturated queue drops the logical work item
 * instead of growing without bound.  Retry is a distinct action so that the
 * retry bound is visible in the specification. *)

Enqueue(worker, article) ==
  LET item == CurrentItem(st, article) IN
    /\ worker \in Workers
    /\ article \in Articles
    /\ st.leader = worker
    /\ ~st.shutdown
    /\ st.status[item] = "available"
    /\ item \notin st.invalidatedItems
    /\ item \notin st.cancelledItems
    /\ Cardinality(st.queue) < QueueCapacity
    /\ item \notin st.queue
    /\ item \notin InFlight(st)
    /\ st' = [st EXCEPT
        !.queue = st.queue \cup {item},
        !.status[item] = "queued"]

Retry(worker, article) ==
  LET item == CurrentItem(st, article) IN
    /\ worker \in Workers
    /\ article \in Articles
    /\ st.leader = worker
    /\ ~st.shutdown
    /\ st.status[item] = "retryable"
    /\ st.retryCount[item] < MaxRetries
    /\ item \notin st.invalidatedItems
    /\ item \notin st.cancelledItems
    /\ Cardinality(st.queue) < QueueCapacity
    /\ item \notin st.queue
    /\ item \notin InFlight(st)
    /\ st' = [st EXCEPT
        !.queue = st.queue \cup {item},
        !.status[item] = "queued",
        !.retryCount[item] = st.retryCount[item] + 1]

DropOnSaturation(worker, article) ==
  LET item == CurrentItem(st, article) IN
    /\ worker \in Workers
    /\ article \in Articles
    /\ st.leader = worker
    /\ ~st.shutdown
    /\ st.status[item] \in RetryableStatuses
    /\ item \notin st.invalidatedItems
    /\ item \notin st.cancelledItems
    /\ Cardinality(st.queue) = QueueCapacity
    /\ item \notin st.queue
    /\ item \notin InFlight(st)
    /\ st' = [st EXCEPT
        !.status[item] = "dropped",
        !.dropReason[item] = "saturated",
        !.dropWitness[item] = QueueCapacity]

(***************************************************************************)
(* Claim and run.  Claim removes an item from the bounded queue; Run makes
 * the worker's execution phase explicit so invalidation can race with it. *)

Claim(worker, article) ==
  LET item == CurrentItem(st, article) IN
    /\ worker \in Workers
    /\ article \in Articles
    /\ ~st.shutdown
    /\ st.claimedBy[worker] = NoClaim
    /\ {item} \subseteq st.queue
    /\ st.status[item] = "queued"
    /\ item[2] = st.currentGeneration[article]
    /\ item \notin st.invalidatedItems
    /\ item \notin st.cancelledItems
    /\ item \notin InFlight(st)
    /\ st' = [st EXCEPT
        !.queue = st.queue \ {item},
        !.claimedBy[worker] = item,
        !.status[item] = "claimed"]

Run(worker) ==
  LET item == st.claimedBy[worker] IN
    /\ item # NoClaim
    /\ ItemStatus(st, item) = "claimed"
    /\ st' = [st EXCEPT !.status[item] = "running"]

(***************************************************************************)
(* Vector writes.  A failure may make a current-generation item retryable,
 * but a stale/cancelled execution can only finish without making it
 * retryable. *)

VectorWriteSuccess(worker) ==
  LET item == st.claimedBy[worker]
      canPublish ==
        IF item = NoClaim
        THEN FALSE
        ELSE
          ItemStatus(st, item) = "running"
            /\ item[2] = st.currentGeneration[item[1]]
            /\ item \notin st.invalidatedItems
            /\ item \notin st.cancelledItems
            /\ ~st.shutdown
  IN
    /\ worker \in Workers
    /\ item # NoClaim
    /\ ItemStatus(st, item) \in {"running", "invalidated", "cancelled"}
    /\ st' = [st EXCEPT
        !.vectorWritten = st.vectorWritten \cup {item},
        !.claimedBy[worker] = NoClaim,
        !.status[item] = IF canPublish THEN "written" ELSE st.status[item]]

VectorWriteFailure(worker) ==
  LET item == st.claimedBy[worker]
      retryAfterFailure ==
        IF ItemRetryCount(st, item) < MaxRetries
        THEN "retryable"
        ELSE "exhausted"
      nextRetryCount == ItemRetryCount(st, item)
  IN
    /\ worker \in Workers
    /\ item # NoClaim
    /\ ItemStatus(st, item) \in {"running", "invalidated", "cancelled"}
    /\ st' = [st EXCEPT
        !.claimedBy[worker] = NoClaim,
        !.status[item] =
          IF ItemStatus(st, item) = "running"
          THEN retryAfterFailure
          ELSE ItemStatus(st, item),
        !.retryCount[item] =
          IF ItemStatus(st, item) = "running"
          THEN nextRetryCount
          ELSE ItemRetryCount(st, item)]

(***************************************************************************)
(* Generation invalidation.  A running execution remains associated with its
 * worker so that it can complete as a stale write.  A merely claimed item
 * is cancelled before it starts. *)

Invalidate(article) ==
  LET oldItem == CurrentItem(st, article)
      nextItem == <<article, st.currentGeneration[article] + 1>>
      oldStatus == st.status[oldItem]
      oldAffected ==
        oldItem \notin st.markerCommitted
          /\ oldStatus \in InvalidatableStatuses
      keepOldClaim == oldStatus = "running" \/ oldStatus = "cancelled"
  IN
    /\ article \in Articles
    /\ ~st.shutdown
    /\ st.currentGeneration[article] < MaxGeneration
    /\ st' = [st EXCEPT
        !.currentGeneration[article] = st.currentGeneration[article] + 1,
        !.status[oldItem] =
          IF oldAffected THEN "invalidated" ELSE oldStatus,
        !.status[nextItem] = "available",
        !.queue =
          IF oldStatus = "queued"
          THEN st.queue
          ELSE st.queue \ {oldItem},
        !.claimedBy =
          [worker \in Workers |-> IF st.claimedBy[worker] = oldItem /\ ~keepOldClaim
               THEN NoClaim
               ELSE st.claimedBy[worker]],
        !.invalidatedItems =
          (st.invalidatedItems \ {nextItem})
            \cup (IF oldAffected THEN {oldItem} ELSE {}),
        !.dropReason[nextItem] = "none",
        !.dropWitness[nextItem] = 0]

(***************************************************************************)
(* Explicit cancellation.  Cancellation does not advance the generation;
 * it only prevents a marker commit.  A running cancellation may still
 * produce a stale vector write before the worker finishes. *)

Cancel(article) ==
  LET item == CurrentItem(st, article)
      oldStatus == st.status[item]
      keepClaim == oldStatus = "running"
  IN
    /\ article \in Articles
    /\ ~st.shutdown
    /\ item \notin st.markerCommitted
    /\ oldStatus \in InvalidatableStatuses
    /\ st' = [st EXCEPT
        !.status[item] = "cancelled",
        !.queue =
          IF oldStatus = "queued"
          THEN st.queue
          ELSE st.queue \ {item},
        !.claimedBy =
          [worker \in Workers |-> IF st.claimedBy[worker] = item /\ ~keepClaim
               THEN NoClaim
               ELSE st.claimedBy[worker]],
        !.cancelledItems = st.cancelledItems \cup {item}]

DiscardQueued(item) ==
  /\ item \in WorkItems
  /\ item \in st.queue
  /\ st.status[item] \in {"invalidated", "cancelled"}
  /\ st' = [st EXCEPT !.queue = st.queue \ {item}]

(***************************************************************************)
(* Shutdown cancels all active work.  Running claims are retained only so
 * their already-started vector operation can finish without committing. *)

Shutdown ==
  LET active ==
        {item \in WorkItems :
          st.status[item] \in InvalidatableStatuses
            /\ item \notin st.markerCommitted}
      nextStatus ==
        [item \in WorkItems |-> IF item \in active THEN "cancelled" ELSE st.status[item]]
      nextClaims ==
        [worker \in Workers |-> LET item == st.claimedBy[worker] IN
               IF item = NoClaim
               THEN NoClaim
               ELSE IF item \in active /\ st.status[item] # "running"
                    THEN NoClaim
                    ELSE item]
  IN
    /\ ~st.shutdown
    /\ st' = [st EXCEPT
        !.shutdown = TRUE,
        !.shutdownSnapshot = st.markerCommitted,
        !.leader = NoLeader,
        !.status = nextStatus,
        !.queue = {},
        !.claimedBy = nextClaims,
        !.cancelledItems = st.cancelledItems \cup active]

(***************************************************************************)
(* Marker commit is deliberately separate from the vector write.  The
 * current-generation and invalidation checks are evaluated at commit time. *)

CommitMarker(article) ==
  LET item == CurrentItem(st, article) IN
    /\ article \in Articles
    /\ ~st.shutdown
    /\ st.status[item] = "written"
    /\ item[2] = st.currentGeneration[article]
    /\ item \in st.vectorWritten
    /\ item \notin st.invalidatedItems
    /\ item \notin st.cancelledItems
    /\ item \notin st.markerCommitted
    /\ st.finalResultCount[item] = 0
    /\ st' = [st EXCEPT
        !.markerCommitted = st.markerCommitted \cup {item},
        !.finalResultCount[item] = 1,
        !.commitGeneration[item] = item[2],
        !.status[item] = "committed"]

(***************************************************************************)

Next ==
  \/ \E worker \in Workers : AcquireLeadership(worker)
  \/ \E worker \in Workers : ReleaseLeadership(worker)
  \/ \E worker \in Workers, article \in Articles : Enqueue(worker, article)
  \/ \E worker \in Workers, article \in Articles : Retry(worker, article)
  \/ \E worker \in Workers, article \in Articles :
       DropOnSaturation(worker, article)
  \/ \E worker \in Workers, article \in Articles : Claim(worker, article)
  \/ \E worker \in Workers : Run(worker)
  \/ \E worker \in Workers : VectorWriteSuccess(worker)
  \/ \E worker \in Workers : VectorWriteFailure(worker)
  \/ \E article \in Articles : Invalidate(article)
  \/ \E article \in Articles : Cancel(article)
  \/ \E item \in WorkItems : DiscardQueued(item)
  \/ Shutdown
  \/ \E article \in Articles : CommitMarker(article)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Safety properties.  Each is a state predicate, so the TLC config checks
 * it as an invariant and also checks the conjunction as a temporal property. *)

TypeOK ==
  /\ st.currentGeneration \in [Articles -> GenerationRange]
  /\ st.queue \subseteq WorkItems
  /\ Cardinality(st.queue) <= QueueCapacity
  /\ st.status \in [WorkItems -> Statuses]
  /\ st.claimedBy \in [Workers -> ClaimValues]
  /\ InFlight(st) \subseteq WorkItems
  /\ \A worker \in Workers :
       ClaimStatus(st, worker) \in ClaimStatuses \cup {"none"}
  /\ st.retryCount \in [WorkItems -> 0..MaxRetries]
  /\ st.vectorWritten \subseteq WorkItems
  /\ st.markerCommitted \subseteq WorkItems
  /\ st.finalResultCount \in [WorkItems -> 0..1]
  /\ st.commitGeneration
       \in [WorkItems -> (GenerationRange \cup {NoGeneration})]
  /\ st.invalidatedItems \subseteq WorkItems
  /\ st.cancelledItems \subseteq WorkItems
  /\ st.dropReason \in [WorkItems -> DropReasons]
  /\ st.dropWitness \in [WorkItems -> 0..QueueCapacity]
  /\ st.leader \in Workers \cup {NoLeader}
  /\ st.shutdown \in BOOLEAN
  /\ st.shutdownSnapshot \subseteq WorkItems

WriteBeforeMarker ==
  /\ st.markerCommitted \subseteq st.vectorWritten
  /\ \A item \in st.markerCommitted :
       st.commitGeneration[item] = item[2]

NoStaleCommit ==
  /\ \A item \in st.markerCommitted :
       st.status[item] = "committed"
         /\ st.commitGeneration[item] = item[2]
         /\ item \notin st.invalidatedItems
         /\ item \notin st.cancelledItems

NoCommitAfterInvalidationOrShutdown ==
  /\ st.markerCommitted \cap st.invalidatedItems = {}
  /\ (st.shutdown => st.markerCommitted = st.shutdownSnapshot)

RetryDropSoundness ==
  /\ \A item \in WorkItems : st.retryCount[item] <= MaxRetries
  /\ \A item \in WorkItems :
       st.status[item] = "retryable"
         => st.retryCount[item] < MaxRetries
            /\ item \notin st.queue
            /\ item \notin InFlight(st)
            /\ item \notin st.markerCommitted
  /\ \A item \in WorkItems :
       st.status[item] = "exhausted"
         => st.retryCount[item] = MaxRetries
            /\ item \notin st.queue
            /\ item \notin InFlight(st)
            /\ item \notin st.markerCommitted
  /\ \A item \in WorkItems :
       st.status[item] = "dropped"
         => st.dropReason[item] = "saturated"
            /\ st.dropWitness[item] = QueueCapacity
            /\ item \notin st.queue
            /\ item \notin InFlight(st)
            /\ item \notin st.markerCommitted

QueueAccounting ==
  /\ Cardinality(st.queue) <= QueueCapacity
  /\ st.queue \cap InFlight(st) = {}
  /\ {item \in st.queue : st.status[item] = "queued"} =
       {item \in WorkItems : st.status[item] = "queued"}
  /\ st.queue \subseteq
       {item \in WorkItems : st.status[item] \in QueueResidentStatuses}
  /\ \A worker \in Workers :
       st.claimedBy[worker] = NoClaim
         \/ st.claimedBy[worker] \notin st.queue
  /\ Cardinality(InFlight(st)) <= Cardinality(Workers)

NoDuplicateFinalResult ==
  /\ st.markerCommitted =
       {item \in WorkItems : st.finalResultCount[item] = 1}
  /\ \A item \in WorkItems : st.finalResultCount[item] \in {0, 1}

SafetyProperties ==
  [](TypeOK
      /\ WriteBeforeMarker
      /\ NoStaleCommit
      /\ NoCommitAfterInvalidationOrShutdown
      /\ RetryDropSoundness
      /\ QueueAccounting
      /\ NoDuplicateFinalResult)

============================================================
