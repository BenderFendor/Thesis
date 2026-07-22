# Atlas Rebuild Phase 1 — evidence-spine ingestion

## Goal and done criteria

Implement Phase 1 only (of `~/.claude/plans/okay-so-what-i-curried-journal.md`):
real writers turning external ownership datasets into evidence-spine rows
(`EvidenceDocument -> DocumentSnapshot -> EvidenceObservation -> EvidenceClaim
-> ClaimEvidence`), tiered acceptance into `AcceptedRelationship`, and a smoke
check that `ownership_math.compute_indirect_interest` produces a range with a
persisted `CalculationTrace` for a real chain. Built on Phase 0
(`entity_resolver.py`/`entity_backfill.py`), already in the working tree
uncommitted.

Done: new `evidence_ingest.py` with one ingestor per source, CLI script,
tests per ingestor + an integration test, mypy --strict clean on new files,
ruff clean, full `pytest -m "not slow"` passing with no regressions.

## Status: complete

## Files changed

- `backend/app/services/evidence_ingest.py` (new, ~1080 lines) — the four
  ingestors, shared spine-writing helpers, and the ownership smoke-check
  wrapper.
- `backend/app/scripts/ingest_evidence.py` (new) — CLI
  (`python -m app.scripts.ingest_evidence --source ... --limit N`).
- `backend/app/services/evidence_policy.py` — added `founded_by`,
  `bias_rating`, `factual_reporting` predicate policies; added
  `wikidata_referenced_statement` to `REGISTRY_CLASSES`.
- `backend/app/services/funding_researcher.py` — extended
  `_fetch_wikidata_by_qid` (additive only) to also return P112/P169 item
  ids, the full raw `claims` dict, resolved `labels`, and
  `raw_response_text`, so `evidence_ingest.py` can read per-statement
  references/qualifiers without a second HTTP round trip or duplicating the
  request logic. No existing caller's return contract changed (only new
  keys added).
- New tests: `test_evidence_ingest_wikidata.py`,
  `test_evidence_ingest_littlesis.py`, `test_evidence_ingest_mbfc.py`,
  `test_evidence_ingest_edgar.py`, `test_evidence_ingest_integration.py`
  (16 tests total).

## Predicate design and how tiering maps to evidence_policy

Ownership facts (Wikidata P127/P749, LittleSis categories 10/11, MBFC
ownership column, EDGAR Exhibit-21 subsidiaries) all use predicate
`directly_owns` with `subject_entity_id` = owned entity, `object_entity_id`
= owner — matching `OwnershipEdge.owner_id`/`owned_id` in
`evidence_spine._all_accepted_interest_edges`, so any of them that
materializes with a `pct`/`pct_band` qualifier feeds
`ownership_math.compute_indirect_interest` directly. Non-ownership Wikidata
facts get their own predicates: P112 (founder) -> `founded_by`, P169 (CEO)
-> `controls` (already existed). MBFC bias/factuality are `object_value`
claims (`bias_rating`, `factual_reporting`), not relationships.

Tiering is entirely the existing `evidence_policy.POLICIES` gate — no
parallel acceptance path:

- **Wikidata, referenced statement** (`statement.references` non-empty):
  the per-statement `EvidenceDocument.source_class` is set to a new class,
  `wikidata_referenced_statement`, added to `REGISTRY_CLASSES` (so
  `directly_owns`/`owns_equity_in`/`controls`/`ultimate_control` all accept
  it) — this directly implements the plan's user decision #2 ("referenced
  Wikidata claims auto-materialize as accepted facts with provenance").
  Unreferenced statements get `third_party_assessment`, which is **not** in
  `REGISTRY_CLASSES`, so they structurally cannot pass the gate and stay
  candidates. One document+snapshot is minted per *statement*, not per
  Wikidata item, because a single item mixes referenced and unreferenced
  statements across properties and `evaluate_claim_by_id` gates on the
  linked document's `source_class`.
- **LittleSis**: always `third_party_assessment` (crowd-sourced, CC BY-SA);
  the ingestor never calls `materialize_claim` at all — every claim it
  creates stays `status="candidate"` for the human review queue.
- **MBFC ownership**: same as LittleSis — candidate only.
- **MBFC bias/factuality**: `evidence_class="third_party_assessment"`,
  gated by the two new `PredicatePolicy` rows
  (`allowed_evidence_classes={"third_party_assessment"}`,
  `permits_catalog_only=True`) — this is MBFC's own published editorial
  assessment, attributed (`asserted_by="mbfc"`, `object_value={"rating":
  ..., "source": "mbfc"}`), not asserted as ground truth. Because these are
  `object_value` claims with no `object_entity_id`,
  `evidence_spine.materialize_claim` can't accept them (it hard-requires an
  entity-to-entity claim) — `_auto_accept_attribute_claim` calls the same
  `evidence_spine.evaluate_claim_by_id` gate and, on a pass, sets
  `claim.status = "accepted"` directly, skipping only the
  `AcceptedRelationship` step that doesn't apply to a non-relational fact.
- **EDGAR Exhibit-21**: `source_class="registry_filing"` (already in
  `REGISTRY_CLASSES`) — a 10-K exhibit is a primary legal filing, so every
  parsed subsidiary auto-materializes.

Every tier-auto path marks its supporting `EvidenceObservation`
`entailment="reviewed_yes"` with `reviewed_by="auto-ingest:<source>:
evidence_ingest/1.0"` before calling `materialize_claim(..., reviewer=<same
string>)` — the DB's own check constraint
(`ck_evidence_observation_reviewed_yes_has_reviewer`) and
`evidence_policy.evaluate_acceptance`'s "unattributed reviewed_yes" rejection
both require this, so there's no way to fake acceptance without going
through the real gate. The HTTP route (`wiki_evidence.py`) requires
`SCOOP_MATERIALIZE_TOKEN`; these ingestors call `evidence_spine.
materialize_claim` directly (the service function), never the route, per
the task's fail-closed guidance.

## Idempotency

- Document/snapshot ids are deterministic (`stable_hash` of source-specific
  keys, or sha256 of raw bytes for the snapshot) — `_get_or_create_document`/
  `_get_or_create_snapshot` look up before insert.
- Claims dedupe on `claim_hash = stable_hash(subject, predicate, object,
  qualifiers, method_version)` via `_get_or_create_claim`.
- Every entity resolution passes at least one deterministic external id
  (`wikidata_qid`, `littlesis_id`, `mbfc_owner_name`, `edgar_subsidiary`,
  `cik`) through `entity_resolver.resolve_or_create` — verified this avoids
  a latent bug in `resolve_or_create` where an entity resolved with *zero*
  external ids would `db.add()` a second time on rerun (no existence check
  before insert) and raise `IntegrityError` on the deterministic id; never
  hit because every ingestor always supplies at least one external id.
- All four unit test modules and the integration test include an explicit
  rerun assertion (`claims_created == 0`, `claims_deduped == N` on the
  second pass).

## What runs live vs fixture-only

Manually verified against the real, live endpoints during development
(outside the test suite, via `curl`/one-off scripts — not persisted to any
project database):
- `query.wikidata.org`/`www.wikidata.org` wbgetentities returned 200 with
  real P127/P749 statement data.
- `data.sec.gov/submissions/CIK0001437107.json` (Warner Bros. Discovery)
  returned real filing history; the linked Exhibit 21.1 HTML
  (`a20241231-ex21listofsubsid.htm`) parsed into real subsidiary rows
  including "CNN America, Inc." — confirming `_parse_exhibit_21`'s
  tag-stripped-token-pair approach works against a real filing, not just
  the test's synthetic HTML.

Deliberately **not** run live in this session: I did not execute
`ingest_evidence.py` against the project's actual configured database. All
persisted evidence-spine rows produced during this task exist only inside
each test's isolated in-memory SQLite session — no write touched the shared
dev DB. Tests use `httpx.MockTransport` (EDGAR) or a `FakeResearcher` stub
(Wikidata) or local CSV/gzip fixture files (MBFC/LittleSis) — no live
network in the test suite, per the task's requirement.

**Known gap, stated plainly**: SEC Exhibit 21 filings do not disclose
ownership percentages, and Wikidata rarely carries the `P1107` "proportion"
qualifier for media companies. This means a live run of `--source edgar` or
`--source wikidata` against real CNN/WBD or Fox News/Fox Corp data will very
likely accept the *ownership fact* (`directly_owns` with no `pct`) but not
produce a quantified `compute_indirect_interest` range for those specific
real chains, because `_all_accepted_interest_edges` skips any edge without a
`pct`/`pct_band` qualifier. The required smoke check (a chain that *does*
produce a range with a persisted `CalculationTrace`) is demonstrated in
`test_evidence_ingest_integration.py` using explicitly-labeled fixture
percentages (100% CNN->WBD, 100% Fox News->Fox Corp, 40% Fox Corp->Murdoch
Family Trust) run through the real ingestion/acceptance/math pipeline — not
faked live results, but not live-sourced numbers either. The CLI's
`_run_smoke_check` runs the same computation against whatever the current DB
actually contains and prints `aggregate=None` honestly when no
percentage-bearing edge exists, rather than asserting a number it can't
back.

## Commands run and results

```
cd backend
MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Success: no issues found in 166 source files

.venv/bin/ruff check app/ tests/
# All checks passed!

.venv/bin/pytest tests/test_evidence_ingest_wikidata.py tests/test_evidence_ingest_littlesis.py \
  tests/test_evidence_ingest_mbfc.py tests/test_evidence_ingest_edgar.py \
  tests/test_evidence_ingest_integration.py -q
# 16 passed

.venv/bin/pytest tests/test_evidence_export.py tests/test_evidence_policy.py \
  tests/test_evidence_spine_integration.py tests/test_evidence_spine_wiring.py \
  tests/test_wiki_evidence_materialize_auth.py tests/test_ownership_math.py \
  tests/test_entity_resolver.py tests/test_entity_backfill.py -q
# 47 passed (no regressions to existing evidence-spine/Phase 0 suites)

.venv/bin/pytest tests -m "not slow" -q
# 528 passed, 3 deselected
```

## Assumptions and deviations

- **LittleSis relationship direction** (`entity1` = owner, `entity2` =
  owned, for categories 10/11): LittleSis's bulk-dump schema has no single
  documented field that unambiguously states this, and the live bulk dump
  (~2GB) wasn't downloaded in this session. Followed LittleSis's own
  `description1`/`description2` convention (`entity1`'s described role, e.g.
  "Owns"). Tier-review only, so a wrong direction here is a queued
  human-reviewable candidate, never a silently-accepted fact.
- **MBFC ownership free-text parsing** (`_mbfc_owner_name`): strips an
  "Owned by "/"Owner: " prefix; MBFC's ownership column has no fixed schema
  across rows. Tier-review only, same reasoning.
- **EDGAR CIK map is fixed** (`EDGAR_PARENT_CIKS` in the CLI): Warner Bros.
  Discovery, Comcast, News Corp, Fox Corp — the four public parents the
  task named. `ingest_edgar_subsidiaries(db, ciks=...)` itself takes any
  CIK map; the CLI's default list is a starting scope, not a hard limit.
- Did not modify `wiki_evidence.py` or any HTTP route — out of Phase 1
  scope (writers only, per the task).

## Next executable step (if resumed)

Run `python -m app.scripts.ingest_evidence --source all --limit 5` against a
disposable/staging DB (not the shared dev DB) to get a first real ingestion
report, then inspect `report.acceptance_failures` for any predicate/evidence
class mismatches live data surfaces that the fixtures didn't.
