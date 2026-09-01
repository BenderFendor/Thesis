# Multi-Objective Quality Hardening Architecture

> Branch: `quality/crap-mi-oxlint-hardening`
>
> Purpose: provide a durable design brief for evolving the current quality-hardening campaign from a large ordered backlog of MI/CCCC/CRAP/Oxlint findings into a principled, agent-directed, multi-objective repair system. This document is intentionally verbose. A fresh agent should be able to use it as the architectural basis for implementation without relying on chat history.
>
> Related branch artifacts:
>
> - `docs/agents/quality-hardening/HANDOFF-PLAN.md`
> - `docs/agents/quality-hardening/OXLINT-ERROR-INVENTORY-2026-09-01.md`
> - `docs/agents/quality-hardening/combined-driver.json`
> - `docs/agents/quality-hardening/mi-by-file.json`
> - `docs/agents/quality-hardening/wave3-manifest.md`
> - `scripts/check-complexity`
> - `scripts/check-maintainability.mjs`
> - `scripts/codemod-lint-mechanical.mjs`
>
> This document does **not** replace the verified tool quirks, rule-resolution decisions, or branch-specific acceptance gates in `HANDOFF-PLAN.md`. It describes the next-generation orchestration model that should sit above those tools.

---

## 1. Executive thesis

The current branch is not dealing with one homogeneous class of problem. It is observing the codebase through several partially overlapping sensors:

- CCCC / cyclomatic / cognitive-complexity gates detect control-flow and reasoning complexity.
- Maintainability Index combines complexity, size, and Halstead-style measures into a higher-level maintainability heuristic.
- CRAP combines complexity with test coverage to estimate the risk of complicated, insufficiently tested code.
- Oxlint emits thousands of concrete, source-local diagnostics spanning correctness, type integrity, API design, React rules, architecture, test style, naming, conventions, and mechanically enforceable policies.
- Additional gates such as duplication, cycles, dead exports, import resolution, type checking, tests, and builds observe still other aspects of the system.

These signals are useful, but they are **not independent objectives**. Many are different projections of the same underlying structural defect. Cyclomatic complexity, for example, influences CCCC directly, Maintainability Index indirectly, and CRAP directly; complex functions also tend to produce more nesting, ternaries, strict-boolean findings, magic-number findings, JSX-depth violations, and other lint symptoms. Treating every metric and every diagnostic as an independent unit of debt double-counts correlated problems and gives misleading priorities.

The target architecture therefore should **not** be:

```text
all metrics -> arbitrary weighted sum -> one score -> fix highest score
```

It should be:

```text
raw measurements and diagnostics
            |
            v
normalize by abstraction level and quality factor
            |
            v
infer/root-cause structural clusters
            |
            v
classify repair as structural vs mechanical
            |
            v
select a repair under multi-objective constraints
            |
            v
single writer applies change
            |
            v
re-run all relevant deterministic evaluators
            |
            v
record actual effects, cost, failures, and recurring patterns
            |
            +-----------------------------+
                                          |
                                          v
                         improve future scheduling and codemods
```

The strongest conceptual rule is:

> **Do not instruct an agent to optimize MI, CRAP, CCCC, or Oxlint independently. Instruct it to improve a code unit while preserving behavior, and treat all metrics as overlapping evidence plus hard gates.**

The system should expose a scalar such as **hardening debt** only for progress reporting and scheduling cost, not as a claim that software quality itself can be faithfully reduced to one number.

---

## 2. Why the current problem is historically familiar

The branch is rediscovering several old software-engineering problems at once. The novelty is not that the individual ideas are unprecedented; the interesting part is that modern coding agents make it practical to combine them into one closed-loop maintenance controller.

### 2.1 Single complexity metrics

Cyclomatic complexity dates to McCabe's work in the 1970s. It gives a useful approximation of control-flow complexity but is only one dimension. It cannot, by itself, express naming quality, coupling, type unsafety, duplicated concepts, architectural violations, poor tests, or many forms of cognitive friction.

### 2.2 Maintainability Index: an early attempt at one number

Maintainability Index is itself an answer to a question similar to ours: can multiple source metrics be condensed into one maintainability score? Variants combine cyclomatic complexity, LOC, Halstead volume, and sometimes comments.

That is useful for ranking suspicious code, but it also demonstrates the central danger of scalar quality models: the score inherits all assumptions and blind spots of the formula. It can reward fragmentation, fail to capture abstraction quality, and combine correlated inputs as though they were independent.

### 2.3 SIG maintainability models

Later maintainability work moved away from treating one formula as a universal truth and instead modeled multiple source properties that influence higher-level maintainability characteristics. This is conceptually closer to what this branch needs: primitive measures should feed broader factors, rather than every derived index becoming a separate vote.

### 2.4 Squale and Quamoco: closest conceptual precedent

Squale and Quamoco are particularly relevant because they attempted to bridge low-level source measurements and higher-level software quality. Their broad shape was hierarchical:

```text
raw measurements / rule violations
              |
              v
technical practices or product factors
              |
              v
quality characteristics
              |
              v
high-level maintainability / quality view
```

That resembles the distinction emerging in this branch:

```text
Oxlint finding at line 211
cyclomatic complexity of function X
coverage of function X
LOC / Halstead / nesting
              |
              v
structural complexity
change risk
type integrity
architectural conformance
mechanical convention debt
              |
              v
repo hardening state
```

Quamoco is therefore a useful mental model: **lint diagnostics are measurements, not peers of abstract qualities**. A specific `strict-boolean-expressions` error and a repo-level notion such as maintainability operate at different levels of abstraction.

### 2.5 SQALE and technical debt

SQALE and later Sonar-style systems introduced another important idea: rather than pretending unlike metrics have naturally comparable units, convert actionable issues into **remediation cost**.

That does not answer "how good is this software?" It answers "how much remediation work remains?" This distinction is valuable for agentic hardening.

For this branch, the analogous scalar should be something like:

```text
Hardening debt
  = expected repair actions
  + expected verification work
  + expected model/tool cost
  + unresolved structural root causes
```

not a mathematically dubious universal `QUALITY = 83.4`.

### 2.6 Search-based software engineering and Pareto refactoring

Search-based refactoring research explicitly encountered the problem that refactorings can improve one metric while worsening another. Researchers therefore treated refactoring as multi-objective optimization and used Pareto fronts rather than forcing every objective into an arbitrary weighted sum.

This is directly applicable here. A structural rewrite may temporarily increase local lint findings while sharply improving cyclomatic complexity, cognitive complexity, MI, and testability. A naive monotonic rule such as "Oxlint count must never increase after any patch" would reject a globally beneficial transition and trap the system in a local minimum.

### 2.7 Large-scale deterministic transformation

Coccinelle, ClangMR, Refaster, OpenRewrite, jscodeshift-style systems, and other codemod frameworks demonstrate a long-standing strategy for very large migrations:

1. identify a repeated syntactic/semantic pattern;
2. encode a transformation once;
3. validate it carefully;
4. apply it across hundreds or thousands of sites.

The modern agent should therefore **author and validate transformations**, not manually perform every repetitive edit.

### 2.8 Learned repair systems

Systems such as Getafix pushed this further by clustering previous fixes and learning reusable AST repair patterns for static-analysis findings. This is extremely close to the proposed agent loop:

```text
hundreds of similar Oxlint diagnostics
      |
representative examples
      |
agent infers repair pattern
      |
agent writes deterministic transform
      |
fixtures + typecheck + lint + tests
      |
repo-wide application
```

### 2.9 Modern harness engineering

Current coding-agent work adds the missing piece: a model can reason about context-sensitive changes while deterministic analyzers act as evaluators. The important unit is no longer merely "model quality" but:

```text
model
+ task decomposition
+ tools
+ context selection
+ persistent state
+ deterministic feedback
+ verification
+ retry/escalation policy
```

This branch should be designed as a harness around those capabilities rather than as a giant prompt that asks Codex to "fix all 13k errors."

---

## 3. The central taxonomy: sensors, factors, derived views, constraints

A major architectural cleanup is to stop treating every currently visible number as the same kind of thing.

### 3.1 Primitive sensors

Primitive measurements should be as close as possible to directly observed properties:

- cyclomatic complexity;
- cognitive complexity;
- LOC / executable LOC;
- nesting depth;
- Halstead-derived quantities if available;
- coverage by function/file;
- branch coverage;
- mutation score if introduced later;
- duplication / clone measurements;
- dependency cycles;
- fan-in / fan-out / coupling if introduced later;
- churn/history if introduced later;
- concrete Oxlint diagnostics grouped by rule;
- TypeScript/compiler errors;
- import-resolution failures;
- test failures;
- build failures.

These are sensors. They should be persisted in machine-readable snapshots.

### 3.2 Derived views

MI, CRAP, CCCC hard-failure counts, and similar indexes are useful **derived reports** over primitive measurements.

Conceptually:

```text
cyclomatic complexity ----+----> CCCC / complexity gate
                          |
                          +----> Maintainability Index
                          |
                          +----> CRAP

LOC / Halstead -----------+----> Maintainability Index

coverage -----------------+----> CRAP
```

Consequently, a function that fails MI, CRAP, and CCCC does not necessarily represent three unrelated defects. It may represent one structural pathology observed by three partially redundant sensors.

### 3.3 Quality factors

The controller should map primitives into broader factors. A practical first model for this repository is:

#### Structural quality

Signals:

- cyclomatic complexity;
- cognitive complexity;
- nesting;
- function size;
- excessive JSX depth;
- structural lint rules;
- duplication;
- possibly coupling/cycles.

Interpretation:

> How difficult is the implementation structure to understand and modify?

#### Change risk / test protection

Signals:

- coverage;
- CRAP;
- branch coverage;
- mutation score if later added;
- churn and centrality if later added;
- high complexity in insufficiently tested code.

Interpretation:

> How dangerous is it to modify this code without introducing undetected behavior changes?

#### Correctness and type integrity

Signals:

- correctness-category Oxlint rules;
- suspicious expressions;
- unsafe type operations;
- type assertions;
- widening/unknown/any-related issues;
- TypeScript errors;
- import-resolution failures.

Interpretation:

> How much concrete evidence exists of unsound, suspicious, or weakly specified behavior?

#### Architectural/API conformance

Signals:

- import/export policies;
- dependency cycles;
- module boundaries;
- framework-specific API rules;
- testing architecture such as prohibited module mocking;
- dead exports;
- public/private API misuse.

Interpretation:

> Does the code obey the repository's intended architecture and module contracts?

#### Mechanical/convention debt

Signals:

- filename case;
- globalThis preferences;
- readonly parameter rules when mechanically resolvable;
- regexp conventions;
- named constants;
- other highly repetitive lint findings.

Interpretation:

> How much standardized, low-ambiguity cleanup remains?

#### Verification state

Signals:

- tests;
- typecheck;
- import check;
- build;
- backend checks;
- Rust checks;
- schema drift checks.

Interpretation:

> Is the current candidate state admissible at all?

Verification should normally be a **constraint**, not a quantity that can be traded away for better scores elsewhere.

---

## 4. Why one weighted score is dangerous

The current `combined-driver.json` is useful as a rough worklist, but a simple score such as:

```text
score = oxlint + 3 * mi_failures + 2 * complexity_failures + crap
```

has multiple conceptual problems.

### 4.1 Correlated metrics are counted multiple times

If one function has high CC:

- the complexity gate sees it;
- MI degrades partly because of it;
- CRAP degrades partly because of it;
- lint may emit nested-control-flow or related structural findings.

Summing these treats correlated observations as separate independent reasons.

### 4.2 Units are incomparable

An MI deficit of 10, one CRAP failure, one filename-case lint error, and one unsafe type error are not naturally commensurable quantities.

### 4.3 Weights encode hidden policy

Choosing `MI * 3` and `lint * 1` silently asserts a value judgment about repair priority. Those weights are difficult to justify scientifically and may become wrong as the branch changes.

### 4.4 Scalar optimization creates Goodhart pressure

If the agent is told to minimize one score, it may discover degenerate strategies:

- split functions excessively to satisfy MI;
- write superficial tests only to reduce CRAP;
- move complexity into more layers rather than actually simplify concepts;
- suppress lint findings;
- weaken configuration;
- introduce abstractions that improve a metric while making navigation worse.

The controller must distinguish **improving the software** from **gaming the sensors**.

---

## 5. Prefer hierarchy + Pareto reasoning over one quality number

The recommended scheduling model has three layers.

### 5.1 Hard constraints

These are normally non-negotiable:

- no new lint suppressions;
- no rule weakening;
- no `ts-ignore` / `@ts-nocheck` / inappropriate `ts-expect-error`;
- no deleted/skipped tests merely to pass;
- no config changes by worker agents unless explicitly authorized;
- import resolution must not regress;
- typecheck must not regress;
- behavior tests must not regress;
- build must not regress when in the relevant verification stage;
- assertions obey the existing `SAFETY:` policy;
- current branch-specific tool quirks in `HANDOFF-PLAN.md` remain authoritative.

### 5.2 Multi-dimensional quality state

Represent each repair target using a vector instead of one score. For example:

```json
{
  "unit": "frontend/lib/api.ts::mapArticle",
  "structural": {
    "cyclomatic": 22,
    "cognitive": 31,
    "loc": 184,
    "mi": 37
  },
  "risk": {
    "coverage": 0.42,
    "crap": 71.3
  },
  "conformance": {
    "oxlint_total": 48,
    "oxlint_by_factor": {
      "correctness": 3,
      "type_integrity": 6,
      "structural": 21,
      "architecture": 2,
      "mechanical": 16
    }
  }
}
```

### 5.3 Pareto and class-based scheduling

Do not require a universal ordering for every target. First classify urgency:

```text
P0 behavioral/compiler/import breakage
P1 pathological structural hotspots
P2 high-risk complicated code with weak tests
P3 moderate structural debt
P4 large mechanical lint clusters
P5 isolated contextual lint findings
```

Within a class, use Pareto dominance and estimated repair leverage/cost.

Target A dominates target B if A is at least as bad on every relevant dimension and strictly worse on at least one. Dominated work can usually be postponed behind frontier items.

This avoids pretending that:

```text
A = 814 quality points
B = 793 quality points
```

has scientific meaning.

---

## 6. Important metric paradoxes the controller must explicitly handle

### 6.1 CCCC can reach zero while Oxlint barely changes

This is expected, not evidence that the complexity campaign failed.

A function can be decomposed from one highly branched 300-line function into several coherent helpers. CCCC can move from a hard failure to fully compliant while local lint diagnostics remain nearly unchanged because those diagnostics describe separate local properties: unsafe types, naming, readonly parameters, magic constants, API conventions, React rules, etc.

Therefore:

> **A successful structural refactor does not require a proportional immediate drop in Oxlint count.**

### 6.2 Structural repair can temporarily increase Oxlint

Extraction creates more boundaries:

- more function parameters;
- more imports;
- more names;
- more interfaces;
- more readonly concerns;
- more type boundaries.

A high-quality intermediate state can therefore look like:

```text
before:
  CC 27
  MI 34
  Oxlint 140

after structural rewrite:
  CC 8
  MI 61
  Oxlint 176

after lint normalization:
  CC 8
  MI 63
  Oxlint 0
```

A controller that rejects the intermediate state because `176 > 140` prevents the better path.

### 6.3 MI can reward helper soup

Repeated extraction can mechanically improve per-function MI while making the program harder to navigate. Therefore extraction must have a semantic justification.

Recommended invariant:

> Do not extract a helper solely to satisfy a metric. A helper should represent a coherent operation, domain concept, policy, reusable transformation, independent branch, or substantial reduction in local cognitive load.

Agents should explicitly state the reason for extraction in repair metadata.

### 6.4 CRAP can be improved by tests without simplifying code

This is not wrong—better coverage reduces change risk—but it is a different improvement than structural simplification.

The controller should distinguish:

```text
CRAP improvement via complexity reduction
```

from:

```text
CRAP improvement via coverage increase
```

Both are valuable, but they answer different questions.

### 6.5 Complexity can be moved rather than removed

An agent can lower a function's complexity by distributing it across helpers while preserving the same conceptual maze. Track at least file/module-level structural summaries in addition to per-function thresholds so complexity migration is visible.

### 6.6 Local lint cleanup can worsen maintainability

A purely local fix can introduce verbose wrappers, extra conditionals, or awkward abstractions that technically satisfy a lint rule while making structure worse. Therefore contextual lint workers must re-run structural metrics on touched units.

### 6.7 Full monotonicity is the wrong acceptance criterion

The correct invariant is not:

```text
every metric must improve after every intermediate edit
```

It is closer to:

```text
hard constraints never regress
accepted repair sequence has a clear end-state improvement
structural rewrites may temporarily create mechanical debt
mechanical cleanup must eventually close that debt
no unresolved catastrophic dimension is hidden by improvement elsewhere
```

---

## 7. Oxlint is a different abstraction layer and must be decomposed

A raw count such as `13,000 Oxlint errors` is not a useful quality dimension. It mixes unlike things.

Create a repository-maintained mapping from each enabled rule to a factor and remediation class.

Example:

```json
{
  "typescript/strict-boolean-expressions": {
    "factor": "type_integrity",
    "repair_class": "contextual",
    "structural_overlap": "medium"
  },
  "react/jsx-max-depth": {
    "factor": "structural",
    "repair_class": "structural_or_contextual",
    "structural_overlap": "high"
  },
  "unicorn/filename-case": {
    "factor": "mechanical",
    "repair_class": "codemod",
    "structural_overlap": "none"
  }
}
```

Suggested first factor taxonomy:

### Correctness

Examples:

- impossible or suspicious conditions;
- likely runtime mistakes;
- unsafe assumptions;
- incorrect API use.

### Type integrity

Examples:

- unsafe `any` propagation;
- known-value widening;
- unsafe assertions;
- unknown-return/parameter problems;
- strict boolean issues when they expose ambiguous domain semantics.

### Structural maintainability

Examples:

- JSX depth;
- nested control flow;
- excessive branching rules;
- function-size-like policies;
- rules that are really symptoms of one oversized unit.

### Architecture/API

Examples:

- import/export organization;
- module boundaries;
- framework conventions;
- testing architecture such as `no-module-mocking`.

### Testing

Examples:

- Jest-specific behavior;
- assertion conventions;
- mock policies;
- test reliability findings.

### Mechanical convention

Examples:

- filename case;
- `globalThis`;
- unicode regexp preference;
- readonly transformations that are provably mechanical;
- naming/constant extraction when semantics are obvious.

The rule map allows the scheduler to distinguish:

```text
500 filename-case errors
```

from:

```text
500 correctness/type-safety errors
```

without pretending their raw counts have equal meaning.

---

## 8. Replace error-centric scheduling with root-cause-centric scheduling

The fundamental unit of work should not be an individual diagnostic and should not always be a file. It should be a **repair cluster**.

A repair cluster is a set of observations likely to share one cause or one transformation.

Examples:

### Structural cluster

```text
unit: frontend/lib/api.ts::mapArticle

observations:
  MI below threshold
  CC above threshold
  cognitive above threshold
  CRAP above threshold
  18 no-magic-number findings
  7 strict-boolean findings
  4 nested-control-flow findings

hypothesis:
  oversized mixed-responsibility transformation pipeline

repair:
  split parsing / normalization / mapping policies into coherent helpers

codemod suitability:
  low
```

### Mechanical cluster

```text
rule: unicorn/filename-case
scope: frontend/hooks/**
instances: 17

hypothesis:
  repeated deterministic kebab-case migration

repair:
  rename files + rewrite imports + check import graph

codemod suitability:
  high
```

### Type-boundary cluster

```text
scope: response parsing helpers
rules:
  no-unknown-returns
  no-known-value-widening
  assertion safety

hypothesis:
  external data crosses boundary without schema validation

repair:
  consolidate through zod parsing boundary

codemod suitability:
  medium/low
```

The clustering stage should attempt to infer whether many diagnostics are symptoms of one structural unit before dispatching independent lint tasks.

---

## 9. Two primary classes of mutation

### 9.1 Structural repair

Trigger structural repair when a unit has one or more strong structural signals:

- MI below threshold;
- cyclomatic complexity above threshold;
- cognitive complexity above threshold;
- CRAP above threshold where complexity is materially responsible;
- strong structural-lint cluster;
- duplicated or tangled logic that explains many local findings.

Worker objective:

> Improve the implementation structure while preserving behavior. Do not chase every incidental lint finding until the new structure is stable.

Structural completion conditions should evaluate:

- target structural threshold(s);
- semantic coherence of extracted units;
- tests/type/import gates;
- no unacceptable architecture regression;
- measurement of newly created mechanical lint debt;
- a follow-up lint cleanup task if needed.

### 9.2 Mechanical/contextual cleanup

After structural shape is stable, remaining lint findings are grouped by rule and recurring pattern.

Repair ladder:

```text
native Oxlint safe fix?
        |
       yes -> use it
        |
       no
        v
existing proven codemod?
        |
       yes -> use it
        |
       no
        v
can a deterministic AST transform be derived?
        |
       yes -> agent authors transform + fixtures
        |
       no
        v
contextual agent repair
```

The model should be used as low in this ladder as practical.

---

## 10. Codemod promotion: convert repeated reasoning into deterministic tooling

The branch already has `scripts/codemod-lint-mechanical.mjs` and has learned an important lesson: some transformations are safe and some historically corrupted files. That history should become explicit policy and regression coverage.

### 10.1 Promotion trigger

Whenever an agent solves the same pattern repeatedly, record it. Suggested initial trigger:

```text
same rule + materially same repair pattern observed >= 3 times
```

Then ask a dedicated transformation task:

> Can this repair be represented as a deterministic AST/semantic transformation with bounded preconditions?

### 10.2 Promotion requirements

A new codemod is not considered safe because it worked once. Require:

1. representative before/after fixtures;
2. positive cases;
3. negative cases that must remain unchanged;
4. idempotence: second run produces no diff;
5. scoped lint improvement;
6. typecheck success;
7. import-resolution success where relevant;
8. targeted tests where relevant;
9. no new diagnostics outside the intended class;
10. documentation of assumptions and known exclusions.

### 10.3 Never repeat known failed transformation classes blindly

The existing handoff records that some transformations, such as the previous `oneVar` approach, corrupted files. That failure should be encoded as durable tests or explicit disabled rules rather than remembered only in prose.

### 10.4 Codemod economics

Track leverage:

```text
codemod leverage = diagnostics removed / authoring-and-verification cost
```

A model call that produces one proven transform removing 800 findings is vastly preferable to 800 context-editing calls.

---

## 11. Single mutable checkout; parallelize analysis, not writes

Do **not** require Git worktrees for this architecture.

The preferred model for this repository is a **single writer**:

```text
                     read-only analysis agents
                    /          |             \
              CRAP analysis  MI analysis  Oxlint clustering
                    \          |             /
                     central task / patch queue
                                |
                                v
                         ONE MUTATING AGENT
                                |
                                v
                           deterministic
                            verification
                                |
                         accept / reject
```

Reasons:

- avoids duplicate dependency trees and disk use;
- avoids worktree clutter;
- avoids merge conflicts among simultaneous structural rewrites;
- ensures every task sees one authoritative evolving state;
- simplifies rollback and measurement;
- makes ordering explicit.

Parallel reasoning can still be useful. Agents may analyze snapshots or return proposed patches/repair plans, but only one controller/worker mutates the branch at a time.

A more advanced version may allow read-only worker agents to produce patch files. The controller then serially:

1. checks touched-file ownership;
2. applies patch;
3. runs verification;
4. accepts or rejects;
5. re-measures before applying the next patch.

This preserves parallel thought without parallel repository state.

---

## 12. Persistent campaign state

Do not rely on one long chat context or one giant Markdown inventory. Keep machine-readable state.

Suggested directory:

```text
docs/agents/quality-hardening/state/
  baseline.json
  current.json
  units.jsonl
  clusters.jsonl
  tasks.jsonl
  attempts.jsonl
  transformations.json
  effects.jsonl
  failures.jsonl
  rule-taxonomy.json
  metric-correlations.json
  pareto-frontier.json
```

Potential alternative for runtime-generated state:

```text
.quality-hardening/
```

with only durable summaries committed. Choose one policy and document it.

### 12.1 Task record

Example:

```json
{
  "id": "QH-0042",
  "class": "structural",
  "scope": ["frontend/lib/api.ts"],
  "unit": "mapArticle",
  "root_cause": "mixed parsing and normalization responsibilities",
  "observations": {
    "cc": 22,
    "cognitive": 31,
    "mi": 37,
    "crap": 71.3,
    "oxlint": 48
  },
  "constraints": [
    "preserve behavior",
    "no suppressions",
    "typecheck no regression",
    "imports no regression"
  ],
  "status": "queued"
}
```

### 12.2 Attempt record

```json
{
  "task": "QH-0042",
  "attempt": 1,
  "repair": "extract parse/normalize/map helpers",
  "changed_files": 3,
  "verification": {
    "tsc": "pass",
    "imports": "pass",
    "tests": "pass"
  },
  "before": {
    "cc": 22,
    "mi": 37,
    "crap": 71.3,
    "oxlint": 48
  },
  "after": {
    "cc": 7,
    "mi": 64,
    "crap": 18.1,
    "oxlint": 57
  },
  "temporary_mechanical_debt": 9,
  "accepted": true
}
```

The temporary lint increase is explicitly visible rather than misclassified as failure.

---

## 13. Learn from actual repair effects instead of inventing permanent weights

Every accepted repair is a data point. Record the delta vector:

```text
Delta = {
  CC,
  cognitive,
  MI,
  CRAP,
  coverage,
  lint-by-factor,
  duplication,
  cycles,
  tests,
  files touched,
  diff size,
  verifier failures,
  tool/model cost
}
```

After enough repairs, estimate a transformation-effect table:

```text
repair strategy             CC      MI      CRAP    lint-struct   lint-mech
----------------------------------------------------------------------------
extract coherent helper     -8      +14     -17        -5           +2
replace nested branch       -3       +6      -7        -4            0
split JSX subcomponent      -5      +11      -9       -18           +3
add tests                    0        0     -24         0            0
readonly codemod             0        0       0         0          -90
rename/import codemod        0        0       0         0         -140
```

This allows the scheduler to ask:

> Given the current profile, which historically successful repair class is likely to yield the broadest useful improvement for the lowest verification cost?

This is much stronger than permanently guessing that `MI` deserves weight 3 and `Oxlint` weight 1.

---

## 14. Empirically measure redundancy among metrics

The branch can test its own assumptions instead of relying only on theory.

At function/file level, collect:

- cyclomatic complexity;
- cognitive complexity;
- LOC;
- MI;
- coverage;
- CRAP;
- Oxlint total;
- Oxlint grouped by factor;
- duplication/coupling where available.

Then compute at minimum:

- Spearman correlation matrix;
- rank correlations between derived metrics and primitives;
- hierarchical clustering of metrics;
- optional PCA/factor analysis if the sample is large and measurement semantics are clear.

Example hypothetical result:

```text
             CC    COG    MI    CRAP   lint-struct   lint-mech
CC          1.00   .89   -.76   .81       .58          .08
COG          .89  1.00   -.71   .65       .63          .10
MI          -.76  -.71   1.00  -.67      -.49         -.06
CRAP         .81   .65  -.67   1.00       .41          .03
lint-struct  .58   .63  -.49   .41      1.00          .17
lint-mech    .08   .10  -.06   .03       .17         1.00
```

If the real repository resembles this, the data would support the intuition that:

```text
CC + cognitive + MI + CRAP + structural lint
```

share a latent structural factor, while mechanical lint is substantially independent.

Persist this analysis so future agents do not rediscover the same relationships.

---

## 15. Hardening debt as the optional scalar

If one headline number is desired, make it a **work/debt estimate**, not a universal quality score.

Potential representation:

```text
Hardening debt
==============
root causes remaining:          173
mechanical clusters remaining:   41
contextual lint tasks:           96
expected repair actions:        214
expected verifier runs:         391
historical success probability: 87%
```

If model/tool telemetry is available:

```text
estimated agent tokens remaining
estimated tool executions
estimated wall-clock work based on measured throughput
```

Do not fabricate those values; they must be learned from actual campaign history.

A SQALE-like cost model can initially use ordinal classes:

```text
XS deterministic one-line/codemod cleanup
S  local contextual lint repair
M  one coherent function refactor
L  cross-function/module structural refactor
XL architectural repair
```

Later replace estimates with empirical distributions from recorded attempts.

---

## 16. Scheduling algorithm

A practical first scheduler can be deterministic and understandable.

### Stage 1: exclude inadmissible repo state

Before campaign scheduling, fix P0 failures:

- syntax/compiler failures;
- broken imports;
- corrupted partial edits;
- failing tests caused by the branch;
- malformed generated artifacts.

### Stage 2: create structural units

Parse MI, complexity, CRAP, coverage, and structural lint into function/file units.

### Stage 3: create mechanical/contextual lint clusters

Group remaining lint by:

1. rule;
2. directory/module;
3. recurring AST/context pattern;
4. repair class.

### Stage 4: infer overlap/root cause

Where a high-complexity unit also owns many structural lint findings, attach those findings to the structural cluster rather than scheduling them independently.

### Stage 5: priority class

```text
P1 structural pathology
P2 high CRAP/change risk
P3 moderate structural debt
P4 high-leverage codemod/mechanical cluster
P5 contextual lint tail
```

There is a deliberate policy choice here: a massive safe codemod may jump ahead of moderate structural work because its leverage is enormous and risk is low. The scheduler should allow this when verification cost is small.

### Stage 6: Pareto frontier

Within each class, calculate non-dominated candidates from relevant normalized dimensions.

### Stage 7: expected utility

Use a transparent scheduling heuristic, not a "quality formula":

```text
expected utility
  = expected useful debt removed
    * historical success probability
    / expected repair + verification cost
```

This is a scheduling estimate only. It does not redefine software quality.

### Stage 8: dispatch one mutation

Single writer edits one bounded cluster.

### Stage 9: verify and remeasure

Do not continue from stale inventory. Recompute affected units and update global counts.

### Stage 10: learn

Record outcome, update repair effects, success rates, batch sizes, and codemod candidates.

---

## 17. Adaptive batch sizing

Different error classes tolerate radically different batch sizes.

Examples:

```text
filename-case deterministic rename       potentially hundreds
safe readonly transform                  potentially hundreds
no-unused-style local cleanup            dozens/hundreds
strict boolean contextual repair         small batches
no-module-mocking / DI conversion        one component/test cluster
complex structural hotspot               one unit at a time
```

Use measured success to adapt:

```text
start 10
if clean repeated success -> 25 -> 50 -> 100
if verifier failure rate rises -> halve batch
```

Persist learned batch size by rule/repair strategy.

Do not globally assume "100 errors per agent".

---

## 18. Retry and escalation policy

Never repeat the same failed repair with the same context indefinitely.

Suggested ladder:

```text
attempt 1: standard worker, bounded context
attempt 2: worker receives verifier failure + relevant dependencies
attempt 3: stronger reasoning / architecture analysis
attempt 4: derive alternate repair strategy
attempt 5: mark blocked with concrete evidence
```

Every retry must add information or change strategy.

Blocked state should include:

- exact failing gate;
- exact commands;
- minimal relevant output;
- attempted transformations;
- why previous attempts failed;
- whether blocker is tool/config/environment/architecture/unknown.

A repeated failure should eventually create **new harness capability**, a regression fixture, a codemod exclusion, or a documented architecture rule. Do not merely ask the model to try harder.

---

## 19. Agent roles

Even with one writer, responsibilities can be separated conceptually.

### Analyzer

Read-only.

- parses snapshots;
- clusters diagnostics;
- proposes root causes;
- identifies repeated patterns;
- estimates repair class.

### Structural repair worker

Mutating.

- works on one bounded structural cluster;
- preserves behavior;
- creates coherent abstractions;
- avoids metric gaming.

### Codemod author

Mutating only in tooling/fixtures scope until promotion.

- derives deterministic transform;
- creates positive/negative fixtures;
- proves idempotence and bounded behavior.

### Mechanical cleanup worker

Mutating.

- applies proven transforms;
- handles simple contextual tail;
- avoids architectural rewrites unless escalated.

### Evaluator/checker

Preferably logically separate from the repair worker.

- runs deterministic gates;
- compares before/after vectors;
- checks forbidden changes;
- determines accept/reject/escalate.

### Controller

- owns the queue;
- is the only authority that advances campaign state;
- maintains single-writer discipline;
- schedules remeasurement;
- promotes recurring patterns to codemod work.

---

## 20. Verification model

The checker should distinguish **hard regressions** from **temporary metric tradeoffs**.

### Hard reject examples

- behavior tests newly fail;
- compiler errors newly appear;
- imports break;
- lint suppressions are introduced;
- lint config is weakened;
- tests are skipped/deleted to pass;
- unrelated source files are modified beyond scope without justification;
- known safe transformation preconditions are violated.

### Conditional acceptance examples

A structural patch may be accepted when:

- CC/cognitive/MI improve materially;
- semantic decomposition is coherent;
- tests and type/import gates pass;
- Oxlint temporarily increases only in mechanical/contextual categories;
- a deterministic follow-up cleanup task is generated.

### End-of-cluster acceptance

The complete repair sequence should leave no unexplained regression in the quality vector. If a dimension worsens, the system should either:

- demonstrate why the tradeoff is intended and bounded;
- schedule/complete a follow-up;
- or reject the sequence.

---

## 21. Root-cause graph

A useful next-generation representation is a graph rather than a flat list.

Example:

```text
root cause: giant mixed-responsibility React component
      |
      +--> CC violation
      +--> cognitive violation
      +--> MI failure
      +--> CRAP failure
      +--> JSX depth x 23
      +--> nested ternary x 8
      +--> strict boolean x 11
      +--> magic number x 19
```

A single structural repair can invalidate dozens of leaf diagnostics. Therefore the controller should **re-run analyzers after structural work** rather than expecting workers to resolve every old leaf finding manually.

Potential persisted graph record:

```json
{
  "root": "RC-0118",
  "unit": "frontend/components/example.tsx::Example",
  "hypothesis": "mixed rendering/state/policy responsibilities",
  "signals": [
    "MI-55",
    "CC-22",
    "COG-31",
    "OXLINT-1001",
    "OXLINT-1002"
  ],
  "confidence": 0.81
}
```

Confidence is optional. Do not fabricate pseudo-precision; if implemented, derive it from deterministic overlap rules or calibrated historical outcomes.

---

## 22. Transformation-effect graph

In addition to root causes, learn how repair classes affect metrics.

Example:

```text
split JSX subcomponent
   |---- usually decreases cognitive complexity
   |---- usually improves MI
   |---- usually removes jsx-max-depth
   |---- may increase readonly-prop findings
   |---- may increase import/export findings
```

This creates a causal-ish operational graph of **what tends to happen in this repository**, not a universal software law.

The scheduler can use this to avoid surprises and pre-plan cleanup sequences.

---

## 23. Metric-order experiments

Instead of assuming one universal ordering such as MI -> CCCC -> Oxlint, test ordering strategies on bounded clusters.

Potential experiments:

### Structural-first

```text
structural rewrite -> Oxlint mop-up -> tests/coverage
```

### Risk-first

```text
characterization tests -> structural rewrite -> Oxlint mop-up
```

### Mechanical-first where safe

```text
large proven codemod -> remeasure -> structural rewrite
```

Record:

- total changed lines;
- verifier failures;
- total model/tool cost;
- final metric vector;
- number of follow-up fixes;
- regressions.

The campaign can then select ordering empirically by cluster type.

---

## 24. Add code churn and dependency centrality later, if useful

Current metrics mostly describe code shape and tests. They do not necessarily describe business/operational importance.

A function with mediocre complexity that changes every week and sits on a central API path may deserve attention before a worse but dead-stable utility.

Potential future risk factor:

```text
change risk
  = structural complexity
  + insufficient tests
  + recent churn
  + dependency centrality
```

Do not add these merely because they exist. Add them only if they improve prioritization in measured cases.

---

## 25. Consider mutation testing as a stronger CRAP companion

Coverage can be gamed by executing code without meaningfully asserting behavior. CRAP inherits this limitation because coverage is part of the formula.

For the highest-risk units, mutation testing could distinguish:

```text
code executed by tests
```

from:

```text
tests actually detect semantic changes
```

This should be selective because mutation testing is expensive. It is best used on:

- high CRAP/high centrality units;
- code undergoing major structural rewrite;
- critical parsing/ranking/business logic.

Again, mutation score should become another sensor under change risk, not another independent score blindly added to everything else.

---

## 26. Avoid metric gaming explicitly

Create anti-Goodhart checks.

Examples:

### Helper explosion check

Warn when a refactor:

- sharply increases tiny one-use helpers;
- increases navigation depth;
- creates names that merely restate implementation steps;
- lowers per-function metrics without lowering module-level complexity.

### Test-only CRAP check

Record whether CRAP improvement came from:

- reduced complexity;
- increased coverage;
- both.

Do not misreport one as the other.

### Complexity migration check

Compare:

- target function;
- touched file;
- touched module.

If target CC falls but aggregate structural complexity is unchanged or worse, evaluator should inspect whether complexity was merely redistributed.

### Suppression/config check

Search diffs for:

- `oxlint-disable`;
- ESLint suppressions;
- TypeScript ignore comments;
- excluded paths;
- rule weakening;
- threshold changes.

These should be rejected unless the controller explicitly authorized infrastructure work.

---

## 27. Recommended CLI/interface for the controller

A simple agent-friendly CLI is preferable to dumping a 2.7 MB inventory into context.

Possible commands:

```bash
quality-hardening measure
quality-hardening summary
quality-hardening frontier
quality-hardening next
quality-hardening inspect QH-0042
quality-hardening inspect-rule typescript/strict-boolean-expressions
quality-hardening verify QH-0042
quality-hardening accept QH-0042
quality-hardening reject QH-0042 --reason ...
quality-hardening codemod-candidates
quality-hardening effects
quality-hardening correlations
```

### `summary`

Example:

```text
Structural root causes
  P1: 18
  P2: 42

Mechanical clusters
  proven codemod: 11
  candidate codemod: 7
  contextual: 31

Verification
  tsc: green
  imports: green

Top frontier
  QH-0042 api.ts::mapArticle
  QH-0051 debug/page.tsx::renderDebug
  QH-0109 filename-case hooks cluster
```

### `inspect`

Return only relevant context:

- unit metrics;
- attached lint findings;
- historical attempts;
- nearby symbols/dependencies;
- allowed/forbidden files;
- verification commands;
- expected completion conditions.

This is the agent-computer-interface layer. It should minimize irrelevant context.

---

## 28. Proposed on-disk implementation structure

One possible implementation:

```text
scripts/quality-hardening/
  cli.mjs
  measure.mjs
  normalize.mjs
  cluster.mjs
  taxonomy.mjs
  frontier.mjs
  scheduler.mjs
  verifier.mjs
  state.mjs
  effects.mjs
  correlations.mjs
  codemods/
    ...
  tests/
    measure.test.mjs
    cluster.test.mjs
    scheduler.test.mjs
    verifier.test.mjs
```

Do not create a large framework prematurely. Start with the minimum modules needed to replace manual inventory reading and arbitrary weighted ranking.

The system should consume the existing checkers where possible rather than reimplement them.

---

## 29. Suggested implementation phases

### Phase 0: stabilize current branch

Before building orchestration infrastructure:

- confirm current branch state;
- re-run existing gates;
- resolve any partial/corrupt edits documented in the handoff;
- regenerate machine-readable current inventory.

### Phase 1: normalize measurements

Create one machine-readable record per function/file with:

- complexity;
- MI;
- coverage/CRAP when available;
- lint grouped by rule;
- lint grouped by factor.

Do not change scheduling yet.

### Phase 2: rule taxonomy

Create and test `rule-taxonomy.json` for enabled Oxlint rules.

Every rule should have:

- factor;
- repair class;
- structural overlap;
- safe-fix/codemod status;
- verification requirements.

### Phase 3: structural root-cause clustering

Attach structural lint findings to MI/complexity/CRAP units.

Output root-cause candidates and explain why findings were grouped.

### Phase 4: replace scalar ranking

Implement:

- priority classes;
- normalized dimensions;
- Pareto frontier;
- simple expected-cost heuristic.

Keep `combined-driver.json` for comparison during migration.

### Phase 5: single-writer task loop

Implement queue state and before/after verification records.

### Phase 6: codemod promotion loop

Formalize current codemods into tested transformations with positive/negative fixtures and idempotence tests.

### Phase 7: empirical learning

Collect repair-effect history and adaptive batch sizes.

### Phase 8: metric correlation analysis

Generate repository-specific correlation/factor report and use it to revise normalization/taxonomy.

### Phase 9: optional hardening-debt estimate

Only after enough historical repairs exist to estimate costs honestly.

### Phase 10: optional advanced risk sensors

Evaluate churn, centrality, and mutation testing if they materially improve prioritization.

---

## 30. Minimum viable version

Do not let the full research vision block immediate progress. The smallest valuable system is:

1. parse existing MI/complexity/CRAP/Oxlint outputs into one normalized JSON file;
2. group Oxlint rules into structural/type/correctness/architecture/mechanical factors;
3. attach structural lint findings to structural hotspots;
4. create two queues: structural and mechanical;
5. structural queue runs first except for extremely high-leverage proven codemods;
6. one writer mutates the checkout;
7. verify after each cluster;
8. remeasure and invalidate stale tasks;
9. record before/after vectors;
10. promote recurring repairs into codemods.

That alone would be a major improvement over feeding a model thousands of raw findings.

---

## 31. Acceptance criteria for the architecture implementation

The orchestration work is successful when all of the following are true:

### Data

- [ ] current raw metrics are machine-readable;
- [ ] every enabled Oxlint rule is categorized;
- [ ] derived metrics and primitive sensors are distinguishable;
- [ ] tasks refer to stable source units/clusters rather than only line numbers;
- [ ] before/after repair effects are persisted.

### Scheduling

- [ ] structural hotspots are not independently double-counted via MI + CC + CRAP + structural lint;
- [ ] scheduler can explain why one target is ahead of another;
- [ ] scheduler does not depend on an unexplained arbitrary global weighted sum;
- [ ] Pareto/non-dominance logic is tested;
- [ ] stale tasks are invalidated/rebuilt after structural edits.

### Mutation

- [ ] only one authoritative writer mutates the working checkout;
- [ ] analysis may run separately without creating mandatory worktree copies;
- [ ] repeated mechanical patterns can be promoted to codemods;
- [ ] codemods have fixtures and idempotence checks.

### Verification

- [ ] compiler/import/test failures are hard constraints;
- [ ] suppressions/config weakening are rejected;
- [ ] structural edits may temporarily create bounded mechanical lint debt;
- [ ] end-of-cluster verification resolves or explicitly tracks that debt;
- [ ] known historical codemod failures are covered by regression tests or explicit exclusions.

### Learning

- [ ] accepted repairs record metric deltas;
- [ ] failed attempts record why they failed;
- [ ] retries change context/strategy rather than repeat blindly;
- [ ] batch size can adapt by repair class;
- [ ] recurring successful patterns can become deterministic tools.

---

## 32. Questions the implementing agent should investigate rather than assume

These are research/engineering questions, not blockers to the MVP:

1. What is the exact correlation between CC, cognitive complexity, MI, CRAP, structural lint, and mechanical lint in this repository?
2. Which Oxlint rules are strongly concentrated inside current structural hotspots?
3. How many current lint findings disappear incidentally after a structural rewrite?
4. Which rules recur with essentially identical AST repairs?
5. What percentage of current lint debt is safely autofixable, codemoddable, contextual, or architectural?
6. Which repair classes create the most follow-up lint debt?
7. Which structural refactor patterns most consistently improve several metrics at once?
8. Does function-level MI encourage excessive fragmentation in this repository? If so, what module-level countermeasure best detects it?
9. Is CRAP currently dominated by low coverage or by high complexity?
10. Does branch coverage materially change CRAP prioritization compared with statement coverage?
11. Which metrics meaningfully predict failed refactors or test regressions?
12. Would churn/dependency centrality change the priority ordering enough to justify adding them?
13. Which current `combined-driver` rankings differ most from a Pareto/root-cause ranking, and why?
14. Can the enormous Oxlint inventory be generated directly as compact JSON so Markdown is only a human-readable summary?
15. Which failures from the previous quality-hardening waves can be converted into permanent regression tests for the harness?

---

## 33. Suggested experiments

### Experiment A: structural-first efficacy

Select 10 high-CC/high-MI-deficit/high-lint units.

For each:

1. measure complete before vector;
2. perform coherent structural rewrite;
3. measure immediately before lint mop-up;
4. perform lint mop-up;
5. measure final vector;
6. record incidental findings removed/created.

Goal: quantify whether structural-first actually reduces total repair effort.

### Experiment B: rule codemodability

For the 20 highest-count Oxlint rules:

1. sample 20 representative findings;
2. classify repair pattern similarity;
3. estimate deterministic transform coverage;
4. write transform for the highest-leverage candidate;
5. verify idempotence and repo-wide effect.

Goal: estimate how much of the lint inventory can be collapsed into a small transformation library.

### Experiment C: metric redundancy

Generate function-level correlation matrix and clustering.

Goal: empirically test the hypothesized structural latent factor.

### Experiment D: ranking comparison

Compare top 25 targets from:

- old weighted driver;
- structural-priority lexicographic ranking;
- Pareto frontier;
- expected utility using historical repair costs.

Goal: identify where the current driver is mis-prioritizing correlated debt.

### Experiment E: helper-soup detection

Review a sample of successful MI refactors.

Measure:

- helper count before/after;
- median helper size;
- one-use helper count;
- module LOC;
- module CC/cognitive totals;
- reviewer/agent qualitative explanation.

Goal: determine whether the metric threshold is encouraging fragmentation.

---

## 34. Example end-to-end repair sequence

Suppose measurement identifies:

```text
frontend/components/example.tsx::Example
CC = 24
cognitive = 32
MI = 35
coverage = 44%
CRAP = 68
Oxlint = 77
  structural = 41
  type = 12
  mechanical = 24
```

Controller creates one structural root cause rather than 80 tasks.

### Step 1: characterize behavior

If test protection is weak, add/strengthen focused characterization tests where justified.

### Step 2: structural repair

Agent separates state/policy/rendering into coherent units.

Intermediate measurement:

```text
CC = 8
cognitive = 11
MI = 63
coverage = 53%
CRAP = 17
Oxlint = 91
  structural = 8
  type = 18
  mechanical = 65
```

This can be accepted as an intermediate structural success because hard verification passes and the new debt is mostly mechanical.

### Step 3: re-cluster lint

Old diagnostics are discarded. New inventory shows:

- readonly props repeated 22x;
- named constants 13x;
- filename/import issue 2x;
- strict booleans 7x;
- assorted contextual tail.

### Step 4: deterministic cleanup

Apply proven readonly/naming transformations where safe.

### Step 5: contextual cleanup

Agent handles remaining strict booleans and domain-specific typing.

Final state:

```text
CC = 8
cognitive = 10
MI = 66
coverage = 61%
CRAP = 12
Oxlint = 0 for assigned scope
all verification gates pass
```

The campaign records both the temporary tradeoff and the final improvement.

---

## 35. What not to build

Avoid the following failure modes:

### A giant universal quality formula

Do not spend time inventing arbitrary coefficients for every metric and lint rule.

### One task per lint line

This destroys context and ignores repeated patterns/root causes.

### A giant prompt containing the whole inventory

The `OXLINT-ERROR-INVENTORY-2026-09-01.md` file is useful as evidence, not as optimal agent context.

### Mandatory worktree swarm

This repository should prefer one authoritative mutable state unless future measurements prove a need for parallel isolated writers.

### LLM-first mechanical edits

If a deterministic fixer or codemod can perform the transformation, use it.

### Metric-only acceptance

Passing MI/CRAP/CCCC alone does not prove a good refactor.

### Blind full-repo dangerous autofixes

The branch already contains evidence that apparently mechanical transforms can corrupt code.

### Static inventory after major rewrites

Any structural rewrite invalidates large parts of the old lint inventory. Re-measure.

---

## 36. Research lineage / further reading

These references are useful starting points for an agent expanding the design. Prefer primary papers/project documentation when implementing or making claims.

### Quality models and maintainability

- McCabe, *A Complexity Measure* (1976).
- Maintainability Index literature and modern implementations.
- Heitlager, Kuipers, Visser, *A Practical Model for Measuring Maintainability* (2007).
- Quamoco quality model / base model publications around ICSE 2012.
- Squale quality model documentation.
- SQALE method and Sonar technical-debt/remediation-cost model.

### Multi-objective / search-based refactoring

- Harman & Tratt, *Pareto Optimal Search Based Refactoring at the Design Level* (2007).
- Search-Based Software Engineering literature on multi-objective refactoring.
- Work comparing NSGA-II/NSGA-III and many-objective refactoring formulations.

### Large-scale transformation

- Coccinelle semantic patches.
- Google ClangMR large-scale automated refactoring.
- Google Refaster example-based refactoring.
- OpenRewrite recipes and semantic trees.
- jscodeshift / ts-morph for JS/TS codemods.

### Learned/automated repair

- Facebook Getafix.
- SapFix and related automated program-repair systems.
- Automated program repair and static-analysis-guided repair literature.

### AI-assisted migrations and agent harnesses

- Google research/blog work on accelerating code migrations with generative AI.
- OpenAI Codex harness-engineering material.
- Anthropic engineering material on long-running coding-agent harnesses and generator/evaluator separation.

The implementing agent should perform fresh web research for exact citations and current tool capabilities rather than treating this section as a complete bibliography.

---

## 37. Concrete recommendation for this branch

The immediate architectural direction should be:

```text
CURRENT
-------
combined-driver weighted file ranking
+ giant Oxlint inventory
+ separate MI/complexity/CRAP gates
+ manual/agent waves

                |
                v

NEXT
----
normalized function/file measurement dataset
+ Oxlint rule taxonomy
+ root-cause structural clusters
+ separate mechanical clusters
+ priority classes
+ Pareto frontier
+ one mutable checkout / single writer
+ deterministic evaluator
+ before/after effect logging
+ codemod promotion

                |
                v

LATER
-----
empirical repair-effect model
+ adaptive batch sizing
+ learned remediation cost / hardening debt
+ repository-specific metric correlation/factor analysis
+ optional churn/centrality/mutation risk signals
```

The key design decision is to preserve the useful information in MI, CRAP, CCCC, and Oxlint **without allowing correlated metrics to become competing masters**.

The quality-hardening controller should treat them as a collection of imperfect sensors observing different aspects and abstraction levels of the same program. The agent's job is to infer and repair the underlying code problem; the deterministic tools' job is to tell us what changed.

---

## 38. Fresh-agent implementation brief

A fresh implementation agent should begin with the following instruction:

> Read `docs/agents/quality-hardening/HANDOFF-PLAN.md` first for branch truth, tool quirks, accepted rule semantics, verification commands, and known historical failures. Then read this document and inspect `combined-driver.json`, `mi-by-file.json`, and the current Oxlint inventory. Do not immediately fix diagnostics. First design the smallest machine-readable normalization layer that can represent structural metrics, CRAP/coverage, and Oxlint-by-rule for the same source units. Build an explicit Oxlint rule taxonomy, classify structural overlap, and replace the current arbitrary aggregate ranking with priority classes plus Pareto/non-dominance logic. Keep a single mutable checkout; parallel analysis is fine, but serialize writes and verification. Preserve all existing hard gates and do not weaken configuration.
>
> After the normalized dataset works, implement root-cause clustering so high-MI/high-complexity/high-CRAP units absorb related structural lint symptoms instead of producing independent tasks. Maintain a separate mechanical lint queue. Add before/after task records and remeasure after every structural change. When the same contextual repair recurs, attempt to promote it into a tested, idempotent AST codemod with positive and negative fixtures. Record real repair effects and verifier failures so scheduling can later be based on measured success/cost rather than invented weights. The objective is not a magic quality number; it is a closed-loop hardening controller that steadily reduces structural risk and conformance debt while preserving behavior.

---

## 39. Final principle

The system should optimize **the code**, not the metrics.

Metrics are observations. Derived indexes are views. Lint findings are concrete evidence. Tests and compilers are constraints. Codemods are reusable actions. The coding agent is a context-sensitive repair engine. The controller is responsible for selecting actions, preserving state, verifying outcomes, learning from failures, and preventing local metric improvements from degrading the overall system.

That separation of concerns is the foundation for making a quality-hardening campaign of this scale reliable rather than merely fast.
