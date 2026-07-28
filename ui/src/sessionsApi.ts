import { apiPost, apiPostWithContext } from "./api";
import type { CustomCommandOutputType } from "./settings";

export async function apiDelete(path: string, token: string): Promise<void> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      const raw = (await res.text()).trim();
      if (raw) {
        if (raw.startsWith("{") || raw.startsWith("[")) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const fromPayload = parsed.message || parsed.error;
          if (typeof fromPayload === "string" && fromPayload.trim()) {
            msg = fromPayload;
          } else {
            msg = raw;
          }
        } else {
          msg = raw;
        }
      }
    } catch {
      // ignore parse failures and keep status text
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

type TerminalSessionRequest = {
  namespace: string;
  pod: string;
  container?: string;
  title?: string;
  shell?: string;
};

type TerminalSessionResponse = {
  item: {
    id: string;
    targetContainer?: string;
  };
};

export async function createTerminalSession(req: TerminalSessionRequest, token: string): Promise<string> {
  const res = await apiPost<TerminalSessionResponse>("/api/sessions/terminal", token, req);
  return res.item.id;
}

export type PodDebugSessionRequest = {
  namespace: string;
  pod: string;
  expectedUID: string;
  targetContainer: string;
  image: string;
  shell: string;
  profile: "baseline";
  requestId: string;
};

export async function createPodDebugSession(
  req: PodDebugSessionRequest,
  token: string,
  contextName: string,
): Promise<{ sessionID: string; debugContainer: string }> {
  const res = await apiPostWithContext<TerminalSessionResponse>("/api/sessions/pod-debug", token, contextName, req);
  return { sessionID: res.item.id, debugContainer: res.item.targetContainer || "" };
}

type PortForwardSessionRequest = {
  namespace: string;
  pod?: string;
  service?: string;
  remotePort: number;
  localPort?: number;
  localHost?: string;
  title?: string;
};

type PortForwardSessionResponse = {
  item: {
    id: string;
  };
  localPort: number;
  localHost: string;
  remotePort: number;
};

export async function createPortForwardSession(
  req: PortForwardSessionRequest,
  token: string
): Promise<PortForwardSessionResponse> {
  return apiPost<PortForwardSessionResponse>("/api/sessions/portforward", token, req);
}

export type RunContainerCommandRequest = {
  namespace: string;
  pod: string;
  container: string;
  command: string;
  workdir?: string;
  outputType: CustomCommandOutputType;
  fileName?: string;
  compress?: boolean;
};

export type RunContainerCommandResult = {
  stdout?: string;
  stderr?: string;
  outputBase64?: string;
  exitCode: number;
  durationMs: number;
  fileName?: string;
  compressed?: boolean;
  error?: string;
};

type RunContainerCommandResponse = {
  item: RunContainerCommandResult;
};

export async function runContainerCommand(
  req: RunContainerCommandRequest,
  token: string,
  contextName: string,
): Promise<RunContainerCommandResult> {
  const res = await apiPostWithContext<RunContainerCommandResponse>(
    "/api/container-commands/run",
    token,
    contextName,
    req,
  );
  return res.item;
}
