# GitHub authentication for the release proxy

The deployed Worker may hit GitHub's shared unauthenticated egress-IP quota.
Set optional Worker Secret `GITHUB_TOKEN` to a dedicated fine-grained GitHub PAT.
Use public-repository read-only access (or only korex-labs/kview with Contents read
and automatic Metadata read). No write, administration, workflow or private-repo
access is needed. Choose an expiry and rotate before it expires.

Cloudflare: kview-services → Settings → Variables and Secrets → Add → Secret.
Name: GITHUB_TOKEN. Paste the token only into the secret value, then deploy.
Replace the editor source with current worker.js and deploy. Do not paste the
actual token into source, chat, browser requests, or kview settings. Existing DB
binding, route and cron stay unchanged. No D1 migration or client rebuild needed.

Only fixed GitHub fetches receive Authorization; redirects are not followed.
Visitor credentials are never forwarded. Public cached responses contain only
release tag and URL. HTTP failures expose only upstream status, never its body
or credentials, and are not cached. Without the secret, unauthenticated requests
remain supported but quota failures can recur. Invalid/expired tokens yield 502;
rotate the secret, do not add broader permissions reflexively.

This rollout uses canonical cache generation v2 to avoid treating a pre-change
cached response as proof of the new code path. Query strings supplied by visitors
still do not fragment the cache. Cache is edge-local, not globally serialized.
Verify production release response and Worker invocations after deployment;
HTTP success alone does not establish that a secret was configured correctly.
