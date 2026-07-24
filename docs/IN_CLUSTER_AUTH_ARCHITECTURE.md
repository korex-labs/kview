# In-Cluster Deployment And Multi-User RBAC

Status: **future architecture option; not implemented and not a release commitment**.

This document records design options for running kview inside a Kubernetes
cluster while preserving its current local-client mode. It is intentionally an
engineering design note rather than end-user documentation.

## Goals

- Preserve the existing local, single-binary, kubeconfig-based workflow.
- Allow an optional in-cluster deployment behind an Ingress and enterprise OIDC
  provider such as Dex federating to ADFS.
- Keep one efficient read-side dataplane per cluster where practical.
- Make every user's effective access match Kubernetes authentication and RBAC.
- Attribute sensitive reads, mutations, logs, exec, and port-forward operations
  to the authenticated Kubernetes user.
- Fail closed: an authentication, authorization, projection, or policy error must
  never fall back to a more privileged service account.

## Non-Goals

- Replacing Kubernetes RBAC with application roles.
- Treating frontend capability hiding as authorization.
- Making a shared service account appear to be multiple Kubernetes users.
- Reusing Headlamp cookies, client secrets, or sessions without an explicit and
  reviewed trust contract.
- Shipping multi-cluster or highly available hosted mode in the first iteration.

## Current Local Architecture

The current application is intentionally single-user:

- `cmd/kview/main.go` creates one random process token and opens a local URL.
- `Server.authMiddleware` authenticates every caller with the same token and does
  not establish a user principal.
- `cluster.Manager` owns one process-wide active context and caches Kubernetes
  clients by kubeconfig context.
- `DataPlaneManager` owns one plane per context/cluster and uses the same
  kubeconfig identity as direct handlers.
- sessions, activities, investigation snapshots, signal memory, acknowledgements,
  and persistence do not have a tenant or authenticated owner.
- WebSocket authentication can use a token in the query string, and current
  WebSocket origin checks assume a local trusted browser.

Putting this process behind Dex or an authentication proxy would authenticate
access to the UI, but would not by itself make Kubernetes requests use each
user's identity.

## Required Security Model

Hosted mode must keep these concepts separate:

1. **Application authentication**: who has logged in to kview.
2. **Kubernetes identity**: which credential is used for an API request.
3. **Kubernetes authorization**: whether that identity may perform the exact
   verb/resource/scope operation.
4. **Application ownership**: who owns kview-local sessions, notes, snapshots,
   acknowledgements, and other operator state.

An authenticated identity should be represented explicitly:

```go
type Principal struct {
    Subject   string
    Username  string
    Email     string
    Groups    []string
    Issuer    string
    SessionID string
}
```

The subject and issuer are the stable application identity. Username and groups
are inputs to Kubernetes identity mapping and must come from a validated token or
trusted authentication boundary, never arbitrary client headers.

## Architecture Options

### Option A: Shared Service Account For All Requests

All users authenticate to kview, but every Kubernetes request uses the pod's
service account.

Advantages:

- simplest deployment;
- one client and one dataplane;
- minimal refactoring.

Disadvantages:

- Kubernetes sees every user as the same service account;
- user RBAC is not enforced;
- mutations and audit events lose user attribution;
- one missed application filter can expose the entire service-account view.

This is acceptable only for an explicitly trusted deployment where all users
have the same access. It does not meet the multi-user RBAC goal.

### Option B: End-To-End User Credentials

Each user request uses an OIDC token accepted by the Kubernetes API server. Reads,
mutations, and subresources are authorized directly by Kubernetes. Any kview
cache is scoped by user identity and authorization context.

Advantages:

- strongest and easiest-to-explain authorization model;
- Kubernetes remains the final authority;
- correct audit attribution;
- works better with non-RBAC or webhook authorizers.

Disadvantages:

- repeated list/watch work across users;
- less sharing inside kview;
- OIDC issuer, audience, refresh, username, and group claims must align with the
  API server.

This is the safest first hosted implementation and fallback path.

### Option C: Shared Raw Dataplane With Exact Authorization Gates

A minimally privileged read-only collector service account populates shared raw
snapshots. Before serving a cached cell, kview checks whether the authenticated
Kubernetes identity may perform the exact operation represented by that cell.
Sensitive reads and all operations continue to use the user's Kubernetes client.

This is the recommended steady-state architecture.

A shareable cache cell is defined by security-relevant operation semantics, for
example:

```text
cluster UID / API endpoint identity
GVR
verb
cluster scope or exact namespace
name and subresource when applicable
label and field selectors
projection/schema version
resource version and observed time
sensitivity class
```

A namespace Pod list can be shared only after a positive authorization decision
for `list pods` in that exact namespace. A Pod detail requires `get pods` for the
exact name. Events, logs, exec, port-forward, metrics, and related resources are
separate permissions.

The safe rule is:

> Serve the complete cached result of an operation only when the caller is
> authorized to perform that exact operation.

Do not load a global list and attempt to recreate Kubernetes authorization by
filtering individual rows. `resourceNames`, selectors, subresources, admission,
and webhook authorizers can have semantics that an application projection cannot
reconstruct. If a cached operation cannot be represented exactly, perform a live
request with user credentials.

### Option D: OIDC Identity With Kubernetes Impersonation

If the OIDC token cannot be forwarded to Kubernetes, kview may validate the user
and call the API through a service account using Kubernetes impersonation.

Advantages:

- preserves Kubernetes RBAC when token audiences cannot be aligned;
- audit events include the impersonated user;
- avoids exposing Kubernetes bearer tokens to the browser.

Disadvantages:

- permission to impersonate users and groups is extremely powerful;
- claim-to-username/group mapping becomes security-critical;
- compromise of the impersonating component has a large blast radius.

If needed, impersonation should be isolated behind a narrow internal gateway.
The shared dataplane collector must not also have impersonation permissions.

### Option E: Authorization-Cohort Dataplanes

Users with apparently equivalent permission sets share a dataplane populated
under a user identity.

This reduces collector privilege but is difficult to make correct. Group changes,
aggregated roles, webhook authorizers, and incomplete rule enumeration make safe
cohort fingerprints hard to maintain. It is a possible later optimization, not a
first implementation.

## Recommended Target

```text
Browser
  -> Ingress / TLS
  -> kview OIDC session
  -> authenticated Principal
       |-> user Kubernetes client
       |     direct and sensitive reads
       |     mutations
       |     logs / exec / port-forward / debug sessions
       |
       |-> AccessEvaluator
       |     exact SelfSubjectAccessReview
       |
       `-> AuthorizedDataplane
             shared raw snapshots from read-only collector
             authorized operation cells and derived projections only
```

Preferred identity order:

1. forward a short-lived Dex/OIDC token that Kubernetes accepts;
2. use tightly controlled impersonation only when token forwarding is not
   possible;
3. never silently fall back to the collector service account.

## Headlamp, Dex, And ADFS Compatibility

An existing Headlamp deployment is useful evidence but not proof that user RBAC
will transfer automatically. Verify the deployed configuration without copying
credentials into source or design documents:

- Headlamp OIDC issuer, client ID, scopes, token type, and whether it forwards a
  user token or uses its service account;
- Kubernetes API server issuer, accepted audience/client ID, username claim,
  group claim, and prefixes;
- Dex static clients, redirect URIs, ADFS connector claim mapping, and `groups`
  scope;
- whether a resulting user token produces the expected `kubectl auth can-i`
  results for users with different RBAC.

For direct token forwarding, the Kubernetes API server must trust the token's
issuer and audience and map the claims to the same users/groups referenced by
RoleBindings and ClusterRoleBindings. An access token and ID token are not
interchangeable unless the cluster configuration explicitly accepts the chosen
token.

A trusted proxy such as oauth2-proxy can authenticate users and forward claims,
but identity headers alone do not preserve Kubernetes RBAC. It must either
forward a Kubernetes-accepted token or feed a tightly controlled impersonation
path. Direct access to kview must be blocked, and the proxy must strip or
overwrite every client-supplied identity header.

References:

- [Headlamp in-cluster installation](https://headlamp.dev/docs/latest/installation/in-cluster/)
- [Headlamp OIDC configuration](https://headlamp.dev/docs/latest/installation/in-cluster/oidc/)
- [Headlamp identity-aware proxy configuration](https://headlamp.dev/docs/latest/installation/in-cluster/identity-aware-proxy/)
- [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Kubernetes authorization](https://kubernetes.io/docs/reference/access-authn-authz/authorization/)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Kubernetes impersonation](https://kubernetes.io/docs/reference/access-authn-authz/impersonation/)
- [Dex Kubernetes guide](https://dexidp.io/docs/guides/kubernetes/)

## Proposed Interfaces

Hosted behavior should be introduced through dependencies rather than scattered
mode checks:

```go
type Authenticator interface {
    Authenticate(*http.Request) (Principal, error)
}

type UserClientFactory interface {
    ForPrincipal(context.Context, Cluster, Principal) (*cluster.Clients, error)
}

type DataplaneClientFactory interface {
    ForCluster(context.Context, Cluster) (*cluster.Clients, error)
}

type AccessEvaluator interface {
    Allowed(context.Context, Principal, AccessAttributes) (bool, error)
}
```

Current behavior remains available through local adapters:

```text
LocalTokenAuthenticator
KubeconfigUserClientFactory
KubeconfigDataplaneClientFactory
```

Potential hosted adapters:

```text
OIDCSessionAuthenticator
TrustedProxyAuthenticator
ForwardedTokenUserClientFactory
ImpersonatingUserClientFactory
InClusterDataplaneClientFactory
SelfSubjectAccessReviewEvaluator
```

`cluster.Manager.ActiveContext()` must not remain shared mutable state in hosted
mode. Cluster selection should be request/session-scoped and resolved against an
allowlisted cluster catalog. A first hosted release should support one fixed
in-cluster cluster.

## Authorization And Cache Rules

- Use `SelfSubjectAccessReview` with the user's Kubernetes credential when
  possible.
- Treat denial, evaluation error, timeout, or incomplete policy mapping as deny.
- A positive review is a short-lived point-in-time decision, not a permanent
  entitlement.
- Keep authorization decision caching disabled or very short initially.
- Use live user requests when exact cached-operation semantics are unavailable.
- A positive review may control a UI affordance or cached read, but a mutation
  must still execute through the user client and accept the Kubernetes response
  as final.
- Never use `SelfSubjectRulesReview` as a complete authorization export.
- Derived projections must declare all input cells and exclude any unauthorized
  input before calculating counts, signals, relationships, or search results.
- Cross-resource joins must represent missing permissions as incomplete or
  unknown, not infer hidden data.

Authorization decision keys must include at least:

```text
principal subject
issuer
claims/groups hash or authorization epoch
cluster
verb
GVR
namespace
name/subresource
selectors where relevant
decision timestamp
```

## Sensitive And Derived Surfaces

Kubernetes-derived information remains protected even when it is not a raw
object:

- namespace and resource names;
- counts and revision counters;
- dashboard and signal summaries;
- search indexes and match reasons;
- owner/reference and impact-path edges;
- metrics, Events, logs, YAML, Secret/ConfigMap-derived hints;
- normalized errors that contain hidden identities.

No response may disclose such data unless the caller is authorized for the
operation and dependencies that produced it.

## User-Owned State

Hosted mode must add owner and tenant dimensions to:

- investigation snapshots and notes;
- signal memory and acknowledgements;
- activities and runtime logs;
- terminal, port-forward, and job-debug sessions;
- saved views, settings, and browser-local storage keys where account switching
  could expose previous-user state.

A baseline ownership key is:

```text
cluster UID + issuer + principal subject
```

Private operator data and shared team data are separate future concepts. Shared
notes or investigations need an explicit kview policy; Kubernetes RBAC should not
be assumed to define ownership of application-local records.

## Browser And Session Security

Hosted authentication should use an OIDC Authorization Code flow, preferably
with PKCE, and a server-side session:

- `HttpOnly`, `Secure`, and appropriate `SameSite` cookies;
- CSRF protection for state-changing application endpoints;
- trusted `X-Forwarded-Proto` and host handling behind the Ingress;
- strict WebSocket Origin validation;
- no reusable bearer tokens in URLs, browser history, logs, or telemetry;
- one-time or short-lived WebSocket tickets when cookie authentication is not
  sufficient;
- logout and session revocation that also terminate owned streams and sessions.

Refresh tokens should remain server-side and encrypted or stored in a dedicated
session backend if persistence or multiple replicas are required.

## Collector And Deployment Security

- The collector service account is read-only and resource-allowlisted rather than
  `cluster-admin`.
- Avoid collecting Secret data unless a feature explicitly requires it; metadata
  and sensitivity classifications should be reviewed separately.
- The collector cannot mutate resources or impersonate users/groups.
- NetworkPolicy limits direct access to the backend and any impersonation gateway.
- Hosted mode starts with one replica. Multiple replicas require shared session
  state plus leader election or a separate collector; local bbolt and process
  memory are not HA coordination mechanisms.
- Kubernetes audit and kview audit records should include principal, cluster,
  operation, resource scope, result, and correlation ID without logging tokens.

## Configuration Shape

One binary should support validated deployment profiles. A possible future schema:

```yaml
deployment:
  mode: local # local | inCluster

server:
  listen: 127.0.0.1:10443
  publicURL: ""
  basePath: ""
  trustedProxies: []

auth:
  mode: localToken # localToken | oidc | trustedProxy
  oidc:
    issuerURL: ""
    clientID: ""
    clientSecretFile: ""
    redirectURL: ""
    scopes: [openid, profile, email, groups]
  trustedProxy:
    usernameHeader: X-Forwarded-User
    emailHeader: X-Forwarded-Email
    groupsHeader: X-Forwarded-Groups
    tokenHeader: X-Forwarded-Id-Token

kubernetes:
  mode: kubeconfig # kubeconfig | inCluster
  userIdentity: kubeconfig # kubeconfig | forwardedToken | impersonation
  context: ""

dataplane:
  mode: local # local | userScoped | sharedAuthorized
  persistence:
    enabled: true

session:
  secretFile: ""
  secureCookies: true
```

Expected precedence:

```text
CLI flags > environment variables > configuration file > defaults
```

Secrets belong in mounted Secret files or an equivalent secret provider, not in
committed values or ConfigMaps. Startup validation must reject unsafe combinations
instead of silently downgrading authorization.

## Staged Implementation Option

This is a future sequence, not an active commitment:

1. **Architecture foundation**
   - deployment/config model;
   - `Principal`, `Authenticator`, cluster catalog, user/dataplane client factories;
   - current local behavior implemented through adapters and regression-tested.
2. **Single-cluster hosted baseline**
   - one replica, Ingress/public URL, health/readiness;
   - live user-authorized reads and a read-only pilot;
   - no shared cache for surfaces without explicit authorization contracts.
3. **Dex/OIDC sessions**
   - login, callback, current-user, logout, CSRF, WebSocket session handling;
   - forwarded Kubernetes token where issuer/audience allow it.
4. **Shared authorized dataplane**
   - collector service account;
   - operation-cell metadata and exact SSAR gates;
   - enable simple resource lists one resource at a time.
5. **Derived surfaces**
   - authorized Dashboard, Signals, Search, metrics, and relationships;
   - explicit dependency sets and incomplete/unknown semantics.
6. **Multi-user application state and operations**
   - owner-scoped persistence and sessions;
   - logs, exec, port-forward, debug, YAML, actions, and Helm through user identity;
   - audit attribution and revocation behavior.
7. **Hardening and scale**
   - restricted RBAC/NetworkPolicy, security tests, session backend, leader
     election or separate collector, and optional multi-cluster support.

## Acceptance Invariant

The primary acceptance condition for hosted mode is:

> If a user cannot obtain Kubernetes-derived information through an authorized
> API operation as their Kubernetes identity, no list, detail, dashboard count,
> signal, search result, activity, session, snapshot, relationship, error, or
> persisted projection in kview may reveal that information.

Local mode remains the default until the hosted path satisfies this invariant and
has explicit isolation tests for users with different RBAC grants and revocation
changes.
