# Plan: Atlas research coverage, 76 -> ~8,000 entities

## Goal and done criteria

Grow `research_coverage` (backend/app/services/atlas_graph.py `build_atlas_stats`,
defined in backend/app/models/atlas.py `AtlasStatsResponse.research_coverage`)
from 76/11,709 to roughly 8,000/11,709, without lowering the evidence bar.
"Researched" is `AtlasNode.evidence_coverage != "not researched"`, set in
`_rank_nodes` (backend/app/services/atlas_graph.py:112-116) whenever the sum of
`edge.evidence_count` across every edge touching a node is greater than zero.
`evidence_count` is real citation count (`len(evidence_refs)`), not a boolean,
and it counts **both** accepted (`AcceptedRelationship`) and un-materialized
candidate (`EvidenceClaim.status="candidate"`) edges (see
`atlas_evidence_projection.py:407` and `:502`) -- so hitting this number does
**not** require winning every acceptance-policy fight, only creating claims
with linked, quoted observations. Status: investigation complete, no code
changed (read-only task). All counts below are measured against the live dev
Postgres database (`newsdb`) on 2026-07-22, not estimated.

## What "researched" requires, precisely

1. An `AtlasEdge` whose `source_id`/`target_id` is the entity's Atlas node id.
2. `edge.evidence_count > 0`, i.e. at least one linked `EvidenceObservation`
   (via `ClaimEvidence`) with a resolvable snapshot/document.
3. The edge's predicate must be in the entity type's respective builder:
   - Outlets/organizations/people: `_OWNERSHIP_PREDICATES` in
     `atlas_evidence_projection.py:77-94` (directly_owns, owns_equity_in,
     controls, brand_of, operated_by, successor_of, founded_by, employed_by,
     publishes, distributed_by, syndicated_by, authorizes_inventory_seller,
     sponsors_content, political_ad_purchase, advertising_inventory_sold_by,
     funds). **`authored_by` is not in this list.**
   - Reporters: a completely separate code path,
     `atlas_graph_projection.py:203-261`. Reporter nodes come from the legacy
     `Reporter` SQL table (`reporters`), not from `EvidenceEntity`. A
     reporter only gets an edge if `Reporter.institutional_affiliations`
     (JSON column) contains a dict with an `org`/`name`/`organization` key
     that normalizes to match a **live organization `EvidenceEntity`** by
     name, and `evidence_count` on that edge is `len(evidence)`, which is
     non-zero **only if the affiliation dict also carries a `url` or
     `source_url` key** (line 234-245). Affiliation entries without a URL
     (Wikidata-name-only, see below) render on the dossier UI but contribute
     **zero** to research coverage.

This second point is the central fact of this investigation: reporters and
everyone else are scored by two disconnected mechanisms. Fixing the evidence
spine's `article_records` adapter alone does **not** move reporter coverage
unless it is also wired to write into `Reporter.institutional_affiliations`
(or the graph projection is changed to read the evidence spine for reporters
too). See Workstream 1.

## Current state (measured against live `newsdb`, 2026-07-22)

| Adapter (`ADAPTER_REGISTRY` in `primary_source_adapters.py`) | Runs in auto-ingest today? | Blocked by | Evidence produced so far | Entities it could plausibly research |
|---|---|---|---|---|
| `wikidata` (not in ADAPTER_REGISTRY; separate `ingest_wikidata_ownership_claims`) | Yes, every restart (network-bound, 24h guard) | Wikidata SPARQL breadth = only publication entities that already carry a `wikidata_qid` external id (10 of 342 publications today); 6 claims currently blocked by contradiction adjudication (`evidence_ingest_runs` status=`partial`, see run detail below) | 12 `directly_owns`, 7 `controls`, 8 `founded_by` accepted; a few more candidate | ~76 orgs/outlets/people currently -- this is essentially the *entire* current coverage number |
| `littlesis` (ownership; separate `ingest_littlesis_ownership`) | Yes, but no-ops | `backend/data/littlesis/entities.json.gz` and `relationships.json.gz` are absent (`ls` confirms empty dir); `load_littlesis_entities` logs `LittleSis entities file not found` and returns `[]`; the run still reports `status=success` with 0 candidates because an empty list is not an error | 0 | Unknown until file is fetched; LittleSis skews toward politically/financially powerful entities, not local reporters -- expect modest, not massive, reporter hit rate (see Workstream 2) |
| `mbfc` | Yes | Nothing; runs successfully every cycle | Bias/factuality ratings (`third_party_assessment`, catalog-only-permitted predicate) | Outlets only, and only for bias_rating/factual_reporting, which are minor and cosmetic, not ownership research |
| `edgar` | Yes | Fixed 4-parent CIK allowlist (`EDGAR_PARENT_CIKS` in `ingest_evidence.py`) -- deliberately narrow, not a blocker to fix, a scope decision | Feeds the same ~27 accepted relationships above | ~10-20 more subsidiaries at most; already near its ceiling by design |
| `ads_txt` | Yes | `ConnectError` every run (`evidence_ingest_runs.failure = "ConnectError:"`) -- outbound network to publisher `ads.txt` URLs fails in this environment | 0 | `seller_account` entities only; not on the path to 8,000, lowest priority |
| `companies_house` | **No** -- `evidence_ingest_runs` shows `status=blocked`, `missing_credentials=["COMPANIES_HOUSE_API_KEY"]` every cycle | Missing API key (free registration at companieshouse.gov.uk) | 0 | UK-registered publishers/owners only; small, not a lever for reporters |
| `gleif` | **No** -- not called anywhere in `auto_ingest.py` or any wired CLI path; only invocable via `python -m app.scripts.ingest_evidence --source gleif --input <frozen-capture.json>` | Requires a manually prepared `--input` capture file; no automatic retrieval exists | 0 | Legal-entity identity/parent chains; small, non-reporter |
| `corporate_records` | **No**, same as gleif | Same: requires `--input`, no automatic feed | 0 | Ownership/brand-of/operated-by facts if fed manually curated records; small |
| `irs_990` | **No**, same as gleif | Same | 0 | Nonprofit-outlet financials; small |
| `usaspending` | **No**, same as gleif | Same | 0 | Government funding edges to legal entities; small |
| `fcc` | **No**, same as gleif | Same | 0 | Broadcast station ownership/political-ad edges; small-to-medium if fed |
| `sellers_json` | **No**, same as gleif | Same | 0 | `seller_account` entities, ad-supply chain only; not a coverage lever |
| `sponsorship` | **No**, same as gleif | Same | 0 | Sponsorship disclosures; small |
| **`article_records`** | **No** -- not in `auto_ingest.py`'s `_run_evidence_ingestion` source list at all (`primary_source_adapters.py`'s "broad_adapters" only run via the manual `--input` CLI path); confirmed by DB: `evidence_claims` has **zero** rows with `predicate IN ('authored_by','employed_by')` | Requires `--input` frozen-capture JSON built from raw article HTML with JSON-LD; nothing generates that input from the 156,239 `articles` rows already in Postgres | 0 | **This is the lever.** 156,239 articles, 55,893 `article_authors` byline rows, 11,475 distinct reporters with at least one byline, 232 distinct outlet sources already in the DB -- structured, no scraping needed |

Wikidata `partial`-status detail (measured): the latest run's `failure` field
lists 6 claims, each rejected with the same reason -- "claim contradicts
accepted relationship ... (different objects compete for the same subject,
predicate, and overlapping valid time)" -- each opening an
`adjudication_items` row rather than silently dropping. This is working as
designed (contradiction adjudication, not a bug), but it caps wikidata's
practical reach until someone resolves those 6 adjudications by hand.

Database counts backing every number above:

```
reporters (article_count > 0):S       11,395
article_authors (byline rows):        55,893
article_authors (distinct reporters): 11,475
reporters.institutional_affiliations
  populated (non-empty):              57  -- all wikidata-name-only, 0 have a url -> 0 contribute to coverage today
articles:                             156,239 (all with content)
distinct article sources (outlets):   232
evidence_entities:                    415 (342 publication, 42 legal_entity, 31 person)
evidence_claims by predicate/status:
  directly_owns: 12 accepted / 24 candidate
  controls:       7 accepted /  8 candidate
  founded_by:     8 accepted / 11 candidate
  authored_by:    0 / 0
  employed_by:    0 / 0
publications with a wikidata_qid external id: 10 of 342
littlesis bulk files present:         no (backend/data/littlesis/ is empty)
download_littlesis_bulk() called anywhere in the codebase: no (dead code)
reporter_claims (claim_type='affiliation', current, has source_url):
  431 total, 121 distinct reporters -- but these are OpenAlex academic
  affiliations (universities, research funders), not news employers, and are
  not read by any Atlas projection code today
```

## Prioritized workstreams (ordered by coverage-per-effort)

### Workstream 1 -- Reporter byline evidence from the local article corpus (the big lever)

This is the only workstream that can plausibly reach thousands of entities,
because reporters are 97% of the denominator (11,395 of 11,709) and the raw
byline data already exists in Postgres. It requires **two** changes, not one
-- the adapter alone is insufficient because of the node-identity split
described above.

**1a. Feed `article_records` from the DB instead of frozen HTML captures.**
Write a new script, e.g. `backend/app/scripts/ingest_reporter_bylines.py`,
that:
- Queries `articles` JOIN `article_authors` JOIN `reporters` (plus
  `articles.author_urls` where present) to build in-memory records shaped
  like what `primary_source_adapters.parse_article_html` would have produced:
  `{"record_type": "byline", "article_url": ..., "outlet_name": ...,
  "outlet_domain": ..., "author_name": ..., "author_url": ...}`.
- Calls `ingest_article_records` (primary_source_adapters.py:833) directly
  with a `CapturedPayload` built from the DB row content (source_url = the
  article URL already in `articles.url`; body = canonical_json of the row,
  so hashing/idempotency work exactly like every other adapter). No network
  fetch, no HTML re-scrape -- this reuses data that is already trusted enough
  to serve the reader-facing article feed.
- This produces `authored_by` candidate claims (`evidence_class:
  article_byline`, which the policy in `evidence_policy.py:149-151` already
  allows) for up to 55,893 byline rows / 11,475 distinct reporter-name
  authors. Idempotent by construction (`_get_or_create_document/snapshot/
  observation/claim` all dedupe on deterministic ids).

**1b. Bridge `authored_by`/`employed_by` evidence to `Reporter` nodes.**
Two sub-options, pick one:
  - *(preferred, smaller diff)* Extend `atlas_graph_projection.py`'s reporter
    edge-builder (currently lines 203-261) to also query `EvidenceClaim`
    where `predicate IN ('authored_by','employed_by')` and the subject/
    object person name normalizes (via the same `normalize_entity_label`
    already imported) to a `Reporter.canonical_name`/`normalized_name`,
    emitting a `reporter:<id>` -> outlet/org edge with
    `evidence_count = count of matching claims with linked observations`
    (candidate claims count, per the coverage rule above -- no need to wait
    for acceptance policy wins). This keeps `Reporter` as the reporter
    system of record and treats the evidence spine as an additional data
    source for it, matching the existing pattern where LittleSis/Wikidata
    write into `Reporter.institutional_affiliations`.
  - *(larger diff, more architecturally correct)* Make `entity_resolver.
    resolve_or_create` record a `reporter_id` external id when a "person"
    subject's name matches an existing `Reporter` row, then have
    `atlas_evidence_projection.py` emit `reporter:<id>` as the node id
    instead of `person:<entity_id>` for those persons, unifying the two
    reporter representations for good. More invasive; touches entity
    resolution and both projection modules; recommend as a v2 once 1a/1b
    (preferred) is validated.
  - Also add `"authored_by"` to `_OWNERSHIP_PREDICATES`
    (`atlas_evidence_projection.py:77-94`) so byline-authored article-brand
    edges render in the general graph too (separately useful, not required
    for the reporter-node fix above if you take the preferred sub-option,
    since that queries `EvidenceClaim` directly rather than through the
    projected edge list).

**1c. Wire it into the pipeline.** Add a `Stage("reporter_byline_ingest",
_run_reporter_byline_ingest, network_bound=False)` to `STAGES` in
`auto_ingest.py` so it runs on every restart against whatever the article
corpus currently holds (per the CLAUDE.md rule: ingestion belongs in
`runlocal.sh`/auto-ingest, never manual).

**Expected coverage gain:** up to 11,475 reporters have at least one byline
row today; realistic first-pass yield will be lower after name-normalization
collisions and outlet-domain resolution failures, but even a 50-70% match
rate is 5,700-8,000 reporters -- this single workstream can plausibly hit
the 8,000 target on its own. **Grounded in measured DB counts, not a guess.**

**Effort:** ~4 tasks (write the DB-backed record builder; call
`ingest_article_records`; implement the reporter-edge bridge in
`atlas_graph_projection.py`; add the auto-ingest stage) plus 1 task for
regression tests mirroring `backend/tests/test_evidence_ingest_ads_supply.py`'s
pattern.

**Risks:**
- Name collisions: `article_authors`/`reporters` name matching is already
  imperfect upstream (that's why `reporter_id` exists as an FK rather than a
  free-text join) -- but this workstream reuses that existing resolution,
  it does not add new ambiguity.
- Outlet-domain resolution: `ingest_article_records` requires
  `outlet_domain` to resolve an `EvidenceEntity`; verify `articles.source`
  reliably maps to the 232 distinct sources already in the RSS catalog
  (`_catalog_domain_map` in `ingest_evidence.py` already does this exact
  mapping for MBFC -- reuse it).
- Do not conflate "wrote at least one article for outlet X" with an
  ownership-grade fact -- `authored_by`/`employed_by` policy classes
  (`article_byline`, `employer_profile`) are already scoped narrowly enough
  in `evidence_policy.py` to avoid this; do not widen them.

### Workstream 2 -- LittleSis bulk file

**Task:** Call `download_littlesis_bulk()` (littlesis_integration.py:93),
currently dead code -- nothing in the codebase calls it. Either wire it into
`auto_ingest.py` as a one-time/periodic network-bound stage, or run it once
manually and commit the resulting files' *absence from git* (they're large;
confirm `.gitignore` covers `backend/data/littlesis/`) as a documented setup
step. Files: `entities.json.gz` (~303K entities), `relationships.json.gz`
(~1.86M relationships), per the module's own docstring.

**Expected coverage gain:** unlocks two currently-silent adapters at once:
`ingest_littlesis_ownership` (org/legal-entity `directly_owns` candidates,
tier-review) and `get_littlesis_affiliations_for_reporter` (per-reporter
lookup already called from `reporter_indexer.py`, but currently always
returns empty because the file is missing). LittleSis is a
politically/financially-powerful-figures database, not a journalist
database, so the reporter-affiliation hit rate will likely be a low
single-digit percentage of the 11,395 -- call it 200-600 reporters,
speculative since it depends on fuzzy name-match quality
(`cross_reference_entities_with_reporters`) which was not exercised in this
investigation. For 41 organizations and person entities, expect a much
higher relative hit rate since LittleSis is comprehensive there.

**Effort:** 1 task (download + wire the existing dead-code call), plus
verifying `_ensure_data_dir()`'s target path is writable and the ~1-2GB
combined download fits the environment.

**Risk:** `get_littlesis_affiliations_for_reporter` writes affiliations
without a `source_url` unless the matched LittleSis relationship carries an
`id` (it does, via `littlesis_url`), so once the file exists this path
should start contributing real evidence_count > 0 edges, unlike the current
57 wikidata-sourced rows which never will. Verify this specifically after
the file lands -- don't assume from code reading alone.

### Workstream 3 -- Credentials for existing-but-blocked adapters

**Task:** Set `COMPANIES_HOUSE_API_KEY` (free registration,
developer.company-information.service.gov.uk). No other adapter in
`ADAPTER_REGISTRY.required_credentials` is currently unset --
`companies_house` is the only one gated by a missing credential per the
measured `evidence_ingest_runs` rows.

**Expected coverage gain:** small, UK-publisher-ownership-only. Not a lever
toward 8,000; do this because it's nearly free, not because it moves the
number materially.

**Effort:** 1 task (set the env var; the adapter code already runs once
present -- `evidence_ingest.py`'s missing-credential check in
`auto_ingest.py:111-128` is the only gate).

### Workstream 4 -- Wire the manual-`--input` adapters (gleif, corporate_records, irs_990, usaspending, fcc, sellers_json, sponsorship) into automatic retrieval

**Task:** Each of these adapters is fully implemented and tested
(`primary_source_adapters.py`) but has no automatic retrieval path -- only
`python -m app.scripts.ingest_evidence --source X --input frozen.json`. To
run them automatically, each needs a small retrieval function (HTTP GET to
GLEIF's public API, IRS 990 e-file bulk index, USAspending API, FCC's public
ownership/political-file APIs) analogous to `ingest_ads_supply`'s inline
`httpx` call, then a `Stage` entry in `auto_ingest.py`.

**Expected coverage gain:** modest and entity-type-specific (nonprofits via
irs_990, government contractors via usaspending, broadcast owners via fcc);
none of these touch reporters. Useful for organization/outlet depth after
Workstream 1 lands, not before.

**Effort:** ~2 tasks per adapter (retrieval function + auto-ingest wiring) =
~10-12 tasks total if all are done; can be split per-adapter and prioritized
by which entity types matter most once Workstream 1's reporter number is
banked.

**Risk:** each of these hits a real external API with its own rate limits
and terms of use (IRS bulk XML index, EDGAR's UA requirement pattern already
seen in `SCOOP_SEC_USER_AGENT`) -- budget for that per adapter, not a single
generic task.

### Workstream 5 -- Wikidata breadth + fix ads_txt connectivity

**Wikidata:** breadth is capped by how many publication entities carry a
`wikidata_qid` external id -- 10 of 342 today. Expanding the seed list
(`entity_backfill.py`'s wikidata QID resolution, not investigated in depth
here) would let the existing BFS (`ingest_wikidata_ownership_claims`,
`max_depth=3`) walk further. Also: resolve the 6 open adjudication items
blocking full acceptance (`adjudication_items` table) -- these are
legitimate contradictions, not bugs, so resolving them means a human
decision, not a code change.

**ads_txt:** the `ConnectError` needs live-environment network diagnosis
(proxy? DNS? firewall to ad-tech domains specifically?) --
out of scope for this read-only investigation; flag as a environment/ops
ticket, not a coverage lever regardless (produces `seller_account` entities
only, never outlets/orgs/people/reporters).

**Expected coverage gain:** small, incremental; do last.

**Effort:** wikidata seed expansion ~2 tasks; adjudication resolution is a
review workflow task, not code; ads_txt diagnosis ~1 task once someone can
test outbound connectivity from the actual deployment target.

## Milestone ladder

| Milestone | Coverage | Driven by |
|---|---|---|
| 76 | today | wikidata BFS over 10 seeded publications only |
| ~120-150 | +Workstream 3 (companies_house key) | UK publisher ownership; small but immediate |
| ~300-900 | +Workstream 2 (LittleSis bulk file) | org/legal-entity ownership candidates + a modest reporter-affiliation slice |
| ~1,500-2,500 | +Workstream 1a only (byline claims created, not yet bridged to Reporter nodes) | `authored_by` edges researching the ~342 `publication_brand`/article entities and ~11K `person` evidence-entities -- but this milestone does **not** move the `reporter`-typed research_coverage_by_entity_type number, only `organization`/`outlet`/`person`, because of the node-identity split |
| ~6,000-8,000+ | +Workstream 1b (Reporter-node bridge lands) | the `reporter:<id>` nodes finally receive `evidence_count > 0`; this is the step that actually moves the headline number past the 76 floor at scale |
| beyond 8,000 | +Workstream 4 (irs_990/usaspending/fcc/gleif automatic retrieval) + Workstream 5 (wikidata breadth) | organization/outlet depth once reporter coverage is banked |

The ladder is not additive-linear: Workstream 1a alone is close to useless
for the headline number without 1b, because "researched" is scored per
Atlas node type and reporters are scored from a different table than every
other entity type. Do not report progress after 1a as if it moved reporter
coverage -- verify against `research_coverage_by_entity_type["reporter"]`
specifically, not the aggregate.

## What NOT to do

- **Do not lower the acceptance-policy bar** (`evidence_policy.py`
  `POLICIES`, `REGISTRY_CLASSES`, `minimum_independent_roots`) to
  auto-accept more claims just to move the number. Coverage already counts
  candidate (`status="candidate"`) claims with real linked observations --
  the bar that matters is "does a real observation exist," not
  "was it accepted." Widening `allowed_evidence_classes` or dropping
  `permits_catalog_only` gates would let unsourced/generated text count,
  which defeats the entire evidence-spine design documented in
  `docs/scoop-evidence-spine.md`.
- **Do not fabricate `Reporter.institutional_affiliations` entries without a
  real `source_url`.** The 57 existing wikidata-sourced rows already show
  what this produces: entries that render in the UI but contribute zero to
  research coverage and would be misleading if anyone assumed otherwise.
  Every affiliation written by Workstream 1 or 2 must carry a real citation
  URL (the article URL for bylines, the LittleSis relationship URL for
  LittleSis).
- **Do not silently widen `_OWNERSHIP_PREDICATES` or `_display_group`**
  mappings in ways that make unrelated relationship types (e.g. `funds`,
  `advertising_inventory_sold_by`) count toward reporter/org coverage they
  weren't designed to represent -- keep predicate additions (like
  `authored_by`, Workstream 1) scoped to what they actually assert.
- **Do not treat "candidates created" as the finish line for a workstream.**
  Confirm the resulting edges actually reach `researched_by_type` for the
  intended entity type before reporting a milestone hit -- this
  investigation found exactly that gap (article evidence existing without
  moving reporter coverage) once, and it is easy to repeat if verification
  stops at "claims were written to the DB."
- **Do not run any of the "broad_adapters"' `--input` CLI path against
  fabricated or synthetic capture files** to inflate counts quickly --
  every one of them expects a real retrieved/pinned document
  (`CapturedPayload`); synthetic input breaks the entire
  document->snapshot->observation->claim provenance chain the evidence
  spine exists to guarantee.

## Files referenced (for the follow-up implementer)

- `backend/app/services/atlas_graph.py` -- `build_atlas_stats`, `_rank_nodes`
  (evidence_coverage / "researched" definition)
- `backend/app/models/atlas.py` -- `research_coverage`,
  `research_coverage_by_entity_type`
- `backend/app/services/atlas_evidence_projection.py` -- `_OWNERSHIP_PREDICATES`,
  `_accepted_ownership_edges`, `_candidate_ownership_edges`
- `backend/app/services/atlas_graph_projection.py` -- reporter node/edge
  projection from `Reporter.institutional_affiliations` (lines 184-261)
- `backend/app/services/evidence_policy.py` -- acceptance gates, do not weaken
- `backend/app/services/primary_source_adapters.py` -- `ADAPTER_REGISTRY`,
  `ingest_article_records`
- `backend/app/services/evidence_ingest.py` -- `ingest_wikidata_ownership_claims`,
  `ingest_littlesis_ownership`
- `backend/app/services/littlesis_integration.py` -- `download_littlesis_bulk`
  (dead code, never called), `get_littlesis_affiliations_for_reporter`
- `backend/app/services/auto_ingest.py` -- `STAGES`, `_run_evidence_ingestion`
  (only wikidata/littlesis/mbfc/edgar/ads_txt run automatically today)
- `backend/app/scripts/ingest_evidence.py` -- CLI entry point, `broad_adapters`
  dict requiring `--input`
- `backend/app/database.py:398` -- `Reporter.institutional_affiliations` column
- Database tables consulted directly: `reporters`, `article_authors`,
  `articles`, `evidence_entities`, `evidence_claims`, `accepted_relationships`,
  `evidence_ingest_runs`, `entity_external_ids`, `reporter_claims`
