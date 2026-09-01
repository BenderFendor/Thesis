# Complexity groups

Hard violations: 19
Files with hard violations: 7

| file | violations | max CC | max cognitive |
|---|---:|---:|---:|
| `frontend/tools/oxlint/anti-slop/shared/dictionary-types.ts` | 6 | 26 | 37 |
| `frontend/tools/oxlint/anti-slop/rules/no-widen-then-assert.ts` | 5 | 27 | 19 |
| `frontend/tools/oxlint/thesis/index.mjs` | 4 | 23 | 15 |
| `frontend/tools/oxlint/anti-slop/rules/no-unknown-returns.ts` | 1 | 16 | 15 |
| `frontend/tools/oxlint/anti-slop/rules/no-module-mocking.ts` | 1 | 12 | 11 |
| `frontend/tools/oxlint/anti-slop/rules/no-object-parameters.ts` | 1 | 12 | 9 |
| `frontend/tools/oxlint/anti-slop/shared/lexical-type-parameters.ts` | 1 | 12 | 15 |

## Functions by file

### `frontend/tools/oxlint/anti-slop/shared/dictionary-types.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 190 | `unsafeDirectValue` | 26 | 33 |
| 246 | `dictionaryValueTypes` | 25 | 30 |
| 51 | `createTypeEnvironment` | 23 | 37 |
| 340 | `classifyWideningTarget` | 22 | 25 |
| 411 | `classifyAliasBroadTarget` | 20 | 25 |
| 480 | `isKnownEvidenceExpression` | 14 | 4 |

### `frontend/tools/oxlint/anti-slop/rules/no-widen-then-assert.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 200 | `knownValueEvidence` | 27 | 19 |
| 52 | `isBroadRecordType` | 22 | 14 |
| 263 | `widenedBinding` | 15 | 9 |
| 143 | `isDefinitelyNarrowerRecordType` | 12 | 9 |
| 122 | `isDefinitelyObjectType` | 11 | 3 |

### `frontend/tools/oxlint/thesis/index.mjs`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 167 | `CallExpression` | 23 | 14 |
| 57 | `hasDescendantElement` | 13 | 15 |
| 95 | `isMapCallback` | 11 | 2 |
| 119 | `isFragileMapKeyExpression` | 11 | 4 |

### `frontend/tools/oxlint/anti-slop/rules/no-unknown-returns.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 42 | `resolvesToUnknown` | 16 | 15 |

### `frontend/tools/oxlint/anti-slop/rules/no-module-mocking.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 51 | `moduleMockCall` | 12 | 11 |

### `frontend/tools/oxlint/anti-slop/rules/no-object-parameters.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 52 | `resolvesToObject` | 12 | 9 |

### `frontend/tools/oxlint/anti-slop/shared/lexical-type-parameters.ts`

| line | function | CC | cognitive |
|---:|---|---:|---:|
| 35 | `lexicalTypeParameterNames` | 12 | 15 |

