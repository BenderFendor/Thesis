// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizedExcess, priorityForFactor, scheduleTasks } from "./schedule.mjs";
import { readLedger, writeCampaign } from "./ledger.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { resolvedTaxonomyRule } from "./config.mjs";

/** @typedef {Readonly<{cluster_key?: string, quality_factor?: string, repair_class?: string, temporary_structural_tradeoff?: boolean}>} TaxonomyRuleDefinition */
/** @typedef {Readonly<{family_defaults: Readonly<Record<string, TaxonomyRuleDefinition>>, overrides: Readonly<Record<string, TaxonomyRuleDefinition>>, rule_ids: readonly string[]}>} QueueTaxonomy */
/** @typedef {Readonly<{cluster_key?: string, repair_class?: string, status?: string, task_id?: string}>} Effect */
/** @typedef {Readonly<{config: Readonly<{policy_version: string, thresholds: Readonly<{cccc: Readonly<{cognitive_ceiling: number, cyclomatic_ceiling: number}>, crap: Readonly<{cluster_ceiling: number}>, mi: Readonly<{cluster_floor: number}>}>}>, taxonomy: QueueTaxonomy, repositoryRoot: string}>} QueuePolicy */
/** @typedef {Readonly<{coverage?: Readonly<{crap?: number|null, state?: string}>, path: string, rule?: string, unit_id?: string, metrics?: Readonly<{cccc?: Readonly<{cognitive?: number, cyclomatic?: number}>, code_multivitals?: Readonly<{maintainability_index?: number}>}>}>} Unit */
/** @typedef {Readonly<{path: string, rule?: string, unit_id?: string}>} Finding */
/** @typedef {{allowed_lint_rules: string[], cluster_key: string, factor: string, finding_count: number, gate_distance: number, hard_findings: number, paths: string[], repair_class: string, required_profiles: string[], rules: string[], source_units: string[]}} TaskDraft */
/** @typedef {TaskDraft & {cluster_fingerprint: string, created_from?: string, factors: string[], gates: string[], priority: string, scope: string[], state: string, task_id: string, unit_ids: string[], claimed_by?: string, reason?: string|null, updated_at?: string}} Task */
/** @typedef {Readonly<{units?: readonly Unit[], lint?: Readonly<{findings?: readonly Finding[]}> , measurement_id?: string}>} Measurement */

/** @param {Readonly<Record<string, unknown>>} value */
const taskHash = (value) => 
 `qh-task:${createHash("sha256").update(JSON.stringify(value, Object.keys(value).toSorted())).digest("hex").slice(0, 24)}`


/** @param {string} value */
const pathCluster = (value) => 
 value.split("/").slice(0, -1).join("/") || "."


/**
 * @param {Map<string, TaskDraft>} groups Finding groups.
 * @param {string} factor Quality factor.
 * @param {string} repairClass Repair class.
 * @param {string} clusterKey Taxonomy cluster.
 * @param {string} path Affected repository path.
 * @param {Unit|Finding} finding Normalized finding.
 * @param {string} [groupKey] Optional cross-file grouping key.
 * @returns {TaskDraft} Updated task draft.
 */
const addFinding = ({groups, factor, repairClass, clusterKey, path, finding, groupKey = path}) => {
 const key = `${factor}\0${clusterKey}\0${groupKey}`,
  task = groups.get(key) ?? ({
   allowed_lint_rules: [],
   cluster_key: clusterKey,
   factor,
   finding_count: 0,
   gate_distance: 0,
   hard_findings: 0,
   paths: [],
   repair_class: repairClass,
   required_profiles: ["path", "task", "changed", "repo"],
   rules: [],
   source_units: [],
  });
 task.finding_count += 1;
 if (!task.paths.includes(path)) { task.paths.push(path); }
 if (finding.unit_id && !task.source_units.includes(finding.unit_id)) { task.source_units.push(finding.unit_id); }
 if (finding.rule && !task.rules.includes(finding.rule)) { task.rules.push(finding.rule); }
 groups.set(key, task);
 return task;
}

/** @param {TaskDraft} task @param {number} value */
const recordGate = (task, value) => {
 task.gate_distance = Math.max(task.gate_distance ?? 0, value);
 task.hard_findings = (task.hard_findings ?? 0) + 1;
}

/** @param {Map<string, TaskDraft>} groups @param {QueuePolicy} policy @param {Unit} unit */
const addComplexityFinding = (groups, policy, unit) => {
 const metrics = unit.metrics?.cccc ?? {},
  thresholds = policy.config.thresholds.cccc,
  gate = Math.max(
   normalizedExcess(metrics.cyclomatic ?? 0, thresholds.cyclomatic_ceiling),
   normalizedExcess(metrics.cognitive ?? 0, thresholds.cognitive_ceiling),
  );
 if (gate > 0) {
  const task = addFinding({groups, factor: "structural_maintainability", repairClass: "structural", clusterKey: `source-unit:${unit.unit_id ?? unit.path}`, path: unit.path, finding: unit});
  recordGate(task, gate);
 }
}

/** @param {Map<string, TaskDraft>} groups @param {QueuePolicy} policy @param {Unit} unit */
const addMiFinding = (groups, policy, unit) => {
 const floor = policy.config.thresholds.mi.cluster_floor,
  mi = unit.metrics?.code_multivitals?.maintainability_index;
 if (mi !== undefined && mi < floor) {
  const task = addFinding({groups, factor: "structural_maintainability", repairClass: "structural", clusterKey: `source-unit:${unit.unit_id ?? unit.path}`, path: unit.path, finding: unit});
  recordGate(task, (floor - mi) / floor);
 }
}

/** @param {Map<string, TaskDraft>} groups @param {QueuePolicy} policy @param {Unit} unit */
const addCrapFinding = (groups, policy, unit) => {
 const ceiling = policy.config.thresholds.crap.cluster_ceiling,
  crap = unit.coverage?.crap;
 if (crap !== undefined && crap !== null && crap > ceiling) {
  const task = addFinding({groups, factor: "testing", repairClass: "coverage", clusterKey: "crap-coverage", path: unit.path, finding: unit});
  recordGate(task, normalizedExcess(crap, ceiling));
 }
}

/** @param {Map<string, TaskDraft>} groups @param {QueuePolicy} policy @param {Unit} unit */
const addUnitFindings = (groups, policy, unit) => {
 addComplexityFinding(groups, policy, unit);
 addMiFinding(groups, policy, unit);
 addCrapFinding(groups, policy, unit);
}

/** @param {Map<string, TaskDraft>} groups @param {QueuePolicy} policy @param {Finding} finding */
const addLintFinding = (groups, policy, finding) => {
 const ruleId = finding.rule;
 if (!ruleId) { throw new Error("lint finding has no rule ID"); }
 const taxonomy = resolvedTaxonomyRule(ruleId, policy.taxonomy);
 if (!taxonomy) { throw new Error(`lint rule is missing from taxonomy: ${ruleId}`); }
 const rule = taxonomy;
 const clusterKey = `${rule.cluster_key}:${ruleId}`,
  task = addFinding({groups, factor: rule.quality_factor, repairClass: rule.repair_class, clusterKey, path: finding.path, finding: { ...finding, rule: ruleId }, groupKey: ruleId});
 if (task && rule.temporary_structural_tradeoff === true && !task.allowed_lint_rules.includes(ruleId)) {
  task.allowed_lint_rules.push(ruleId);
 }
}

/** @param {TaskDraft} task @param {string|undefined} measurementId @returns {Task} */
const materializeTask = (task, measurementId) => {
 const clusterFingerprint = taskHash({ cluster_key: task.cluster_key, factor: task.factor, paths: task.paths, rules: task.rules, source_units: task.source_units });
 return {
  ...task,
  cluster_fingerprint: clusterFingerprint,
  created_from: measurementId,
  factors: [task.factor],
  gates: task.required_profiles,
  priority: priorityForFactor(task.factor),
  scope: task.paths,
  state: "queued",
  task_id: taskHash({ cluster_fingerprint: clusterFingerprint }),
  unit_ids: task.source_units,
 };
}

/** @param {Map<string, TaskDraft>} groups @param {string|undefined} measurementId @param {readonly Effect[]} [effects] @returns {Task[]} */
const materializeTasks = (groups, measurementId, effects) => {
 const tasks = [...groups.values()].map((task) => materializeTask(task, measurementId));
 return scheduleTasks(tasks, effects);
}

/** @param {TaxonomyRuleDefinition} definition @returns {boolean} */
const isTradeoff = (definition) => definition.temporary_structural_tradeoff === true;

/** @param {Readonly<Record<string, TaxonomyRuleDefinition>>} families @param {readonly string[]} ruleIds @returns {string[]} */
const familyTradeoffRules = (families, ruleIds) => {
 /** @type {string[]} */
 const rules = [];
 for (const [family, definition] of Object.entries(families)) {
  if (isTradeoff(definition)) {
   for (const id of ruleIds) {
    if (id.startsWith(family)) { rules.push(id); }
   }
  }
 }
 return rules;
}

/** @param {Readonly<Record<string, TaxonomyRuleDefinition>>} overrides @returns {string[]} */
const overrideTradeoffRules = (overrides) => {
 /** @type {string[]} */
 const rules = [];
 for (const [id, definition] of Object.entries(overrides)) {
  if (isTradeoff(definition)) { rules.push(id); }
 }
 return rules;
}

/** @param {QueueTaxonomy} taxonomy @returns {string[]} */
const tradeoffRules = (taxonomy) =>
 [...new Set([...familyTradeoffRules(taxonomy.family_defaults, taxonomy.rule_ids), ...overrideTradeoffRules(taxonomy.overrides ?? {})])];

/** @param {QueuePolicy} policy @param {Measurement} measurement @param {readonly Effect[]} [effects] @returns {Task[]} */
const buildTasks = (policy, measurement, effects) => {
 /** @type {Map<string, TaskDraft>} */
 const groups = new Map();
 for (const unit of measurement.units ?? []) { addUnitFindings(groups, policy, unit); }
 for (const finding of measurement.lint?.findings ?? []) { addLintFinding(groups, policy, finding); }
 const tradeoffs = tradeoffRules(policy.taxonomy);
 for (const task of groups.values()) {
  if (task.repair_class === "structural" && tradeoffs.length > 0) {
   task.allowed_lint_rules = [...new Set([...task.allowed_lint_rules, ...tradeoffs])];
  }
 }
 return materializeTasks(groups, measurement.measurement_id, effects);
}

/** @param {string} repositoryRoot @returns {Promise<Task[]>} */
const readTasks = async (repositoryRoot) => {
 const path = resolve(repositoryRoot, "docs/agents/quality-hardening/ledger/tasks.jsonl");
 try {
  return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => {
   const task = JSON.parse(line);
   return Object.assign(task, { state: task.state ?? stateFromLegacy(task.status) });
  });
 } catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") { return []; }
  throw error;
 }
}

/** @param {string|undefined} status @returns {string} */
function stateFromLegacy(status) {
 return { blocked: "blocked", claimed: "claimed", closed: "accepted", open: "queued" }[status ?? ""] ?? "queued";
}

/** @param {string} repositoryRoot @param {readonly Task[]} tasks */
const writeTasks = async (repositoryRoot, tasks) => {
 const directory = resolve(repositoryRoot, "docs/agents/quality-hardening/ledger");
 await mkdir(directory, { recursive: true });
 await writeFile(resolve(directory, "tasks.jsonl"), tasks.map((task) => JSON.stringify(task)).join("\n") + (tasks.length > 0 ? "\n" : ""), "utf8");
}

/** @param {string} repositoryRoot @param {string} taskId @param {Readonly<Record<string, unknown>>} patch */
const updateTask = async (repositoryRoot, taskId, patch) => {
 const tasks = await readTasks(repositoryRoot),
  index = tasks.findIndex((task) => task.task_id === taskId);
 if (index === -1) { throw new Error(`task not found: ${taskId}`); }
 tasks[index] = { ...tasks[index], ...patch, updated_at: new Date().toISOString() };
 await writeTasks(repositoryRoot, tasks);
 return tasks[index];
}

/** @type {Readonly<Record<string, readonly string[]>>} */
const VALID_TRANSITIONS = Object.freeze({
 accepted: [],
 blocked: ["queued", "stale"],
 claimed: ["in_progress", "verifying", "queued", "blocked"],
 in_progress: ["verifying", "queued", "blocked"],
 queued: ["claimed", "blocked", "stale"],
 stale: ["queued"],
 verifying: ["accepted", "in_progress", "blocked"],
});

/** @param {string} current @param {string} next */
const assertTransition = (current, next) => {
 if (!(VALID_TRANSITIONS[current] ?? []).includes(next)) { throw new Error(`invalid task transition: ${current} -> ${next}`); }
}

/** @param {string} repositoryRoot @param {string} taskId @param {string} next @param {Readonly<Record<string, unknown>>} [extra] */
const transitionTask = async (repositoryRoot, taskId, next, extra = {}) => {
 const tasks = await readTasks(repositoryRoot),
  task = tasks.find((candidate) => candidate.task_id === taskId);
 if (!task) { throw new Error(`task not found: ${taskId}`); }
 assertTransition(task.state, next);
 return updateTask(repositoryRoot, taskId, { ...extra, state: next });
}

/** @param {string} repositoryRoot @param {string} taskId @param {string} path @param {string} reason */
const expandTaskScope = async (repositoryRoot, taskId, path, reason) => {
 const tasks = await readTasks(repositoryRoot),
  task = tasks.find((candidate) => candidate.task_id === taskId);
 if (!task) { throw new Error(`task not found: ${taskId}`); }
 if (!reason.trim()) { throw new Error("scope expansion requires a reason"); }
 const paths = task.paths.includes(path) ? task.paths : [...task.paths, path].toSorted((left, right) => left.localeCompare(right));
 return updateTask(repositoryRoot, taskId, {
  paths,
  scope: paths,
  scope_expansion: { path, reason },
 });
}

/** @param {string} repositoryRoot @returns {string|null} */
const currentHead = (repositoryRoot) => {
 try {
  return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
 } catch {
  return null;
 }
}

/** @param {readonly Task[]} tasks @param {readonly Task[]} previous @returns {Task[]} */
const mergePreserved = (tasks, previous) => 
 tasks.map((task) => {
  const old = previous.find((candidate) => candidate.task_id === task.task_id);
  return old ? { ...task, claimed_by: old.claimed_by, reason: old.reason, state: old.state } : task;
 })


/** @param {readonly Task[]} previous @param {Set<string>} currentIds @returns {Task[]} */
const supersededStale = (previous, currentIds) => 
 previous.filter((task) => !currentIds.has(task.task_id) && !["accepted", "stale"].includes(task.state)).map((task) => (Object.assign(task, {
	reason: 'superseded by queue rebuild',
	state: 'stale'
})))


/** @param {QueuePolicy} policy @param {Measurement} measurement */
const rebuildQueue = async (policy, measurement) => {
 const effects = await readLedger(policy.repositoryRoot, "effects.jsonl"),
  tasks = buildTasks(policy, measurement, effects),
  previous = await readTasks(policy.repositoryRoot),
  currentIds = new Set(tasks.map((task) => task.task_id)),
  finalTasks = scheduleTasks([...mergePreserved(tasks, previous), ...supersededStale(previous, currentIds)], effects);
 await writeTasks(policy.repositoryRoot, finalTasks);
 await writeCampaign(policy.repositoryRoot, {
  head: currentHead(policy.repositoryRoot),
  measurement_id: measurement.measurement_id,
  policy_version: policy.config.policy_version,
  rebuilt_at: new Date().toISOString(),
  status: "open",
  task_count: finalTasks.length,
  task_states: finalTasks.reduce((counts, task) => {
   counts[task.state] = (counts[task.state] ?? 0) + 1;
   return counts;
  }, /** @type {Record<string, number>} */({})),
 });
 return finalTasks;
}

export { assertTransition, buildTasks, expandTaskScope, pathCluster, readTasks, rebuildQueue, taskHash, tradeoffRules, transitionTask, updateTask, writeTasks };
