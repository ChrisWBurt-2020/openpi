# Diagnostics

OpenPi keeps a bounded main-process journal for the most recent lifecycle and workspace-transport events. It records a diagnostic ID, timestamp, area, action, safe payload shape, correlation ID, duration, and any error stack/cause available to Electron main.

The export is intentionally redacted. It does not include prompt text, file contents, provider headers, credentials, API keys, cookies, or complete shell commands. Paths are replaced with stable placeholders where possible.

Use the Diagnostics export after a failed prompt, missing tool result, stopped SSH Workspace request, sidecar crash, or unexpected Run state. Include the diagnostic ID shown by the affected error when reporting a problem. Non-Git folders are expected capability states: their filesystem tree remains available and Git metadata is simply absent.
