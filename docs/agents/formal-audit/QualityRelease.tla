---------------- MODULE QualityRelease ----------------
EXTENDS TLC
VARIABLES taskState, lockOwner, lockTask, lockPresent, requestOwner, requestTask, outcome
vars == <<taskState, lockOwner, lockTask, lockPresent, requestOwner, requestTask, outcome>>
Init ==
  /\ taskState = "claimed"
  /\ lockOwner = "alice"
  /\ lockTask = "task-1"
  /\ lockPresent = TRUE
  /\ requestOwner = "bob"
  /\ requestTask = "task-1"
  /\ outcome = "pending"
WrongOwnerRelease ==
  /\ outcome = "pending"
  /\ (requestOwner # lockOwner \/ requestTask # lockTask)
  /\ outcome' = "rejected"
  /\ UNCHANGED <<taskState, lockOwner, lockTask, lockPresent, requestOwner, requestTask>>
SelectWrongTaskRequest ==
  /\ outcome = "rejected"
  /\ requestOwner' = lockOwner
  /\ requestTask' = "other-task"
  /\ outcome' = "pending"
  /\ UNCHANGED <<taskState, lockOwner, lockTask, lockPresent>>
SelectOwnerRequest ==
  /\ outcome = "rejected"
  /\ requestOwner' = lockOwner
  /\ requestTask' = lockTask
  /\ outcome' = "pending"
  /\ UNCHANGED <<taskState, lockOwner, lockTask, lockPresent>>
OwnerRelease ==
  /\ outcome = "pending"
  /\ requestOwner = lockOwner
  /\ requestTask = lockTask
  /\ taskState' = "queued"
  /\ lockOwner' = "none"
  /\ lockTask' = "none"
  /\ lockPresent' = FALSE
  /\ outcome' = "released"
  /\ UNCHANGED <<requestOwner, requestTask>>
Next == WrongOwnerRelease \/ SelectWrongTaskRequest \/ SelectOwnerRequest \/ OwnerRelease \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ taskState \in {"claimed", "queued"}
  /\ lockOwner \in {"alice", "bob", "none"}
  /\ lockTask \in {"task-1", "other-task", "none"}
  /\ lockPresent \in BOOLEAN
  /\ requestOwner \in {"alice", "bob"}
  /\ requestTask \in {"task-1", "other-task"}
  /\ outcome \in {"pending", "rejected", "released"}
WrongOwnerRejectedPreservesClaim ==
  outcome = "rejected" => taskState = "claimed" /\ lockOwner = "alice" /\ lockTask = "task-1" /\ lockPresent
QueuedTaskHasNoLiveLock == taskState = "queued" => ~lockPresent
========================================================
