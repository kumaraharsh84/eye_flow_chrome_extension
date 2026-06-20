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

## [1.0.1] - 2026-06

### Bug Fixes, Security Hardening, & Refactoring Release

This release focuses on manual QA feedback, security hardening, privacy enhancements, and codebase refactoring.

#### Bug Fixes & UX Polish

- **Gentle Reminder Inactivity Pause**: Fixed the gentle reminder timer failing to pause during idle states. It now pauses after 2 minutes of inactivity and resumes immediately upon user input.
- **Timer Sticking at 00:00**: Resolved the issue where timers would get stuck at 00:00 after completing an eye-break session by re-anchoring the sync state timestamps when resetting.
- **Site Navigation Improvements**: Added re-anchoring when navigating back into a doom-scroll surface (e.g., from LinkedIn messaging/jobs back to the feed, or Twitter likes back to the home feed) to prevent phantom elapsed time calculations.
- **Facebook Home Feed**: Eliminated DOM-dependent checks for `facebook.com/` to immediately classify it as a strong DS surface, preventing race conditions with page loading.
- **Snapchat Spotlight**: Updated Snapchat Spotlight clip URLs (`/spotlight/*`) to classify as strong DS feeds rather than single-post grace windows.
- **X/Twitter Likes & Media**: Reclassified Likes (`/:username/likes`) and Media (`/:username/media`) tabs on Twitter profile pages as strong DS surfaces.
- **UI & Exercise Cleanups**: Cleaned up the eye-break exercise overlay to remove hardcoded titles/subtitles, displaying the active tracking circle immediately. Simplified post-break screens, removing verbose subtitles and footers, and changed emoji mood buttons to clear text labels (Good/Okay/Strained).

#### Security & Privacy Hardening

- **XSS Prevention**: Migrated all dynamic HTML element rendering (including redirect suggestion lists, top site stats cards, and gentle reminder notifications) from `innerHTML` to safe `textContent` / DOM creation APIs.
- **Data Protection**: Stripped webhook URLs from settings payloads sent from the background service worker to tab content scripts to prevent exposure.
- **Input Length Capping**: Enforced a 120-character input limit on redirect suggestions in the settings popup to block storage bloating.
- **Incognito Privacy**: Switched the extension manifest to use `"split"` mode instead of `"spanning"`, creating clean, separated runtimes for private tabs.

#### Codebase Refactoring & Reliability

- **Centralized Constants**: Extracted shared configuration limits (`TIMER_LIMITS`) and duplicate guards (`GENTLE_REMINDER_DUPLICATE_GUARD_MS`) into a single source of truth at `src/utils.js`.
- **Storage Write Error Handling**: Created a `safeStorageSet()` helper in `background.js` to catch and log errors for all local Chrome storage write operations.
- **Dead Code Cleanup**: Deleted the unused, legacy 5.8KB `src/site-rules.js` file, removed stale load-time `const now` in `src/content.js`, deleted redundant failsafe routines, and removed unused debug logging flags.

## Planned - Future

- Richer weekly insights and habit summaries.
- Better export or reporting options for personal stats.
- Possible cross-device or account-linked experience if the product grows beyond the extension.
