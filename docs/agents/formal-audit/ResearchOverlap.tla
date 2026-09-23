---------------- MODULE ResearchOverlap ----------------
EXTENDS Naturals, Sequences, TLC
VARIABLES messages, active, nextId
vars == <<messages, active, nextId>>
Init == /\ messages = <<>> /\ active = 0 /\ nextId = 1
StartResearch ==
  /\ nextId <= 2
  /\ messages' = Append(
       [i \in 1..Len(messages) |-> IF messages[i].id = active THEN [messages[i] EXCEPT !.state = "cancelled"] ELSE messages[i]],
       [id |-> nextId, state |-> "streaming"])
  /\ active' = nextId
  /\ nextId' = nextId + 1
Next == StartResearch \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ messages \in Seq([id : 1..2, state : {"streaming", "complete", "cancelled"}])
  /\ active \in 0..2
  /\ nextId \in 1..3
IdsUnique == Len(messages) < 2 \/ messages[1].id # messages[2].id
SupersededRequestTerminal == \A i \in 1..Len(messages): messages[i].id = active \/ messages[i].state # "streaming"
========================================================
