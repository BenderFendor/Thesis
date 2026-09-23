---------------- MODULE AutoIngest ----------------
EXTENDS TLC
Adapters == {"A", "B"}
Outcomes == {"pending", "success", "failed"}
VARIABLES outcomes, marker
vars == <<outcomes, marker>>
Init ==
  /\ outcomes = [a \in Adapters |-> "pending"]
  /\ marker = FALSE
Succeed(a) ==
  /\ a \in Adapters
  /\ outcomes[a] = "pending"
  /\ outcomes' = [outcomes EXCEPT ![a] = "success"]
  /\ UNCHANGED marker
Fail(a) ==
  /\ a \in Adapters
  /\ outcomes[a] = "pending"
  /\ outcomes' = [outcomes EXCEPT ![a] = "failed"]
  /\ UNCHANGED marker
RecordComplete ==
  /\ ~marker
  /\ \A a \in Adapters: outcomes[a] = "success"
  /\ marker' = TRUE
  /\ UNCHANGED outcomes
Next == (\E a \in Adapters: Succeed(a) \/ Fail(a)) \/ RecordComplete \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ outcomes \in [Adapters -> Outcomes]
  /\ marker \in BOOLEAN
MarkerSound ==
  marker => \A a \in Adapters: outcomes[a] = "success"
========================================================
