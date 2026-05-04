import type { Route } from "@playwright/test";

type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

const resourceKindByPath: Record<string, string> = {
  contexts: "context",
  namespaces: "namespace",
  nodes: "node",
  pods: "pod",
  deployments: "deployment",
  daemonsets: "daemonset",
  statefulsets: "statefulset",
  replicasets: "replicaset",
  jobs: "job",
  cronjobs: "cronjob",
  horizontalpodautoscalers: "hpa",
  services: "service",
  ingresses: "ingress",
  configmaps: "configmap",
  secrets: "secret",
  serviceaccounts: "serviceaccount",
  roles: "role",
  rolebindings: "rolebinding",
  clusterroles: "clusterrole",
  clusterrolebindings: "clusterrolebinding",
  persistentvolumes: "pv",
  persistentvolumeclaims: "pvc",
  customresourcedefinitions: "crd",
  helmreleases: "helmrelease",
  helmcharts: "helmchart",
};

const kindByObjectKind: Record<string, string> = {
  Namespace: "namespace",
  Node: "node",
  Pod: "pod",
  Deployment: "deployment",
  DaemonSet: "daemonset",
  StatefulSet: "statefulset",
  ReplicaSet: "replicaset",
  Job: "job",
  CronJob: "cronjob",
  HorizontalPodAutoscaler: "hpa",
  Service: "service",
  Ingress: "ingress",
  ConfigMap: "configmap",
  Secret: "secret",
  ServiceAccount: "serviceaccount",
  Role: "role",
  RoleBinding: "rolebinding",
  ClusterRole: "clusterrole",
  ClusterRoleBinding: "clusterrolebinding",
  PersistentVolume: "pv",
  PersistentVolumeClaim: "pvc",
  CustomResourceDefinition: "crd",
  HelmRelease: "helmrelease",
  HelmChart: "helmchart",
};

const valueKindByKey: Record<string, string> = {
  active: "context",
  authinfo: "user",
  authInfo: "user",
  cluster: "cluster",
  context: "context",
  contextname: "context",
  contextName: "context",
  container: "container",
  controllername: "controller",
  controllerName: "controller",
  host: "host",
  hostname: "host",
  image: "image",
  imageid: "image",
  imageId: "image",
  ip: "ip",
  name: "resource",
  namespace: "namespace",
  node: "node",
  nodename: "node",
  nodeName: "node",
  pod: "pod",
  podip: "ip",
  podIp: "ip",
  podname: "pod",
  podName: "pod",
  release: "helmrelease",
  service: "service",
  serviceaccount: "serviceaccount",
  serviceAccount: "serviceaccount",
  targetcluster: "cluster",
  targetCluster: "cluster",
  targetnamespace: "namespace",
  targetNamespace: "namespace",
  targetresource: "resource",
  targetResource: "resource",
  url: "url",
};

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferKindFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const kind = resourceKindByPath[segments[i]];
    if (kind) return kind;
  }
  return "resource";
}

function isPlainRecord(value: JSONValue): value is { [key: string]: JSONValue } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProbablySensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "labels" ||
    lower.includes("annotation") ||
    lower.includes("selector") ||
    lower.includes("owner") ||
    lower.includes("ref") ||
    lower.includes("url") ||
    lower.includes("host") ||
    lower.includes("endpoint");
}

export class ApiSanitizer {
  private realToFake = new Map<string, string>();
  private fakeToReal = new Map<string, string>();
  private counters = new Map<string, number>();

  async handle(route: Route, backendURL: string): Promise<void> {
    const request = route.request();
    const original = new URL(request.url());
    const rewritten = new URL(this.restoreForRequest(`${original.pathname}${original.search}`), backendURL);
    const postData = request.postData();
    const restoredHeaders = this.restoreHeaders(request.headers());

    const response = await route.fetch({
      url: rewritten.toString(),
      headers: restoredHeaders,
      postData: postData ? this.restoreForRequest(postData) : undefined,
    });

    const headers = response.headers();
    const contentType = headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      await route.fulfill({ response });
      return;
    }

    const payload = await response.json() as JSONValue;
    const sanitized = this.sanitizeResponse(payload, original.pathname);
    const { "content-length": _contentLength, ...sanitizedHeaders } = headers;
    await route.fulfill({
      status: response.status(),
      headers: sanitizedHeaders,
      body: JSON.stringify(sanitized),
    });
  }

  restoreForRequest(value: string): string {
    let restored = value;
    for (const [fake, real] of this.fakeToReal) {
      restored = restored.replace(new RegExp(escapeRegExp(fake), "g"), real);
      restored = restored.replace(new RegExp(escapeRegExp(encodeURIComponent(fake)), "g"), encodeURIComponent(real));
    }
    return restored;
  }

  private restoreHeaders(headers: Record<string, string>): Record<string, string> {
    const restored: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      restored[key] = this.restoreForRequest(value);
    }
    return restored;
  }

  sanitizeText(value: string): string {
    let sanitized = value;
    for (const [real, fake] of this.sortedRealEntries()) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(real), "g"), fake);
      sanitized = sanitized.replace(new RegExp(escapeRegExp(encodeURIComponent(real)), "g"), encodeURIComponent(fake));
    }
    sanitized = sanitized.replace(/https?:\/\/[^\s"',)]+/g, (url) => this.map(url, "url"));
    sanitized = sanitized.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (ip) => this.map(ip, "ip"));
    return sanitized;
  }

  private sanitizeResponse(value: JSONValue, pathname: string): JSONValue {
    return this.sanitizeValue(value, {
      pathKind: inferKindFromPath(pathname),
      parentKey: "",
    });
  }

  private sanitizeValue(value: JSONValue, context: { key?: string; parentKey: string; pathKind: string }): JSONValue {
    if (typeof value === "string") {
      const kind = this.kindForKey(context.key || "", context.pathKind);
      const sensitive = kind !== "" || isProbablySensitiveKey(context.parentKey);
      const mapped = sensitive && value.trim() ? this.map(value, kind || "value") : value;
      return this.sanitizeText(mapped);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, context));
    }
    if (!isPlainRecord(value)) {
      return value;
    }

    const objectKind = typeof value.kind === "string" ? kindByObjectKind[value.kind] : "";
    const pathKind = objectKind || context.pathKind;
    const out: Record<string, JSONValue> = {};

    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = isProbablySensitiveKey(context.parentKey) ? this.map(rawKey, `${context.parentKey}-key`) : rawKey;
      const valueKind = rawKey === "name" ? pathKind : this.kindForKey(rawKey, pathKind);
      out[key] = this.sanitizeValue(rawValue, {
        key: valueKind ? rawKey : undefined,
        parentKey: rawKey,
        pathKind,
      });
    }
    return out;
  }

  private kindForKey(key: string, pathKind: string): string {
    if (!key) return "";
    if (key === "name") return pathKind;
    return valueKindByKey[key] || valueKindByKey[key.toLowerCase()] || "";
  }

  private map(real: string, kind: string): string {
    const trimmed = real.trim();
    if (!trimmed || trimmed === "-") return real;
    const existing = this.realToFake.get(real);
    if (existing) return existing;

    const next = (this.counters.get(kind) || 0) + 1;
    this.counters.set(kind, next);
    const fake = `${kind}-${pad(next)}`;
    this.realToFake.set(real, fake);
    this.fakeToReal.set(fake, real);
    return fake;
  }

  private sortedRealEntries(): Array<[string, string]> {
    return [...this.realToFake.entries()].sort((a, b) => b[0].length - a[0].length);
  }
}
