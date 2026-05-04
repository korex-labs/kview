import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type KviewState = {
  backendURL: string;
  token: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const statePath = path.resolve(repoRoot, ".artifacts/playwright/state/kview.json");

function cleanupKview(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Process may have already exited.
  }
}

async function cleanupKviewAndWait(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  cleanupKview(child);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Process may have already exited.
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForKview(child: ChildProcessWithoutNullStreams): Promise<KviewState> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for kview startup. Output:\n${output}`));
    }, 60_000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/open:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=([a-f0-9]+))/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ backendURL: match[1].split("/?token=")[0], token: match[2] });
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`kview exited before startup with code ${code}. Output:\n${output}`));
    });
  });
}

async function waitForVerifiedBackend(child: ChildProcessWithoutNullStreams, state: KviewState): Promise<void> {
  let exited = false;
  let exitCode: number | null = null;
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`kview exited after printing its URL (code ${exitCode}). Is port ${state.backendURL} already in use?`);
    }
    try {
      const response = await fetch(`${state.backendURL}/api/contexts`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (response.status === 401) {
        throw new Error(
          `kview token verification failed with 401 at ${state.backendURL}. ` +
          "This usually means an older kview is already listening on the E2E backend port.",
        );
      }
      if (response.ok) return;
      lastError = `HTTP ${response.status}: ${await response.text()}`;
    } catch (err) {
      lastError = String((err as Error | undefined)?.message || err);
      if (lastError.includes("older kview")) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out verifying kview backend at ${state.backendURL}: ${lastError}`);
}

async function globalSetup() {
  const listen = `127.0.0.1:${process.env.KVIEW_E2E_BACKEND_PORT || "10444"}`;
  const args = ["run", "./cmd/kview", "--listen", listen, "--open=false", "--mode", "server", "--read-only"];
  if (process.env.KVIEW_E2E_KUBECONFIG) {
    args.push("--config", process.env.KVIEW_E2E_KUBECONFIG);
  }

  const child = spawn("go", args, {
    cwd: repoRoot,
    env: process.env,
    detached: process.platform !== "win32",
  });

  try {
    const state = await waitForKview(child);
    await waitForVerifiedBackend(child, state);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    return async () => {
      await cleanupKviewAndWait(child);
    };
  } catch (err) {
    await cleanupKviewAndWait(child);
    throw err;
  }
}

export default globalSetup;
