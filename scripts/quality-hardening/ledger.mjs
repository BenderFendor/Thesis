// @ts-check

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const LEDGER_RELATIVE = "docs/agents/quality-hardening/ledger";

/** @param {string} repositoryRoot @param {string} fileName */
const ledgerPath = (repositoryRoot, fileName) => {
  return resolve(repositoryRoot, LEDGER_RELATIVE, fileName);
}

/** @param {string} repositoryRoot @param {string} fileName @param {Readonly<Record<string, unknown>>} record */
const appendLedger = async (repositoryRoot, fileName, record) => {
  const path = ledgerPath(repositoryRoot, fileName);
  await mkdir(resolve(repositoryRoot, LEDGER_RELATIVE), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

/** @param {string} repositoryRoot @param {string} fileName @returns {Promise<Record<string, unknown>[]>} */
const readLedger = async (repositoryRoot, fileName) => {
  try {
    const text = await readFile(ledgerPath(repositoryRoot, fileName), "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {return [];}
    throw error;
  }
}

/** @param {string} repositoryRoot @param {Readonly<Record<string, unknown>>} campaign */
const writeCampaign = async (repositoryRoot, campaign) => {
  const path = ledgerPath(repositoryRoot, "campaign.json");
  await mkdir(resolve(repositoryRoot, LEDGER_RELATIVE), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(campaign, undefined, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/** @param {string} repositoryRoot @returns {Promise<Record<string, unknown> | null>} */
const readCampaign = async (repositoryRoot) => {
  try {
    return JSON.parse(await readFile(ledgerPath(repositoryRoot, "campaign.json"), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {return null;}
    throw error;
  }
}

export { appendLedger, ledgerPath, readCampaign, readLedger, writeCampaign };
