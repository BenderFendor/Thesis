---------------- MODULE ReporterPromotion ----------------
EXTENDS TLC
VARIABLES bylineObserved, canonicalStored, observedCitation, profileFetched, profileNameMatched, verified
vars == <<bylineObserved, canonicalStored, observedCitation, profileFetched, profileNameMatched, verified>>
Init ==
  /\ bylineObserved = FALSE
  /\ canonicalStored = FALSE
  /\ observedCitation = FALSE
  /\ profileFetched = FALSE
  /\ profileNameMatched = FALSE
  /\ verified = FALSE
ObserveArticleJsonLd ==
  /\ ~bylineObserved
  /\ bylineObserved' = TRUE
  /\ UNCHANGED <<canonicalStored, observedCitation, profileFetched, profileNameMatched, verified>>
BuildLocalProfile ==
  /\ bylineObserved
  /\ ~canonicalStored
  /\ canonicalStored' = TRUE
  /\ observedCitation' = TRUE
  /\ UNCHANGED <<bylineObserved, profileFetched, profileNameMatched, verified>>
FetchMatchingProfile ==
  /\ canonicalStored
  /\ ~profileFetched
  /\ profileFetched' = TRUE
  /\ profileNameMatched' = TRUE
  /\ UNCHANGED <<bylineObserved, canonicalStored, observedCitation, verified>>
FetchNonmatchingProfile ==
  /\ canonicalStored
  /\ ~profileFetched
  /\ profileFetched' = TRUE
  /\ profileNameMatched' = FALSE
  /\ UNCHANGED <<bylineObserved, canonicalStored, observedCitation, verified>>
Score ==
  /\ canonicalStored
  /\ observedCitation
  /\ profileFetched
  /\ profileNameMatched
  /\ verified' = TRUE
  /\ UNCHANGED <<bylineObserved, canonicalStored, observedCitation, profileFetched, profileNameMatched>>
Next == ObserveArticleJsonLd \/ BuildLocalProfile \/ FetchMatchingProfile \/ FetchNonmatchingProfile \/ Score \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ bylineObserved \in BOOLEAN
  /\ canonicalStored \in BOOLEAN
  /\ observedCitation \in BOOLEAN
  /\ profileFetched \in BOOLEAN
  /\ profileNameMatched \in BOOLEAN
  /\ verified \in BOOLEAN
VerifiedNeedsProfileNameMatch == verified => profileFetched /\ profileNameMatched
========================================================
