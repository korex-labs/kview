import { apiPost } from "./api";

export async function apiDelete(path: string, token: string): Promise<void> {
  const url = path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  const res = await fetch(url, {
    method: "DELETE",
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
  };
};

export async function createTerminalSession(req: TerminalSessionRequest, token: string): Promise<string> {
  const res = await apiPost<TerminalSessionResponse>("/api/sessions/terminal", token, req);
  return res.item.id;
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

