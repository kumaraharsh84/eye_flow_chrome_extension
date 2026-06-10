# EyeFlow

EyeFlow is a Chrome extension that helps reduce doom scrolling and eye strain.

It watches for high-risk scrolling behavior on doom-scroll surfaces such as YouTube Shorts, Instagram Reels, Reddit feeds, Facebook, and X, then responds with:

- gentle reminders during normal browsing
- full eye-break overlays during doom-scrolling
- hydration nudges over longer sessions

The goal is to interrupt unhealthy loops without becoming annoying during normal work, chat, forms, login pages, or other sensitive contexts.

## Features

- Doom-scroll detection for high-risk surfaces such as Shorts, Reels, and feed-heavy pages.
- Fullscreen guided eye-break overlay with moving-dot exercise and countdown.
- Post-break recovery flow with mood logging and next-step suggestions.
- Global gentle reminder timer across non-DS tabs.
- Global hydration reminder flow.
- Popup controls for timing, snooze, sensitivity, and suggestions.
- Onboarding presets for Strict, Balanced, and Gentle modes.
- Puppeteer-based automation plus a manual QA checklist for final testing.

## What The Extension Does

- Detects doom-scroll contexts on supported sites.
- Tracks shared doom-scroll timing across relevant tabs.
- Shows fullscreen eye-break exercises with a moving dot and countdown.
- Shows a post-break recovery screen with mood logging and next-step suggestions.
- Runs a global gentle reminder timer across non-DS tabs.
- Runs a global hydration reminder flow.
- Lets the user control timings, snooze, sensitivity, and suggestions from the popup.

## Current Reminder Model

### Eye Break

- Eye-break timing is tied to DS surfaces.
- The DS timer is shared across relevant doom-scroll tabs.
- The next DS cycle should only restart after the full post-break flow is dismissed.

### Gentle Reminder

- Gentle reminder is a global timer across normal non-DS tabs.
- It pauses only when:
  - a DS surface is active
  - snooze is active
  - the extension is disabled
- After a gentle reminder is shown, the timer resets immediately to a fresh cycle.

### Water Reminder

- Water reminder is global.
- It runs independently from the gentle reminder.

## Architecture

```text
Chrome Tab / Website
  |
  +-- content.js
  |     - detects DS vs non-DS context
  |     - tracks page activity
  |     - renders warnings, gentle reminders, and debug chip
  |
  +-- overlay.js + overlay.css
  |     - fullscreen eye-break UI
  |     - hydration UI
  |     - post-break recovery flow
  |
  +-- intelligence.js + site-rules.js
        - behavior heuristics
        - per-site context rules

background.js
  - global scheduler
  - shared DS timing
  - global gentle reminder timing
  - hydration timing
  - stats, storage, alarms, snooze

popup.html / popup.js / popup.css
  - settings UI
  - stats and insights UI

onboarding.html / onboarding.js / onboarding.css
  - first-run setup flow
```

## Main Files

### Core Runtime

- `manifest.json`: Chrome extension manifest
- `background.js`: global scheduler, storage, alarms, shared timers
- `content.js`: page detection, per-tab behavior, reminder rendering triggers
- `overlay.js`: fullscreen eye-break and post-break UI behavior
- `overlay.css`: overlay styles
- `intelligence.js`: detection and behavior heuristics
- `site-rules.js`: per-site and per-surface logic

### Popup

- `popup.html`
- `popup.js`
- `popup.css`

The popup lets the user:

- enable or disable EyeFlow
- snooze reminders
- adjust sensitivity
- adjust eye-break timing
- adjust gentle reminder timing
- adjust hydration timing
- manage redirect suggestions
- view stats and pattern insights

### Onboarding

- `onboarding.html`
- `onboarding.js`
- `onboarding.css`

Onboarding offers preset modes:

- Strict
- Balanced
- Gentle

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions/`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder:

```text
eyeflow chorme extension
```

6. Pin the EyeFlow icon to the toolbar for easier testing.

## Testing

### Automated Testing

Puppeteer-based test automation is included.

Files:

- `tests/puppeteer-extension-smoke.js`
- `tests/puppeteer-extension-e2e.js`

Available commands from `package.json`:

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:onboarding
npm.cmd run test:popup
npm.cmd run test:sites
npm.cmd run test:online
```

### HTML Test Report

Each E2E run writes a report to:

- `tests/artifacts/eyeflow-test-report.html`

### What Is Already Automated

- onboarding preset save flow
- popup enable and disable
- popup snooze and resume
- advanced settings save and validation
- redirect suggestion add and remove persistence
- content-script presence checks on live sites
- gentle reminder render checks

### Manual QA

Manual testing guide:

- `docs/internal/MANUAL_ONLY_REMAINING_CHECKLIST.md`

Manual testing still covers:

- fresh install trigger behavior
- real doom-scroll timing in natural use
- full eye-break recovery UX
- hydration flow
- stats and insights after real usage
- multi-tab and restart behavior
- audio behavior
- final visual polish and release feel

## Debug Timer Chip

The debug timer chip is development-only and is disabled by default in production-like builds.
It is included for internal testing and troubleshooting during development,
but it does not appear in normal user-facing installations.

## Recent Fixes And Improvements

Recent work on the project includes:

- fixed DS eye-break cycle restarting too early while post-break UI was still open
- improved DS reset behavior after laptop sleep or long inactivity
- improved overlay and post-break sizing for large tabs
- removed the internal scroll problem from the main eye-break overlay on desktop
- simplified the gentle scheduler toward one global loop across non-DS tabs
- improved debug chip clarity for testing cross-tab timer behavior
- added Puppeteer automation and HTML test reporting

## Known Issues / In-Progress Work

- Gentle reminder behavior is still being tuned to make the global non-DS timer fully predictable across tab switching and media-heavy normal tabs.
- Water reminder flow exists, but it still needs final real-world QA coverage in longer sessions.
- Some site-specific detection rules may still need fine-tuning for edge cases such as chat pages, profile pages, or mixed-content surfaces.
- Overlay and post-break UI have been improved recently, but final visual polish is still in progress.
- Debug timer chip is development-only and is disabled by default in production-like builds.
- Project cleanup is still pending for backup and release-support folders such as `archive/` and `release/`.

## Project Structure Notes

Likely active or required:

- `icons`
- `tests`
- `node_modules`

Mostly backup, docs, or release support:

- `archive`
- `release`
- `.sixth`

## Current Status

The project is in a strong test-and-polish phase.

It already has:

- working extension runtime
- popup and onboarding
- shared timer logic
- fullscreen overlay flow
- automation for key flows
- a manual QA guide

The main remaining work is final QA, polish, cleanup, and release confidence.
