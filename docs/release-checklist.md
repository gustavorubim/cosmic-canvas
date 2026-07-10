# Release checklist

## Build once

- [ ] Start from a clean checkout and record `git rev-parse HEAD`.
- [x] Run `npm ci` and `npm run verify:release`.
- [x] Run `npm run vsix:release` and `npm run verify:package -- --require-vsix`.
- [x] Record the `.vsix.sha256` output. Do not rebuild for another machine.

## Exact-artifact matrix

| Environment | VS Code | Network | VSIX SHA-256 | Open/ready | Edit/save/reopen | Relative assets | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Primary Windows development machine | Stable | Normal | pending candidate | automated pass | automated pass | automated fixture | pass |
| Clean Windows profile / second machine | Stable | Normal |  |  |  |  | pending |
| macOS or Linux machine/VM | Stable | Normal |  |  |  |  | pending |
| Restricted/offline environment | Stable | Restricted |  |  |  |  | pending |
| Minimum supported host | 1.90 | Normal |  | CI matrix | CI matrix | CI fixture | pending CI |

Record environment facts and outcomes only. Never collect document contents.

### Local `0.1.4` candidate evidence (2026-07-10)

Exact candidate: `cosmic-canvas-0.1.4.vsix`  
SHA-256: `2bb6fd080c4fa2b521018b7773ff32e115d27b09823ef47daa38a9135fba4a33`

| Environment | VS Code | Network | Open/edit/save/reopen | Recursive relative assets | Result |
| --- | --- | --- | --- | --- | --- |
| Primary Windows isolated install profile | Stable 1.128.0 | Normal | pass | pass | pass |
| Primary Windows test host | Minimum 1.90.0 | Normal | pass | pass | pass |
| Primary Windows test host | Stable 1.128.0 | Blocking proxy (`127.0.0.1:9`) | pass | pass | pass |
| Physical clean Windows profile / second machine | Stable | Normal | pending | pending | pending |
| macOS or Linux machine/VM | Stable | Normal | pending | pending | pending |

The exact candidate was installed into isolated user-data/extensions directories for the stable row and extracted without rebuilding for the minimum/offline rows. It was not rebuilt between any row.

## Manual usability and accessibility smoke

| Check | Expected |
| --- | --- |
| Keyboard-only selection/edit/Escape/save/undo | Focus remains visible; Escape exits edit then selection; one undo reverts one typing burst |
| Navigator and Outline names/current state | Screen reader exposes Pages, current page, full outline, and selected row |
| 200% zoom and narrow editor group | collapsed source/navigator affordances remain reachable; canvas is not covered |
| Light, dark, high-contrast themes | controls and focus indicators remain distinguishable |
| Mouse/trackpad selection and Alt-click | leaf selects once; Alt-click climbs ancestors deterministically |
| Reorder and resize | operation is undoable and clean export has no editor metadata |

## Rollback

If any required environment fails, stop distribution, preserve the failing diagnostics and performance report, and reinstall the previous GitHub release whose SHA-256 is already recorded. Publish a rollback note with the affected version, environment, and failed verifier. Keep both the candidate and previous stable artifacts available until the replacement release passes the same matrix.
