# Activity Panel

The Activity Panel is the fixed bottom panel for background work, runtime
sessions, port forwards, and kview runtime logs.

## What This Is For

Use the Activity Panel to monitor work that continues after the original action
starts, such as dataplane snapshots, namespace enrichment, terminal sessions,
and port forwards.

## Main Controls

- **Collapse / expand**: use the chevron button or double-click the panel
  header.
- **Resize**: drag the top edge of the open panel.
- **Status area**: shows backend and cluster status dots plus active context
  details on hover.
- **Tabs**: switch between **Activities**, **Work**, **Terminals**,
  **Port forwards**, and **Logs**.

## Tabs

**Activities** shows recent and active runtime operations. Rows include type,
resource, target, status, duration, and actions for terminal, port-forward, and
log-related entries.

**Work** shows dataplane scheduler state. It separates running and queued work
and includes cluster, kind, namespace, priority, source, queued time, running
time, and work key.

**Terminals** shows open terminal sessions. Multiple terminal sessions can be
open at once and are represented as tabs inside the Activity Panel. Pod Debug
sessions use the same terminal surface. Explicitly closing a connected Pod Debug
terminal first sends `exit` to its shell; an ordinary connection loss does not
guarantee that the ephemeral container has terminated.

**Port forwards** shows active port-forward sessions with local endpoint,
remote port, service, pod, and actions to open or stop the forward.

**Logs** shows kview runtime log entries. It auto-scrolls while the user is at
the bottom of the log table.

## Optional Behavior

kview remembers whether the Activity Panel is open or collapsed from direct
interaction. kview also remembers the last resized panel height. This is local
UI state, not an Appearance form setting.

The panel is covered by full-surface views such as Settings and Help so it does
not overlap those screens.

## Keyboard Shortcuts

- <kbd>Alt+A</kbd> or <kbd>g a</kbd>: toggle the panel
- <kbd>Alt+1</kbd> or <kbd>g 1</kbd>: open **Activities**
- <kbd>Alt+2</kbd> or <kbd>g 2</kbd>: open **Work**
- <kbd>Alt+3</kbd> or <kbd>g 3</kbd>: open **Terminals**
- <kbd>Alt+4</kbd> or <kbd>g 4</kbd>: open **Port forwards**
- <kbd>Alt+5</kbd> or <kbd>g 5</kbd>: open **Logs**

## Permission And Data Notes

The panel reflects runtime state from the local kview backend. Terminal and
port-forward rows appear only when those sessions exist and are allowed by the
selected resource and RBAC permissions.

## Related Settings

- **Dataplane**
- **Keyboard**
