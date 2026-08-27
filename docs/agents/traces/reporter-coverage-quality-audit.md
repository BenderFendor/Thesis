# Reporter coverage quality audit

## Goal and done criteria
Determine whether Atlas `research_coverage_by_entity_type["reporter"]` =
11,392/11,395 represents real, correctly-cited human bylines or is inflated
by junk denominator rows, wrong citations, duplicate humans, or wire-service
mislabeling. Read-only audit against live `newsdb` (2026-07-22); no code
changed.

## Scope note
`reporters` has 13,626 rows total; the coverage denominator only includes
rows with `article_count > 0` (atlas_graph_projection.py:121) = 11,395.
All numbers below use that population.

## 1. Denominator quality (full scan, 11,395 names)

| Tag | Count | % |
|---|---:|---:|
| clean_looking (no junk tag fired) | 9,170 | 80.47% |
| multi_author_string (" and ", "&", commas) | 1,343 | 11.79% |
| all_caps_agency_like | 384 | 3.37% |
| single_token | 347 | 3.05% |
| agency_or_desk (Reuters/AP/AFP/desk/correspondent) | 160 | 1.40% |
| absurd_length_long (>60 chars) | 151 | 1.33% |
| by_prefix ("BY ..." artifact) | 145 | 1.27% |
| has_digit | 56 | 0.49% |
| email embedded in name | 53 | 0.47% |
| absurd_length_short (AP/RT/SG) | 3 | 0.03% |
| paren_prefix_artifact | 1 | 0.01% |

Tags non-exclusive; 19.53% (2,225) fire at least one tag. Not all tags are
equally bad: all_caps is mostly real names in upstream caps style;
email/by_prefix/long are mostly one real reporter whose name field captured
a title/email (Jamaica Observer bylines dominate); agency_or_desk rows are
genuinely not individuals; multi_author_string is 2+ real humans stored as
one row (an undercount, not fabrication). Specimen confirmed: "(earlier)
Lucy Campbell" (id=5295, covered). The "[email protected]" row exists but
has article_count=0, so it is outside the denominator.

## 2. Claim correctness (200-reporter random sample, seed 20260722)
- article_authors link exists: 200/200
- URL well-formed http(s): 200/200
- Claim outlet matches articles.source: 197/200 (1.5% mismatch)

The 3 mismatches share one root cause: 5 catalog entries in
backend/app/data/rss_sources.py (The Atlantic - National, The Atlantic
Wire, RealClearPolitics, Breitbart, Ekathimerini) share
`site_url: "https://feedburner.com"`, so entity resolution collapses them
onto one entity ("The Atlantic" won). Full-corpus impact: 120 of 11,475
claims (1.05%) miscredited - 67 Ekathimerini and 53 Breitbart reporters
show authored_by -> "The Atlantic".

## 3. Live spot-check (10 URLs)
4 confirmed on-page, 0 not-found, 6 unverifiable (403/paywall blocks). One
live fetch independently surfaced a real multi-author byline credited to a
single reporter, corroborating section 1.

## 4. Duplicate humans
Within the 11,395: 375 duplicate-name groups, 774 reporters, 399 excess
rows (~3.5% inflation). Root cause: article_authors is scoped per RSS feed
entry, so feed variants (The Guardian vs The Guardian - UK) and wire
syndication (AP staff appearing at multiple client outlets) mint separate
rows. Verified real cases: Eric Tucker x4, Lisa Mascaro x4, Joey
Cappelletti x4, Christopher Rugaber x3, Fatima Hussein x3, Mike Stobbe x3.

## 5. Semantic honesty (wire contamination)
`authored_by` means "wrote >=1 article in this outlet's feed", not
"employed by". 13 covered rows are literally agency names (AP, Reuters,
AFP, Bloomberg News, RT, Agencies...) producing claims like "AFP"
authored_by "Express Tribune". Named wire staff are attributed to
syndication clients (Washington Times, WHYY, NewsNation) instead of their
agency. Rough combined estimate: ~4-5% of covered reporters have an outlet
attribution that fails an employment reading, even though the literal
byline-to-article fact is true.

## Verdict
Of 11,392 covered reporters:
- ~77% (~8,750): real individual humans with a correctly-cited byline.
- ~13% (~1,500): junk entity rows - multi-author strings (1,343, largest),
  agency/wire names (160), wire-code stubs (3).
- ~10% (~1,100): questionable - duplicate-name inflation (399), dirty-name
  artifacts (~350), wire staff mis-attributed to syndication clients.
Bands overlap; treat as rough shares. The byline-to-article linkage itself
is trustworthy (0% broken links, 0% malformed URLs, 4/4 live
confirmations). Inflation comes from what counts as a "reporter", plus one
cheap data bug (feedburner domain collision).

## Recommendations (ranked by impact)
1. Fix the feedburner.com site_url collision for the 5 catalog entries in
   rss_sources.py (fixes 120 wrong-outlet claims); scan for other shared
   site_url values.
2. Split multi-author byline strings upstream before they reach
   `reporters` (split on " and ", ",", "&", "/"). Largest category; fixing
   it raises the true distinct-reporter count.
3. Merge duplicate-name reporters (feed-variant / wire-syndication
   pattern). Removes ~399 inflated credits.
4. Mark or drop the 13 pure-agency rows; stop minting misleading
   authored_by -> syndication-client edges for wires.
5. Clean (not drop) dirty-name rows (~350): strip trailing titles/emails;
   the person and byline link are usually correct.

## Assumptions and risks
- Regex classification, not NER; all_caps over-flags real names and is
  excluded from the junk estimate.
- Sample n=200 and 10 live fetches, seed 20260722, reproducible; 60% live
  block rate limits web confirmation - the DB join check is the stronger
  signal.
- Wire contamination is a lower-bound proxy; exact figure needs a curated
  wire-staff roster.
