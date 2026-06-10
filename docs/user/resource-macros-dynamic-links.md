# Resource Macros And Dynamic Links

Resource Macros and Dynamic Links are local settings for building external
links from resource information. They are not Kubernetes labels or annotations.

## What This Is For

Use Resource Macros and Dynamic Links when resource names, labels, or
annotations contain values that map to external systems such as Jira, GitLab,
runbooks, dashboards, or internal portals.

## Main Controls

- **Enable resource macros**: allows kview to resolve manual and extracted
  macro values for resource drawers.
- **Enable dynamic links**: shows resolved external links in supported resource
  drawer headers.
- **Manual Macros tab**: define fixed values such as `$JIRA_URL` or
  `$GITLAB_URL`, optionally scoped to a context, namespace, node, or resource.
- **Extracted Macros tab**: derive values from a resource name, label, or
  annotation by using a regular expression and value template.
- **Dynamic Links tab**: define link labels and URL templates that use macros.
  Links are not scoped to resource types; they appear anywhere their template
  can be resolved.

Drawer headers that support local resource tags also include a macro edit
control for assigning manual macros to that drawer scope. The macro menu shows
directly assigned macros first and can optionally show inherited and extracted
macros for the selected resource. Dynamic links appear as chips in the same
drawer header row as resource tags when their URL templates resolve.

## Macro Resolution

Manual macros can be scoped from broad to narrow. Narrower scopes override
broader scopes when the same macro name is available.

The settings form offers known contexts, namespaces, and resource types as
selectors. Resource names and node names can be typed when a macro needs to
target one exact object.

When a macro is assigned from a drawer, kview fills the scope from the drawer:
namespace drawers create namespace-scoped macros, pod drawers create
pod-specific macros, and other supported resource drawers create resource-
scoped macros.

The resolution order is:

- global
- context
- namespace
- node
- extracted values from the selected resource
- resource

Macros can reference other macros. For example, `$JIRA_ISSUE_URL` can use
`$JIRA_URL` and `$JIRA_ISSUE`. kview resolves macro references recursively and
stops if a cycle or excessive depth is detected.

## Extracted Values

An extractor defines:

- the macro name to create
- optional resource types where it applies
- the source: resource name, label, or annotation
- a regular expression pattern
- a value template such as `$1`
- an optional transform: none, uppercase, lowercase, or uppercase first letter

If the extractor does not match the selected resource, the macro is not
created for that drawer.

## Dynamic Links

Dynamic links use URL templates such as:

```text
$GITLAB_URL/$GITLAB_PROJECT/-/tree/$GITLAB_BRANCH
```

A link appears only when all referenced macros resolve and the final URL uses
`http` or `https`.

## Permission And Data Notes

Resource Macros and Dynamic Links are stored in local kview settings. They do
not write to Kubernetes resources. Opening a dynamic link leaves kview and uses
the resolved external URL in the browser.

## Related Settings

- **Links & Macros**
- **Import / Export**
