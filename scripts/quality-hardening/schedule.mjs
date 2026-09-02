// @ts-check

/**
 * Selection within a priority class (plan section 14):
 * 1. Class assignment P0..P4 is strict (plan 14.1).
 * 2. Within the highest nonempty class, retain the Pareto frontier across
 *    gate distance (L-infinity normalized deficit), findings explained,
 *    blast radius, measured repair success, verification cost, and rollback
 *    clarity (plan 14.2).
 * 3. A deterministic tie-break picks one candidate (plan 14.3).
 *
 * Effect history informs ordering only. It never moves a task across a
 * priority class and never relaxes a hard gate.
 */

/** @type {Readonly<Record<string, number>>} */
const FACTOR_PRIORITY = Object.freeze({
 architecture_api: 2,
 correctness: 0,
 mechanical_convention: 3,
 structural_maintainability: 1,
 testing: 1,
 type_integrity: 0,
});

/** @type {Readonly<Record<string, number>>} */
const CLASS_PRIORITY = Object.freeze({
 mechanical_contextual: 4,
 mechanical_safe: 3,
});

const PRIORITY_LABELS = Object.freeze(["P0", "P1", "P2", "P3", "P4"]);

/** @typedef {Readonly<{cluster_key?: string, gate_distance?: number, hard_findings?: number, path_count?: number, repair_class?: string, source_unit_count?: number, source_units?: readonly string[], state?: string, success_rate?: number, task_id: string, unit_ids?: readonly string[], factor?: string}>} ScheduleTask */
/** @typedef {Readonly<{cluster_key?: string, repair_class?: string, status?: string, task_id?: string}>} Effect */

/**
 * @param {string} factor
 * @param {string|undefined} repairClass
 * @returns {string} Priority class label.
 */
function priorityForTask(factor, repairClass) {
 const factorPriority = FACTOR_PRIORITY[factor] ?? PRIORITY_LABELS.length - 1;
 if (factorPriority < PRIORITY_LABELS.length - 1 && repairClass) {
  const classPriority = CLASS_PRIORITY[repairClass];
  if (classPriority !== undefined && classPriority > factorPriority) {
   return PRIORITY_LABELS[classPriority];
  }
 }
 return PRIORITY_LABELS[factorPriority] ?? "P4";
}

/** @param {string} factor @returns {string} */
function priorityForFactor(factor) {
 return priorityForTask(factor, undefined);
}

/**
 * Normalized deficit of a single metric beyond its hard bound.
 * @param {number} observed
 * @param {number} bound
 * @returns {number}
 */
function normalizedExcess(observed, bound) {
 if (observed <= bound || bound <= 0) { return 0; }
 return (observed - bound) / bound;
}

/** @param {ScheduleTask} task */
function gateDistance(task) {
 return typeof task.gate_distance === "number" ? task.gate_distance : 0;
}

/** @param {ScheduleTask} task */
function explainedHardFindings(task) {
 return typeof task.hard_findings === "number" ? task.hard_findings : 0;
}

/** @param {ScheduleTask} task */
function blastRadius(task) {
 if (typeof task.source_unit_count === "number") { return task.source_unit_count; }
 if (Array.isArray(task.source_units)) { return task.source_units.length; }
 return Array.isArray(task.unit_ids) ? task.unit_ids.length : 1;
}

/** @param {ScheduleTask} task */
function verificationCost(task) {
 return task.repair_class === "structural" ? 2 : 1;
}

/** @param {ScheduleTask} task */
function rollbackClarity(task) {
 return task.repair_class === "mechanical_safe" ? 1 : 0;
}

/**
 * A dominates B when it is no worse on every selected dimension and strictly
 * better on at least one (section 14.2).
 * @param {ScheduleTask} left
 * @param {ScheduleTask} right
 * @returns {boolean}
 */
function dominates(left, right) {
 /** @type {Array<(task: ScheduleTask) => number>} */
 const dimensions = [
  // gate distance: lower is better -> left better when smaller
  (task) => -gateDistance(task),
  // explained hard findings: higher is better
  explainedHardFindings,
  // blast radius: lower is better
  (task) => -blastRadius(task),
  // measured repair success: higher is better
  (task) => task.success_rate ?? 0,
  // verification cost: lower is better
  (task) => -verificationCost(task),
  // rollback clarity: higher is better (mechanical safe rolls back cleanly)
  rollbackClarity,
 ];
 let strictlyBetter = false;
 for (const dimension of dimensions) {
  const leftScore = dimension(left),
   rightScore = dimension(right);
  if (leftScore < rightScore) { return false; }
  if (leftScore > rightScore) { strictlyBetter = true; }
 }
 return strictlyBetter;
}

/**
 * Deterministic tie-break per section 14.3.
 * @param {ScheduleTask} left
 * @param {ScheduleTask} right
 * @returns {number}
 */
function tieBreak(left, right) {
 /** @type {Array<(task: ScheduleTask) => string | number>} */
 const ordered = [
  (task) => -explainedHardFindings(task),
  (task) => -(task.success_rate ?? 0),
  (task) => verificationCost(task),
  (task) => blastRadius(task),
  (task) => rollbackClarity(task),
  (task) => task.task_id,
 ];
 for (const dimension of ordered) {
  const leftValue = dimension(left),
   rightValue = dimension(right);
  if (leftValue < rightValue) { return -1; }
  if (leftValue > rightValue) { return 1; }
 }
 return 0;
}

/**
 * Success ratio for a task's repair pattern from recorded effects.
 * Effects are recorded on task close/block; a missing history scores 0 and
 * never changes a class assignment.
 * @param {readonly Effect[]} effects
 * @param {ScheduleTask} task
 * @returns {number}
 */
function successRateFor(effects, task) {
 const key = task.cluster_key;
 if (!key) { return 0; }
 const byTask = new Map(effects.map((effect) => [effect.task_id ?? "", effect]));
 const direct = byTask.get(task.task_id);
 if (direct) {
  return direct.status === "accepted" ? 1 : 0;
 }
 const family = effects.filter((effect) => effect.cluster_key === key && effect.status != null);
 if (family.length === 0) { return 0; }
 return family.filter((effect) => effect.status === "accepted").length / family.length;
}

/**
 * Non-dominated tasks of one priority class, ordered by tie-break.
 * @param {ScheduleTask[]} tasks
 * @returns {ScheduleTask[]}
 */
function paretoFrontier(tasks) {
 const frontier = tasks.filter(
  (candidate) => !tasks.some((other) => other !== candidate && dominates(other, candidate)),
 );
 return [...frontier].sort(tieBreak);
}

/**
 * @param {ScheduleTask[]} tasks
 * @param {readonly Effect[]} [effects]
 * @returns {ScheduleTask[]}
 */
function scheduleTasks(tasks, effects = []) {
 const annotated = /** @type {ScheduleTask[]} */ (tasks.map((task) => ({ ...task, success_rate: successRateFor(effects, task) })));
 const classes = new Map();
 for (const task of annotated) {
  const priority = priorityForTask(task.factor ?? "", task.repair_class),
   values = classes.get(priority) ?? [];
  values.push(task);
  classes.set(priority, values);
 }
 const labels = [...classes.keys()].sort((left, right) => PRIORITY_LABELS.indexOf(left) - PRIORITY_LABELS.indexOf(right));
 const ordered = [];
 for (const label of labels) {
  ordered.push(...paretoFrontier(classes.get(label) ?? []));
 }
 return /** @type {ScheduleTask[]} */ (ordered);
}

export { dominates, gateDistance, normalizedExcess, paretoFrontier, priorityForFactor, priorityForTask, scheduleTasks, successRateFor, tieBreak };
