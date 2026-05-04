import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type KviewE2EState = {
  backendURL: string;
  token: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const statePath = path.resolve(repoRoot, ".artifacts/playwright/state/kview.json");

export async function readKviewState(): Promise<KviewE2EState> {
  return JSON.parse(await readFile(statePath, "utf8")) as KviewE2EState;
}
