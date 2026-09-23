import Std

namespace ThesisAudit

structure Snapshot where
  statusIsModified : Bool
  contents : Nat
  deriving DecidableEq, Repr

def sameStatus (a b : Snapshot) : Bool :=
  a.statusIsModified == b.statusIsModified

def sameContents (a b : Snapshot) : Bool :=
  a.contents == b.contents

def sameSnapshot (a b : Snapshot) : Bool :=
  sameStatus a b && sameContents a b

theorem statusEqualityCanHideMutation :
    ∃ before after : Snapshot,
      sameStatus before after = true ∧ sameSnapshot before after = false := by
  exact ⟨⟨true, 0⟩, ⟨true, 1⟩, by decide⟩

theorem cleanSnapshotIncludesContents (before after : Snapshot)
    (clean : sameSnapshot before after = true) :
    sameContents before after = true := by
  simp [sameSnapshot] at clean
  exact clean.2

inductive TaskStatus where
  | queued
  | claimed
  | accepted
  deriving DecidableEq, Repr

structure ClaimState where
  task : TaskStatus
  taskId : Nat
  owner : Option Nat
  deriving DecidableEq, Repr

def releaseClaim (state : ClaimState) (requester requestedTask : Nat) : ClaimState × Bool :=
  if state.owner == some requester && state.taskId == requestedTask then
    ({ state with task := .queued, owner := none }, true)
  else
    (state, false)

theorem wrongOwnerReleasePreservesState :
    let initial : ClaimState := ⟨.claimed, 17, some 1⟩
    let (after, released) := releaseClaim initial 2 17
    after = initial ∧ released = false := by
  decide

def profileNameVerified (fetched nameMatches : Bool) : Bool :=
  fetched && nameMatches

def canVerifyReporter (person canonical citation profileVerified : Bool) : Bool :=
  person && canonical && citation && profileVerified

theorem reporterPromotionRequiresFetchedNameMatch
    (person canonical citation fetched nameMatches : Bool)
    (verified : canVerifyReporter person canonical citation (profileNameVerified fetched nameMatches) = true) :
    fetched = true ∧ nameMatches = true := by
  cases person <;> cases canonical <;> cases citation <;> cases fetched <;> cases nameMatches <;>
    simp [canVerifyReporter, profileNameVerified] at verified ⊢

def nextRequestId (current : Nat) : Nat := current + 1

theorem requestIdsAreDistinct (current : Nat) : current < nextRequestId current := by
  simp [nextRequestId]

def canMarkIngestComplete (adapterA adapterB : Bool) : Bool :=
  adapterA && adapterB

theorem ingestCompletionRequiresEveryAdapter
    (adapterA adapterB : Bool)
    (complete : canMarkIngestComplete adapterA adapterB = true) :
    adapterA = true ∧ adapterB = true := by
  simp [canMarkIngestComplete] at complete
  exact complete

def publishArticleSet (old fresh : Nat) (incomplete : Bool) : Nat :=
  if incomplete then old else fresh

theorem incompleteRefreshRetainsCache (old fresh : Nat) :
    publishArticleSet old fresh true = old := by
  simp [publishArticleSet]

theorem completeRefreshUsesFreshData (old fresh : Nat) :
    publishArticleSet old fresh false = fresh := by
  simp [publishArticleSet]

end ThesisAudit
