/// <reference path="../frontend/node_modules/@types/node/index.d.ts" />
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectOwnedFrontendFiles } from "./quality-source-files.mjs";
import { runTransform as leanLocal } from "./transformations/lean-local.ts";
import { runTransform as unusedImports } from "./transformations/unused-imports.ts";

const transforms = new Map([
  ["dead", leanLocal],
  ["imports", unusedImports],
]);
const { values } = parseArgs({
  options: {
    apply: { default: false, type: "boolean" },
    rules: { default: "dead,imports", type: "string" },
  },
});
const root = resolve(import.meta.dirname, "..");
const selected = values.rules.split(",").map((name) => {
  const transform = transforms.get(name);
  if (transform === undefined) {
    throw new Error(`Unknown transformation: ${name}`);
  }
  return { name, transform };
});

/**
 * @param {string} before Original module.
 * @param {string} path Source path for TSX parsing.
 * @returns {{after: string, rules: string[]}} Proposed source and applied rules.
 */
const transformSource = (before, path) => {
  const rules = [];
  let after = before;
  for (const { name, transform } of selected) {
    const result = transform(after, path);
    if (result.changed) {
      rules.push(name);
      after = result.text;
    }
  }
  return { after, rules };
};

const candidates = await Promise.all(
  collectOwnedFrontendFiles(root).map(async (file) => {
    const path = resolve(root, file);
    const before = await readFile(path, "utf8");
    const { after, rules } = transformSource(before, path);
    return { after, before, file, path, rules };
  }),
);
const plan = candidates.filter(({ before, after }) => before !== after);

const main = async () => {
  if (values.apply) {
    await Promise.all(
      plan.map(async (entry) => {
        if ((await readFile(entry.path, "utf8")) !== entry.before) {
          throw new Error(`Source changed during audit: ${entry.file}`);
        }
      }),
    );
    await Promise.all(plan.map((entry) => writeFile(entry.path, entry.after)));
  }
  printReport();
};
const printReport = () => {
  console.log(
    JSON.stringify(
      {
        applied: values.apply,
        files: plan.map(({ file, before, after, rules }) => ({
          bytesRemoved: Buffer.byteLength(before) - Buffer.byteLength(after),
          file,
          rules,
        })),
      },
      null,
      2,
    ),
  );
};

await main();
