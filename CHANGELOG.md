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

- **Continuous Gentle Reminders**: Refactored gentle reminders to run as a global continuous countdown, removing focus/idle pausing rules so that it doesn't get stuck on Hold.
- **Keyboard Commands**: Added extension commands shortcut support, mapping `Ctrl+Shift+E` (Mac: `Command+Shift+E`) to immediately trigger an eye-break session.
- **JSON Data Export**: Added an "Export stats as JSON" button in the popup stats card to allow downloading all local tracking data.
- **Timer Sticking at 00:00**: Resolved the issue where timers would get stuck at 00:00 after completing an eye-break session by re-anchoring the sync state timestamps when resetting.
- **Site Navigation Improvements**: Added re-anchoring when navigating back into a doom-scroll surface (e.g., from LinkedIn messaging/jobs back to the feed, or Twitter likes back to the home feed) to prevent phantom elapsed time calculations.
- **Facebook Home Feed**: Eliminated DOM-dependent checks for `facebook.com/` to immediately classify it as a strong DS surface, preventing race conditions with page loading.
- **Snapchat Spotlight**: Updated Snapchat Spotlight clip URLs (`/spotlight/*`) to classify as strong DS feeds rather than single-post grace windows.
- **X/Twitter Likes & Media**: Reclassified Likes (`/:username/likes`) and Media (`/:username/media`) tabs on Twitter profile pages as strong DS surfaces.
- **UI & Exercise Cleanups**: Cleaned up the eye-break exercise overlay to remove hardcoded titles/subtitles, displaying the active tracking circle immediately. Simplified post-break screens, removing verbose subtitles and footers, and changed emoji mood buttons to clear text labels (Good/Okay/Strained).

#### Security & Privacy Hardening

- **Narrowed Host Permissions**: Restricted background host permissions in `manifest.json` from broad wildcard scopes to only the core social networks and webhook reporting endpoints.
- **XSS Prevention**: Migrated all dynamic HTML element rendering (including redirect suggestion lists, top site stats cards, and gentle reminder notifications) from `innerHTML` to safe `textContent` / DOM creation APIs.
- **Data Protection**: Stripped webhook URLs from settings payloads sent from the background service worker to tab content scripts to prevent exposure.
- **Input Length Capping**: Enforced a 120-character input limit on redirect suggestions in the settings popup to block storage bloating.
- **Incognito Privacy**: Switched the extension manifest to use `"split"` mode instead of `"spanning"`, creating clean, separated runtimes for private tabs.

#### Codebase Refactoring & Reliability

- **Centralized Constants**: Extracted shared configuration limits (`TIMER_LIMITS`) and duplicate guards (`GENTLE_REMINDER_DUPLICATE_GUARD_MS`) into a single source of truth at `src/utils.js`.
- **Storage Write Error Handling**: Created a `safeStorageSet()` helper in `background.js` to catch and log errors for all local Chrome storage write operations.
- **Dead Code Cleanup**: Deleted the unused, legacy 5.8KB `src/site-rules.js` file, removed stale load-time `const now` in `src/content.js`, deleted redundant failsafe routines, and removed unused debug logging flags.

#### Removed

- **Admin PIN Lock feature**: Removed the toggle-off PIN modal — the hardcoded default PIN (`1234`) was a security anti-pattern and the feature added complexity without protecting against anything.

## [1.0.2] - 2026-11

### Store-readiness release: bug fixes, cleanup, and efficiency

#### Fixed

- **Sensitivity slider did nothing**: the break timer now scales with sensitivity (100% halves the interval, 0% stretches it by half, never below 2 minutes).
- **Water reminders could stop forever**: a water prompt queued for the next eye break stayed queued if that break never came or the prompt was ignored. It now expires and is asked again.
- **A water break reset the eye-break timer**: closing the water overlay was treated as closing an eye break. The two flows are now separate.
- **Phantom doom-scroll time**: a tab that crashed, slept or navigated away could leave the shared timer running. Time is now credited only for continuous heartbeats.
- **Closing the feed tab did not always reset the cycle**, and the first timer tick after install could zero the "today" counters.
- **Weekly report was skipped** if Chrome was not open on a Monday, and the next one then covered two weeks. It now goes out on the first day of use in a new week. "Send Test Report" reports the real result instead of always saying "Sent!".
- **snapchat.com home and sign-in page counted as a feed** and could trigger a break during login.
- **Time was credited to the wrong site** when leaving a feed just before the minute was reported.
- **Gentle reminders never showed on some normal sites** because keyword checks matched inside words ("pinterest" contains "test"). Checks are now label-based.
- **The page could still be scrolled behind a break** with the wheel or keyboard. Input is now held by the overlay, with a focus trap for keyboard users.
- **Concurrent updates could be lost**: stats were written from both pages and the service worker. All writes now go through one queue in the service worker.
- The popup version badge was hard-coded, several popup buttons had no styling, and the onboarding summary could show values that were not what was saved.

#### Added

- Popup toggles for **Gentle reminders** and **Background chime**. Both settings existed but had no way to be changed.
- Water break buttons now read "Already drank water" and "Remind me soon"; the break countdown pauses while the tab is hidden.
- Removal PIN lockout: five wrong attempts lock webhook removal for five minutes.
- `npm run package` builds the Chrome Web Store zip; CI now lints, tests and uploads the package.

#### Privacy and store compliance

- **Removed the Google Fonts import that was injected into every website** through the content-script stylesheet, and from the popup and onboarding. No remote resources are loaded any more.
- **Injected CSS no longer leaks into pages**: generic `:root` variables (`--bg`, `--text`, ...) and keyframe names are scoped to EyeFlow's own elements.
- Dropped the `tabs` permission and the `http://` optional host permission. Webhooks must be https.
- Stopped writing every page load of every site into the debug log.
- Manifest description shortened to fit the 132-character store limit; `minimum_chrome_version` set to 116.
- Settings-changing messages are accepted only from the extension's own pages; unknown settings keys are dropped; the PIN hash is never sent to the popup.
- Overlay is built with DOM APIs instead of `innerHTML`.
- Privacy policy now describes the weekly report and why the extension runs on all sites.

#### Efficiency

- On sites outside the tracked list the content script runs no timers, adds one key listener, and sends nothing on page load. Previously every tab on every site messaged the service worker every 2 seconds, each causing a storage read and write.
- Tracked tabs send a heartbeat only while actively doom scrolling, plus one message when that stops. One bootstrap message replaces three on page load.
- Storage is written only when a value actually changed.
- Source JavaScript went from about 7,600 lines to about 4,000.

#### Removed (dead code)

- `src/intelligence.js` (scroll-density and staged-interruption logic that was no longer called), the unused warning banner, the debug timer HUD, the per-tab hydration timer that duplicated the global one, unused message handlers, the `siteTiers` and `customTimingEnabled` settings, and the unused Strict/Gentle onboarding presets.

## Planned - Future

- Richer weekly insights and habit summaries.
- Better export or reporting options for personal stats.
- Possible cross-device or account-linked experience if the product grows beyond the extension.
