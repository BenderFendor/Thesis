---------------- MODULE RSSCache ----------------
EXTENDS TLC
Sources == {"A", "B"}
VARIABLES cache, fresh, published
vars == <<cache, fresh, published>>
Init ==
  /\ cache = [s \in Sources |-> "old"]
  /\ fresh = [s \in Sources |-> "new"]
  /\ published = FALSE
PublishFullRefresh ==
  /\ ~published
  /\ cache' = [s \in Sources |-> IF s = "A" THEN cache[s] ELSE fresh[s]]
  /\ published' = TRUE
  /\ UNCHANGED fresh
Next == PublishFullRefresh \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ cache \in [Sources -> {"old", "new"}]
  /\ fresh \in [Sources -> {"old", "new"}]
  /\ published \in BOOLEAN
IncompleteSourceRetained == published => cache["A"] = "old"
SuccessfulSourceReplaced == published => cache["B"] = "new"
========================================================
