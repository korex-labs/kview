export type PodEphemeralContainer = {
  name: string;
  image?: string;
  imageId?: string;
  targetContainer?: string;
  state?: string;
  reason?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
};

export type PodContainer = {
  name: string;
  image?: string;
  imageId?: string;
  ready: boolean;
  state?: string;
  reason?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  restartCount: number;
  lastTerminationReason?: string;
  lastTerminationMessage?: string;
  lastTerminationAt?: number;
  resources: {
    cpuRequest?: string;
    cpuLimit?: string;
    memoryRequest?: string;
    memoryLimit?: string;
  };
  /** Optional usage merged from metrics.k8s.io on the detail endpoint. */
  usage?: {
    cpuMilli: number;
    memoryBytes: number;
    cpuPctRequest?: number;
    cpuPctLimit?: number;
    memoryPctRequest?: number;
    memoryPctLimit?: number;
  };
  ports?: {
    name?: string;
    containerPort: number;
    protocol?: string;
  }[];
  env: {
    name: string;
    value?: string;
    source?: string;
    sourceRef?: string;
    optional?: boolean;
  }[];
  mounts: {
    name: string;
    mountPath: string;
    readOnly: boolean;
    subPath?: string;
  }[];
  probes: {
    liveness?: Probe;
    readiness?: Probe;
    startup?: Probe;
  };
  securityContext: ContainerSecurity;
};

export type Probe = {
  type?: string;
  command?: string;
  path?: string;
  port?: string;
  scheme?: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
};

export type ContainerSecurity = {
  name: string;
  runAsUser?: number;
  runAsGroup?: number;
  privileged?: boolean;
  readOnlyRootFilesystem?: boolean;
  allowPrivilegeEscalation?: boolean;
  capabilitiesAdd?: string[];
  capabilitiesDrop?: string[];
  seccompProfile?: string;
};
