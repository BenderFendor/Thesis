import { appendLedger, readCampaign, readLedger } from "./ledger.mjs";
import { claimWriter, clearActiveTask, expandWriterClaim, releaseWriter, writeActiveTask } from "./writer-claim.mjs";
import { expandTaskScope, readTasks, rebuildQueue, transitionTask, updateTask } from "./queue.mjs";
import { measureRepository, readMeasurement } from "./measure.mjs";
import { EXIT_CODES } from "./protocol.mjs";
import { hook } from "./hook.mjs";
import { loadPolicy } from "./config.mjs";
import { verify } from "./verify.mjs";

/** @typedef {{from: string, json: boolean, paths: string[], scope: string, session: string, task: string, stale: boolean, reason: string}} Options */
/** @typedef {Readonly<{task_id: string, paths: string[], state: string, factor: string, cluster_key: string, repair_class?: string, allowed_lint_rules?: string[]}>} Task */
/** @typedef {Readonly<{repositoryRoot: string}>} QueuePolicy */

/** @param {readonly string[]} argumentsList @returns {Options} */
function parseOptions(argumentsList) {
 /** @type {Options} */
 const options = { from: "", json: false, paths: [], reason: "", scope: "repo", session: String(process.pid), stale: false, task: "" };
 for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--json") {
   options.json = true;
  } else if (argument === "--scope") {
   options.scope = argumentsList[index + 1];
   index += 1;
  } else if (argument === "--path") {
   options.paths.push(argumentsList[index + 1]);
   index += 1;
  } else if (argument === "--task") {
   options.task = argumentsList[index + 1];
   index += 1;
  } else if (argument === "--from") {
   options.from = argumentsList[index + 1];
   index += 1;
  } else if (argument === "--session") {
   options.session = argumentsList[index + 1];
   index += 1;
  } else if (argument === "--stale") {
   options.stale = true;
  } else if (argument === "--reason") {
   options.reason = argumentsList[index + 1];
   index += 1;
  } else {
   throw new Error(`unknown option: ${argument}`);
  }
 }
 return options;
}

function usage() {
 return [
  "node scripts/quality-hardening.mjs measure --scope repo|changed|task [--path PATH] [--json]",
  "node scripts/quality-hardening.mjs queue rebuild [--from MEASUREMENT_ID] [--json]",
  "node scripts/quality-hardening.mjs queue next|inspect TASK_ID [--json]",
  "node scripts/quality-hardening.mjs task claim|release|close|block TASK_ID [--session ID]",
  "node scripts/quality-hardening.mjs task expand-scope TASK_ID PATH --reason TEXT",
  "node scripts/quality-hardening.mjs verify --scope path|task|changed|repo [--json]",
  "node scripts/quality-hardening.mjs summary [--json]",
  "node scripts/quality-hardening.mjs hook pre|post|stop --payload -",
  "node scripts/quality-hardening.mjs validate",
 ].join("\n");
}

/** @param {readonly string[]} argumentsList */
async function runMeasure(argumentsList) {
 const options = parseOptions(argumentsList);
 if (!["repo", "changed", "task"].includes(options.scope)) {
  throw new Error(`unsupported measurement scope: ${options.scope}`);
 }
 const policy = await loadPolicy();
 let { paths } = options;
 if (options.scope === "task") {
  if (!options.task) { throw new Error("task measurement requires --task TASK_ID"); }
  const task = (await readTasks(policy.repositoryRoot)).find((candidate) => candidate.task_id === options.task);
  if (!task) { throw new Error(`task not found: ${options.task}`); }
  paths = task.paths;
 }
 const record = await measureRepository({
  paths,
  policy,
  scope: options.scope,
 });
 if (options.json) {
  console.log(JSON.stringify(record));
  return EXIT_CODES.ok;
 }
 console.error(
  `measurement ${record.measurement_id}: ${record.units.length} units, ` +
  `${record.verification[0].violations} CCCC violations`,
 );
 return EXIT_CODES.ok;
}

/** @param {Options} options */
async function runQueue(options) {
 const policy = await loadPolicy();
 if (options.scope !== "repo") { throw new Error("queue rebuild currently requires --scope repo"); }
 const measurement = options.from
  ? await readMeasurement(policy.repositoryRoot, options.from)
  : await measureRepository({ paths: options.paths, policy, scope: "repo" }),
  tasks = await rebuildQueue(policy, measurement),
  selected = options.task ? tasks.filter((task) => task.task_id === options.task) : tasks;
 if (options.json) { console.log(JSON.stringify(selected)); }
 else { console.error(`queue rebuilt: ${tasks.length} task(s)`); }
 return EXIT_CODES.ok;
}

/** @param {Task[]} tasks @param {Options} options */
function printNextTask(tasks, options) {
 const task = tasks.find((candidate) => candidate.state === "queued");
 if (options.json) { console.log(JSON.stringify(task ?? null)); }
 else { console.error(task ? `${task.task_id}: ${task.factor} ${task.cluster_key}` : "queue empty"); }
 return EXIT_CODES.ok;
}

/** @param {Task[]} tasks @param {string} taskId @param {Options} options */
function printTask(tasks, taskId, options) {
 const task = tasks.find((candidate) => candidate.task_id === taskId);
 if (!task) { throw new Error(`task not found: ${taskId}`); }
 console.log(options.json ? JSON.stringify(task) : JSON.stringify(task, null, 2));
 return EXIT_CODES.ok;
}

/** @param {string[]} argumentsList @returns {Promise<number>} */
async function runQueueCommand(argumentsList) {
 const options = parseOptions(argumentsList),
  subcommand = argumentsList.shift(),
  taskId = subcommand === "inspect" ? argumentsList.shift() ?? "" : "";
 if (subcommand === "rebuild") { return runQueue(options); }
 const policy = await loadPolicy(),
  tasks = await readTasks(policy.repositoryRoot);
 if (subcommand === "next") { return printNextTask(tasks, options); }
 if (subcommand === "inspect") { return printTask(tasks, taskId, options); }
 throw new Error("queue requires rebuild, next, or inspect");
}

/** @param {QueuePolicy} policy @param {Task} task @param {Options} options @returns {Promise<number>} */
async function claimTask(policy, task, options) {
 const claim = await claimWriter(policy.repositoryRoot, { paths: task.paths, sessionId: options.session, taskId: task.task_id });
 await writeActiveTask(policy.repositoryRoot, { ...task, allowed_lint_rules: task.allowed_lint_rules ?? [], session_id: options.session });
 await transitionTask(policy.repositoryRoot, task.task_id, "claimed", { claimed_by: options.session });
 await appendLedger(policy.repositoryRoot, "attempts.jsonl", { session_id: options.session, started_at: claim.claimed_at, status: "claimed", task_id: task.task_id });
 console.log(options.json ? JSON.stringify(claim) : `claimed ${task.task_id}`);
 return EXIT_CODES.ok;
}

/** @param {QueuePolicy} policy @param {Task} task @param {Options} options @returns {Promise<number>} */
async function releaseTask(policy, task, options) {
 await transitionTask(policy.repositoryRoot, task.task_id, "queued", { claimed_by: null });
 await releaseWriter(policy.repositoryRoot, options.session, options.stale);
 await clearActiveTask(policy.repositoryRoot, options.session, task.task_id);
 console.error(`released ${task.task_id}`);
 return EXIT_CODES.ok;
}

/** @param {QueuePolicy} policy @param {Task} task @param {Options} options @param {"close"|"block"} subcommand @returns {Promise<number>} */
async function finishTask(policy, task, options, subcommand) {
 const state = subcommand === "close" ? "accepted" : "blocked";
 if (state === "accepted" && ["claimed", "in_progress"].includes(task.state)) {
  await transitionTask(policy.repositoryRoot, task.task_id, "verifying");
 }
 await transitionTask(policy.repositoryRoot, task.task_id, state, { reason: options.reason || null });
 await appendLedger(policy.repositoryRoot, "effects.jsonl", { cluster_key: task.cluster_key ?? null, recorded_at: new Date().toISOString(), repair_class: task.repair_class ?? null, session_id: options.session, status: state, task_id: task.task_id });
 await releaseWriter(policy.repositoryRoot, options.session);
 await clearActiveTask(policy.repositoryRoot, options.session, task.task_id);
 console.error(`${state} ${task.task_id}`);
 return EXIT_CODES.ok;
}

/** @param {string|undefined} subcommand @param {QueuePolicy} policy @param {Task} task @param {Options} options @returns {Promise<number>} */
async function runTaskAction(subcommand, policy, task, options) {
 if (subcommand === "claim") { return claimTask(policy, task, options); }
 if (subcommand === "release") { return releaseTask(policy, task, options); }
 if (subcommand === "close" || subcommand === "block") { return finishTask(policy, task, options, subcommand); }
 throw new Error("task requires claim, release, close, or block");
}

/** @param {string[]} argumentsList @returns {Promise<number>} */
async function runTaskCommand(argumentsList) {
 const subcommand = argumentsList.shift(),
  taskId = argumentsList.shift() ?? "";
 if (subcommand === "expand-scope") {
  const options = parseOptions(argumentsList),
   path = argumentsList.shift() ?? "";
  if (!path) { throw new Error("scope expansion requires a path"); }
  const policy = await loadPolicy();
  await expandWriterClaim(policy.repositoryRoot, options.session, taskId, path);
  const task = await expandTaskScope(policy.repositoryRoot, taskId, path, options.reason);
  console.log(options.json ? JSON.stringify(task) : `expanded ${taskId} to ${path}`);
  return EXIT_CODES.ok;
 }
 const options = parseOptions(argumentsList),
  policy = await loadPolicy();
 if (options.scope === "task") {
  if (!options.task) { throw new Error("task verification requires --task TASK_ID"); }
  const task = (await readTasks(policy.repositoryRoot)).find((candidate) => candidate.task_id === options.task);
  if (!task) { throw new Error(`task not found: ${options.task}`); }
  options.paths = task.paths;
 }
 const tasks = await readTasks(policy.repositoryRoot),
  task = tasks.find((candidate) => candidate.task_id === taskId);
 if (!task) { throw new Error(`task not found: ${taskId}`); }
 return runTaskAction(subcommand, policy, task, options);
}

/** @param {readonly string[]} argumentsList @returns {Promise<number>} */
async function runVerify(argumentsList) {
 const options = parseOptions(argumentsList);
 if (!["path", "task", "changed", "repo"].includes(options.scope)) { throw new Error(`unsupported verification scope: ${options.scope}`); }
 const policy = await loadPolicy(),
  result = await verify({
   config: policy.config,
   measure: () => measureRepository({ paths: options.paths, policy, scope: options.scope }),
   repositoryRoot: policy.repositoryRoot,
   scope: /** @type {"path"|"task"|"changed"|"repo"} */ (options.scope),
  });
 if (options.json) { console.log(JSON.stringify(result)); }
 else { console.error(`verification ${result.scope}: ${result.exit_code === 0 ? "passed" : "failed"}`); }
 if (typeof result.exit_code !== "number") { throw new TypeError("verification did not return an exit code"); }
 return result.exit_code;
}

/** @param {boolean} json @param {string} repositoryRoot */
async function runSummary(json, repositoryRoot) {
 const [campaign, tasks, attempts, effects] = await Promise.all([
  readCampaign(repositoryRoot),
  readTasks(repositoryRoot),
  readLedger(repositoryRoot, "attempts.jsonl"),
  readLedger(repositoryRoot, "effects.jsonl"),
 ]),
  summary = {
   attempts: attempts.length,
   campaign,
   effects: effects.length,
   tasks: { accepted: tasks.filter((task) => task.state === "accepted").length, blocked: tasks.filter((task) => task.state === "blocked").length, claimed: tasks.filter((task) => task.state === "claimed").length, queued: tasks.filter((task) => task.state === "queued").length, stale: tasks.filter((task) => task.state === "stale").length, total: tasks.length },
  };
 if (json) { console.log(JSON.stringify(summary)); }
 else { console.error(JSON.stringify(summary, undefined, 2)); }
 return EXIT_CODES.ok;
}

/** @returns {Promise<number>} */
async function runValidate() {
 await loadPolicy();
 console.error("quality-hardening policy and taxonomy are valid");
 return EXIT_CODES.ok;
}

/** @param {string[]} argumentsList @returns {Promise<number>} */
async function runSummaryCommand(argumentsList) {
 const options = parseOptions(argumentsList),
  policy = await loadPolicy();
 return runSummary(options.json, policy.repositoryRoot);
}

/** @param {string[]} argumentsList @returns {Promise<number>} */
async function runHookCommand(argumentsList) {
 const event = argumentsList.shift();
 if (!event || !["pre", "post", "stop"].includes(event)) { throw new Error("hook requires pre, post, or stop"); }
 const result = await hook(/** @type {"pre"|"post"|"stop"} */(event), process.stdin);
 console.log(JSON.stringify(result));
 return result.decision === "block" ? EXIT_CODES.quality : EXIT_CODES.ok;
}

/** @type {Readonly<Record<string, (argumentsList: string[]) => Promise<number>>>} */
const commandHandlers = {
 hook: runHookCommand,
 measure: runMeasure,
 queue: runQueueCommand,
 summary: runSummaryCommand,
 task: runTaskCommand,
 validate: runValidate,
 verify: runVerify,
};

/** @param {readonly string[]} [argumentsList] */
async function main(argumentsList = process.argv.slice(2)) {
 const command = argumentsList[0] ?? "",
  handler = commandHandlers[command];
 if (!handler) { throw new Error(`usage:\n${usage()}`); }
 return handler(argumentsList.slice(1));
}

export { main, parseOptions };
