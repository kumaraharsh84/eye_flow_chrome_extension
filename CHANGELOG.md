# Changelog - EyeFlow

All notable changes to this project are documented here.

## [1.0.0] - 2026-04

### First public release candidate

#### Core product

- Doom-scroll detection across major short-form surfaces including YouTube Shorts, Instagram, Reddit, X, Facebook, Snapchat Spotlight, LinkedIn video surfaces, and selected Twitch clips surfaces.
- Fullscreen guided eye-break overlay with moving-point exercise and countdown.
- Post-break recovery flow with mood feedback and simplified next-step actions.
- Global gentle reminder timer for normal non-DS browsing.
- Global hydration reminder flow.

#### Timer and behavior system

- Shared DS timing across relevant doom-scroll contexts.
- Active-tab-only DS time counting for popup stats.
- Better pause and resume handling for idle states, snooze, DS contexts, and overlay states.
- Safer post-break reset behavior so the next DS cycle starts only after the user dismisses the final post-break screen.
- Better handling after laptop sleep, inactivity, and reopen scenarios.

#### Popup and onboarding

- Onboarding presets for Strict, Balanced, and Gentle modes.
- Cleaner popup layout with collapsible Work Mode section.
- New `Top DS Sites Today` stats view based on committed active DS time.
- Removed cluttered older stats blocks and non-essential popup sections for this release.

#### UX and copy polish

- Improved eye-break overlay sizing for large and smaller tabs.
- Improved hydration overlay fit so action buttons remain visible and clickable.
- Calmer overlay and reminder copy.
- Cleaner testing trust cue and stats empty state in the popup.

#### Automation and QA

- Puppeteer-based smoke and E2E test coverage for popup, onboarding, and supported site behavior.
- HTML test reporting for automated runs.
- Detailed manual QA checklist and short final release test pass guide added to the repo.

## Planned - Next Update

- More timer-state simplification and internal cleanup.
- More site-specific rule tuning based on real user feedback.
- More popup and overlay visual polish after release feedback.
- Optional return of break suggestions in a cleaner design.

## Planned - Future

- Richer weekly insights and habit summaries.
- Better export or reporting options for personal stats.
- Possible cross-device or account-linked experience if the product grows beyond the extension.
