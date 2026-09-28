/-
  Independent finite/list ownership and evidence state model.

  This file intentionally makes no refinement, equivalence, soundness, or completeness
  claim about Rust, SQL, Python, an API, or any other application implementation.
  It is an executable model of the stated ownership rules only.
-/
import Std

namespace ThesisOwnership

abbrev EntityId := Nat
abbrev Timestamp := Nat

inductive TransactionStatus where
  | proposed
  | completed
  deriving DecidableEq, Repr

inductive Relationship where
  | owns
  | memberOf
  | operatesNonprofit
  deriving DecidableEq, Repr

inductive InterestType where
  | economic
  | voting
  deriving DecidableEq, Repr

structure InterestRange where
  lower : Nat
  upper : Nat
  deriving DecidableEq, Repr

def InterestRange.point (value : Nat) : InterestRange :=
  ⟨value, value⟩

def InterestRange.valid (range : InterestRange) : Bool :=
  decide (range.lower ≤ range.upper) && decide (range.upper ≤ 100)

structure OwnershipEdge where
  source : EntityId
  target : EntityId
  relation : Relationship
  interest : InterestType
  range : InterestRange
  effectiveFrom : Timestamp
  effectiveUntil : Option Timestamp
  deriving DecidableEq, Repr

structure Evidence where
  id : Nat
  accepted : Bool
  canonical : Bool
  deriving DecidableEq, Repr

structure Conflict where
  transactionId : Nat
  evidenceId : Nat
  reasonCode : Nat
  deriving DecidableEq, Repr

structure Rename where
  oldId : EntityId
  newId : EntityId
  effectiveFrom : Timestamp
  deriving DecidableEq, Repr

structure OwnershipTransaction where
  id : Nat
  edge : OwnershipEdge
  status : TransactionStatus
  evidence : List Nat
  deriving DecidableEq, Repr

structure OwnershipState where
  transactions : List OwnershipTransaction
  evidence : List Evidence
  conflicts : List Conflict
  renames : List Rename
  deriving DecidableEq, Repr

inductive OwnershipAction where
  | propose (transaction : OwnershipTransaction)
  | complete (transactionId : Nat)
  | acceptEvidence (evidenceId : Nat)
  | recordConflict (conflict : Conflict)
  | recordRename (rename : Rename)
  deriving DecidableEq, Repr

/-- A relation is directed from `source` to `target`; it is not an undirected pair. -/
def relationshipMatches (edge : OwnershipEdge) (source target : EntityId) : Bool :=
  edge.source == source && edge.target == target

def isOwnership : Relationship → Bool
  | .owns => true
  | .memberOf => false
  | .operatesNonprofit => false

def isMembership : Relationship → Bool
  | .owns => false
  | .memberOf => true
  | .operatesNonprofit => false

def isNonprofitOperation : Relationship → Bool
  | .owns => false
  | .memberOf => false
  | .operatesNonprofit => true

def directedOwnership (edge : OwnershipEdge) (source target : EntityId) : Bool :=
  isOwnership edge.relation && relationshipMatches edge source target

/-- A completed transaction is effective only inside its edge's time window. -/
def activeAt (edge : OwnershipEdge) (timestamp : Timestamp) : Bool :=
  decide (edge.effectiveFrom ≤ timestamp) &&
    (match edge.effectiveUntil with
    | none => true
    | some endTimestamp => decide (timestamp ≤ endTimestamp))

def effectiveAt (transaction : OwnershipTransaction) (timestamp : Timestamp) : Bool :=
  transaction.status == .completed && activeAt transaction.edge timestamp

def validOwnershipEdge (edge : OwnershipEdge) : Bool :=
  (edge.source != edge.target) &&
    (isOwnership edge.relation && InterestRange.valid edge.range)

def minorityInterest (range : InterestRange) : Bool :=
  decide (range.upper < 50)

def ultimateControl (edge : OwnershipEdge) : Bool :=
  (edge.interest == .voting) && decide (50 ≤ edge.range.upper)

def evidenceAccepted (evidence : Evidence) : Bool :=
  evidence.accepted && evidence.canonical

def evidenceEntryAccepted (evidenceId : Nat) : List Evidence → Bool
  | [] => false
  | evidence :: rest =>
      if evidence.id == evidenceId then
        evidenceAccepted evidence
      else
        evidenceEntryAccepted evidenceId rest

def hasEvidence : List Nat → Bool
  | [] => false
  | _ :: _ => true

def allEvidenceAccepted : List Nat → List Evidence → Bool
  | [], _ => true
  | evidenceId :: rest, evidence =>
      evidenceEntryAccepted evidenceId evidence && allEvidenceAccepted rest evidence

def evidenceBundleAccepted (transaction : OwnershipTransaction)
    (evidence : List Evidence) : Bool :=
  hasEvidence transaction.evidence &&
    allEvidenceAccepted transaction.evidence evidence

def hasConflict (transactionId : Nat) : List Conflict → Bool
  | [] => false
  | conflict :: rest =>
      if conflict.transactionId == transactionId then
        true
      else
        hasConflict transactionId rest

def conflictFree (transactionId : Nat) (conflicts : List Conflict) : Bool :=
  hasConflict transactionId conflicts == false

/-- Completion is gated by proposal status, ownership validity, evidence, and conflicts. -/
def canComplete (transaction : OwnershipTransaction) (evidence : List Evidence)
    (conflicts : List Conflict) : Bool :=
  (transaction.status == .proposed) &&
    (validOwnershipEdge transaction.edge &&
      (evidenceBundleAccepted transaction evidence &&
        conflictFree transaction.id conflicts))

def completeOne (transaction : OwnershipTransaction) (evidence : List Evidence)
    (conflicts : List Conflict) : OwnershipTransaction × Bool :=
  if canComplete transaction evidence conflicts then
    ({ transaction with status := .completed }, true)
  else
    (transaction, false)

def acceptEvidenceInList (evidenceId : Nat) : List Evidence → List Evidence
  | [] => []
  | evidence :: rest =>
      if evidence.id == evidenceId then
        { evidence with accepted := true } :: rest
      else
        evidence :: acceptEvidenceInList evidenceId rest

def completeTransactionInList (transactionId : Nat) (evidence : List Evidence)
    (conflicts : List Conflict) : List OwnershipTransaction → List OwnershipTransaction × Bool
  | [] => ([], false)
  | transaction :: rest =>
      if transaction.id == transactionId then
        let result := completeOne transaction evidence conflicts
        (result.1 :: rest, result.2)
      else
        let result := completeTransactionInList transactionId evidence conflicts rest
        (transaction :: result.1, result.2)

def proposeTransaction (state : OwnershipState) (transaction : OwnershipTransaction) :
    OwnershipState × Bool :=
  let proposed := { transaction with status := .proposed }
  ({ state with transactions := proposed :: state.transactions }, true)

def emptyState : OwnershipState :=
  { transactions := [], evidence := [], conflicts := [], renames := [] }

def acceptEvidence (state : OwnershipState) (evidenceId : Nat) : OwnershipState × Bool :=
  ({ state with evidence := acceptEvidenceInList evidenceId state.evidence }, true)

def recordConflict (state : OwnershipState) (conflict : Conflict) : OwnershipState × Bool :=
  ({ state with conflicts := conflict :: state.conflicts }, true)

def recordRename (state : OwnershipState) (rename : Rename) : OwnershipState × Bool :=
  ({ state with renames := rename :: state.renames }, true)

def completeInState (state : OwnershipState) (transactionId : Nat) : OwnershipState × Bool :=
  let result := completeTransactionInList transactionId state.evidence state.conflicts
    state.transactions
  ({ state with transactions := result.1 }, result.2)

def step (state : OwnershipState) : OwnershipAction → OwnershipState × Bool
  | .propose transaction => proposeTransaction state transaction
  | .complete transactionId => completeInState state transactionId
  | .acceptEvidence evidenceId => acceptEvidence state evidenceId
  | .recordConflict conflict => recordConflict state conflict
  | .recordRename rename => recordRename state rename

/- Renames alter identifiers at a time, but do not alter relation kind or endpoint order. -/
def renameEntityAt (renames : List Rename) (entity : EntityId) (timestamp : Timestamp) : EntityId :=
  match renames with
  | [] => entity
  | mapping :: rest =>
      if mapping.oldId == entity && decide (mapping.effectiveFrom ≤ timestamp) then
        mapping.newId
      else
        renameEntityAt rest entity timestamp

def renameEdgeAt (renames : List Rename) (edge : OwnershipEdge) (timestamp : Timestamp) : OwnershipEdge :=
  { edge with
    source := renameEntityAt renames edge.source timestamp
    target := renameEntityAt renames edge.target timestamp }


theorem boolAndLeft (a b : Bool) (h : (a && b) = true) : a = true := by
  cases a <;> cases b <;> simp_all

theorem boolAndRight (a b : Bool) (h : (a && b) = true) : b = true := by
  cases a <;> cases b <;> simp_all

theorem pointRangeIsValid (value : Nat) (h : value ≤ 100) :
    InterestRange.valid (InterestRange.point value) = true := by
  simp [InterestRange.valid, InterestRange.point, h]

theorem invertedInterestRangeIsRejected (range : InterestRange)
    (h : range.upper < range.lower) : InterestRange.valid range = false := by
  simp [InterestRange.valid, Nat.not_le.mpr h]

theorem overHundredInterestRangeIsRejected (range : InterestRange)
    (h : 100 < range.upper) : InterestRange.valid range = false := by
  simp [InterestRange.valid, Nat.not_le.mpr h]

theorem beforeEffectiveTimeIsInactive (edge : OwnershipEdge) (timestamp : Timestamp)
    (h : timestamp < edge.effectiveFrom) : activeAt edge timestamp = false := by
  simp [activeAt, Nat.not_le.mpr h]

theorem proposedTransactionsAreNotEffective (transaction : OwnershipTransaction)
    (timestamp : Timestamp) (h : transaction.status = .proposed) :
    effectiveAt transaction timestamp = false := by
  simp [effectiveAt, h]

theorem completedAtAnActiveTimeIsEffective (transaction : OwnershipTransaction)
    (timestamp : Timestamp) (hStatus : transaction.status = .completed)
    (hActive : activeAt transaction.edge timestamp = true) :
    effectiveAt transaction timestamp = true := by
  simp [effectiveAt, hStatus, hActive]

theorem ownershipMatchesItsStoredDirection (edge : OwnershipEdge)
    (h : edge.relation = .owns) :
    directedOwnership edge edge.source edge.target = true := by
  simp [directedOwnership, relationshipMatches, isOwnership, h]

theorem reverseOwnershipDoesNotMatchForDistinctEntities (edge : OwnershipEdge)
    (h : edge.relation = .owns) (hDistinct : edge.source ≠ edge.target) :
    directedOwnership edge edge.target edge.source = false := by
  simp [directedOwnership, relationshipMatches, isOwnership, h, hDistinct,
    Ne.symm hDistinct]

theorem membershipIsNotOwnership (edge : OwnershipEdge)
    (h : edge.relation = .memberOf) : isOwnership edge.relation = false := by
  simp [isOwnership, h]

theorem nonprofitOperationIsNotOwnership (edge : OwnershipEdge)
    (h : edge.relation = .operatesNonprofit) : isOwnership edge.relation = false := by
  simp [isOwnership, h]

theorem membershipCannotCompleteAsOwnership (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : transaction.edge.relation = .memberOf) :
    canComplete transaction evidence conflicts = false := by
  simp [canComplete, validOwnershipEdge, isOwnership, h]

theorem nonprofitOperationCannotCompleteAsOwnership (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : transaction.edge.relation = .operatesNonprofit) :
    canComplete transaction evidence conflicts = false := by
  simp [canComplete, validOwnershipEdge, isOwnership, h]

theorem minorityInterestDoesNotEstablishUltimateControl (edge : OwnershipEdge)
    (h : minorityInterest edge.range = true) : ultimateControl edge = false := by
  simp [minorityInterest] at h
  simp [ultimateControl, Nat.not_le.mpr h]

theorem rejectedEvidenceIsNotAccepted (evidence : Evidence)
    (h : evidence.accepted = false) : evidenceAccepted evidence = false := by
  simp [evidenceAccepted, h]

theorem nonCanonicalEvidenceIsNotAccepted (evidence : Evidence)
    (h : evidence.canonical = false) : evidenceAccepted evidence = false := by
  simp [evidenceAccepted, h]

theorem evidenceBundleRequiresAnEvidenceId (transaction : OwnershipTransaction)
    (evidence : List Evidence) (h : evidenceBundleAccepted transaction evidence = true) :
    hasEvidence transaction.evidence = true := by
  have hExpanded :
      (hasEvidence transaction.evidence &&
        allEvidenceAccepted transaction.evidence evidence) = true := by
    simpa only [evidenceBundleAccepted] using h
  exact boolAndLeft _ _ hExpanded

theorem evidenceBundleRequiresEveryEntryAccepted (transaction : OwnershipTransaction)
    (evidence : List Evidence) (h : evidenceBundleAccepted transaction evidence = true) :
    allEvidenceAccepted transaction.evidence evidence = true := by
  have hExpanded :
      (hasEvidence transaction.evidence &&
        allEvidenceAccepted transaction.evidence evidence) = true := by
    simpa only [evidenceBundleAccepted] using h
  exact boolAndRight _ _ hExpanded

theorem canCompleteRequiresProposedStatus (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    (transaction.status == .proposed) = true := by
  have hExpanded :
      ((transaction.status == .proposed) &&
        (validOwnershipEdge transaction.edge &&
          (evidenceBundleAccepted transaction evidence &&
            conflictFree transaction.id conflicts))) = true := by
    simpa only [canComplete] using h
  exact boolAndLeft _ _ hExpanded

theorem canCompleteRequiresValidOwnership (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    validOwnershipEdge transaction.edge = true := by
  have hExpanded :
      ((transaction.status == .proposed) &&
        (validOwnershipEdge transaction.edge &&
          (evidenceBundleAccepted transaction evidence &&
            conflictFree transaction.id conflicts))) = true := by
    simpa only [canComplete] using h
  have hTail := boolAndRight _ _ hExpanded
  exact boolAndLeft _ _ hTail

theorem canCompleteRequiresAcceptedEvidence (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    evidenceBundleAccepted transaction evidence = true := by
  have hExpanded :
      ((transaction.status == .proposed) &&
        (validOwnershipEdge transaction.edge &&
          (evidenceBundleAccepted transaction evidence &&
            conflictFree transaction.id conflicts))) = true := by
    simpa only [canComplete] using h
  have hTail := boolAndRight _ _ hExpanded
  have hEvidenceAndConflict := boolAndRight _ _ hTail
  exact boolAndLeft _ _ hEvidenceAndConflict

theorem canCompleteRequiresNoConflict (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    conflictFree transaction.id conflicts = true := by
  have hExpanded :
      ((transaction.status == .proposed) &&
        (validOwnershipEdge transaction.edge &&
          (evidenceBundleAccepted transaction evidence &&
            conflictFree transaction.id conflicts))) = true := by
    simpa only [canComplete] using h
  have hTail := boolAndRight _ _ hExpanded
  have hEvidenceAndConflict := boolAndRight _ _ hTail
  exact boolAndRight _ _ hEvidenceAndConflict

theorem conflictBlocksCompletion (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : hasConflict transaction.id conflicts = true) :
    canComplete transaction evidence conflicts = false := by
  simp [canComplete, conflictFree, h]

theorem successfulCompletionMarksCompleted (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    (completeOne transaction evidence conflicts).1.status = .completed := by
  simp [completeOne, h]

theorem successfulCompletionReportsSuccess (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = true) :
    (completeOne transaction evidence conflicts).2 = true := by
  simp [completeOne, h]

theorem failedCompletionLeavesTransactionUnchanged (transaction : OwnershipTransaction)
    (evidence : List Evidence) (conflicts : List Conflict)
    (h : canComplete transaction evidence conflicts = false) :
    completeOne transaction evidence conflicts = (transaction, false) := by
  simp [completeOne, h]

theorem proposeActionAddsProposedTransaction (state : OwnershipState)
    (transaction : OwnershipTransaction) :
    (step state (.propose transaction)).1.transactions =
        { transaction with status := .proposed } :: state.transactions ∧
      (step state (.propose transaction)).2 = true := by
  exact ⟨rfl, rfl⟩

theorem acceptingMatchingEvidenceSetsAccepted (evidence : Evidence) :
    acceptEvidenceInList evidence.id [evidence] =
      [{ evidence with accepted := true }] := by
  simp [acceptEvidenceInList]

theorem acceptEvidenceActionReportsSuccess (state : OwnershipState) (evidenceId : Nat) :
    (step state (.acceptEvidence evidenceId)).2 = true := by
  rfl

theorem recordConflictActionAddsConflict (state : OwnershipState) (conflict : Conflict) :
    (step state (.recordConflict conflict)).1.conflicts = conflict :: state.conflicts := by
  rfl

theorem recordRenameActionAddsRename (state : OwnershipState) (rename : Rename) :
    (step state (.recordRename rename)).1.renames = rename :: state.renames := by
  rfl

theorem renameMapsOldIdentifierForward (rename : Rename) (timestamp : Timestamp)
    (h : rename.effectiveFrom ≤ timestamp) :
    renameEntityAt [rename] rename.oldId timestamp = rename.newId := by
  simp [renameEntityAt, h]

theorem renameLeavesAnUnrelatedIdentifierUnchanged (rename : Rename)
    (entity : EntityId) (timestamp : Timestamp) (h : rename.oldId ≠ entity) :
    renameEntityAt [rename] entity timestamp = entity := by
  simp [renameEntityAt, h]

theorem renamePreservesRelationshipKind (renames : List Rename)
    (edge : OwnershipEdge) (timestamp : Timestamp) :
    (renameEdgeAt renames edge timestamp).relation = edge.relation := by
  rfl

theorem renamePreservesEndpointOrder (renames : List Rename)
    (edge : OwnershipEdge) (timestamp : Timestamp) :
    ((renameEdgeAt renames edge timestamp).source, (renameEdgeAt renames edge timestamp).target) =
      (renameEntityAt renames edge.source timestamp, renameEntityAt renames edge.target timestamp) := by
  rfl

end ThesisOwnership
