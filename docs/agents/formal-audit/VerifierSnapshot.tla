---------------- MODULE VerifierSnapshot ----------------
EXTENDS TLC
VARIABLES statusBefore, statusAfter, contentBefore, contentAfter, reportedUnchanged, checked
vars == <<statusBefore, statusAfter, contentBefore, contentAfter, reportedUnchanged, checked>>
Init ==
  /\ statusBefore = "M"
  /\ statusAfter = "M"
  /\ contentBefore = "old"
  /\ contentAfter = "old"
  /\ reportedUnchanged = FALSE
  /\ checked = FALSE
CheckUnchanged ==
  /\ ~checked
  /\ reportedUnchanged' = (statusBefore = statusAfter /\ contentBefore = contentAfter)
  /\ checked' = TRUE
  /\ UNCHANGED <<statusBefore, statusAfter, contentBefore, contentAfter>>
CheckMutatesAlreadyDirtyFile ==
  /\ ~checked
  /\ contentAfter' = "new"
  /\ reportedUnchanged' = (statusBefore = statusAfter /\ contentBefore = contentAfter')
  /\ checked' = TRUE
  /\ UNCHANGED <<statusBefore, statusAfter, contentBefore>>
Next == CheckUnchanged \/ CheckMutatesAlreadyDirtyFile \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ statusBefore \in {"M"}
  /\ statusAfter \in {"M"}
  /\ contentBefore \in {"old", "new"}
  /\ contentAfter \in {"old", "new"}
  /\ reportedUnchanged \in BOOLEAN
  /\ checked \in BOOLEAN
ResultMatchesSnapshot ==
  checked => reportedUnchanged = (statusBefore = statusAfter /\ contentBefore = contentAfter)
NoFalseClean == reportedUnchanged => statusBefore = statusAfter /\ contentBefore = contentAfter
========================================================
