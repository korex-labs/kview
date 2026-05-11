# Custom Commands And Actions

Custom Commands and Custom Actions let users define reusable operator workflows
from Settings.

## What This Is For

Use custom definitions when your team repeats the same container inspection
command or workload patch often enough that it should be available from kview.

## Custom Commands

Custom Commands run against matching pod containers. A command definition
includes target matching rules, command text, output type, and safety level.
Commands are executed with `/bin/sh -lc` inside the selected container.

Output types change how kview presents the result:

- **text**: shows stdout as plain text with copy support.
- **keyValue**: parses stdout as key-value rows. If stdout is not parseable,
  kview falls back to plain text and shows an info message.
- **csv**: parses stdout as a delimited table. kview detects comma, tab, or
  other supported delimiters and falls back to plain text when the output is
  not table-shaped.
- **code**: shows stdout in a syntax-highlighted code block. Set **Code
  language** for a specific highlighter such as `json`, `yaml`, `shell`, or
  leave it blank for auto-detection.
- **file**: treats stdout as downloadable output instead of rendering it in the
  dialog. Set **File name** for the downloaded name and optionally enable
  **Compress with gzip**.

The command output dialog includes an output filter for rendered output types.
For **keyValue** output, **Pretty values** reuses the same prettifier used by
Pod environment variables: exact boolean-like values and log-level values are
shown as chips, and `http://` or `https://` values become clickable links.

## Custom Actions

Custom Actions apply configured workload changes. Supported definitions include
setting environment variables, unsetting environment variables, changing images,
and applying JSON or merge patches.

## Optional Behavior

Custom definitions do nothing until a matching resource exposes them. If a
command or action is scoped narrowly, it appears only for matching targets. If
RBAC or backend capability checks do not allow the operation, kview hides or
disables the action.

Container matching is optional. Leave **Container pattern** blank to make a
command available on every actionable container, or provide a regular
expression to limit where it appears. Invalid regular expressions are reported
in Settings.

Safety controls alter confirmation behavior. **Safe** commands use simple
confirmation. **Dangerous** commands require typed confirmation before
execution.

## Common Workflows

- Keep names clear and specific.
- Scope commands and actions to the smallest useful set of resources.
- Mark dangerous commands clearly.
- Use **keyValue** for environment-like output such as `/bin/env`.
- Use **file** with **Compress with gzip** for large diagnostic dumps that are
  easier to inspect outside kview.
- Test definitions on a non-production namespace before relying on them during
  an incident.
- Export settings to share definitions between browser profiles.

## Permission And Data Notes

Custom Commands can start container exec sessions. Custom Actions can mutate
Kubernetes workloads. Both depend on the selected resource, active context, and
RBAC permissions.

## Related Settings

- **Custom Commands**
- **Custom Actions**
- **Import / Export**
