# Cosmic Canvas threat model

## Trust boundaries

Cosmic Canvas has three authorities: the React shell, the rendered document iframe, and (in extension mode) the VS Code extension host. The shell owns canonical source and user intent. The iframe may contain untrusted author HTML. Only the extension host can modify or save the opened VS Code document.

Every preview revision gets a random 128-bit session token. The shell accepts editor messages only from the current iframe `WindowProxy`, with the current token, and after strict runtime payload validation. The iframe accepts commands only from its parent and with that token. A preview reload invalidates all earlier traffic. Payloads that can carry HTML are capped at 20 MB.

Wildcard message targets remain because sandboxed trusted and VS Code iframe documents have opaque origins. The wildcard is not an authorization check; receiver-side source, session, revision, type, and shape checks provide authorization.

## Author scripts

Untrusted mode makes author scripts and inline handlers inert. Trusted mode deliberately runs them in an opaque-origin sandbox without `allow-same-origin`. Trusted author code can render and send ordinary browser messages, but it cannot obtain the random token from the parent shell and cannot impersonate selection, document-change, shortcut, or save traffic. It has no direct VS Code API.

## Local files and resources

Browser mode does not grant a pasted document access to a local directory. VS Code grants the custom editor only the extension's built assets and the opened document directory through `localResourceRoots`; sibling resources are translated through `asWebviewUri`. No parent directory or arbitrary local path is added. Resource failures report URLs but diagnostics copy never includes document source.

## Save, clipboard, and export

Only explicit save/copy/download actions reach host authority. Routine VS Code changes use a guarded source range and expected-text precondition; a mismatch produces a visible full-document fallback. JavaScript links remain rejected by export paths. Clean export removes bridge code, tokens, temporary IDs, pick-through/lock/hide markers, editing attributes, and restored author CSP/scripts.

## Residual risks

- Trusted author scripts can consume CPU/network and alter their own preview DOM.
- External assets remain subject to their server's availability, CORS, and policy.
- Browser mode cannot make local relative assets available without a user-granted file/directory authority.
- Arbitrary HTML and CSS may expose browser-engine rendering differences; the compatibility and release matrices detect but cannot eliminate them.
