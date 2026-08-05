# Implementation Plan — Weekly Report Enhancements & Strict Hydration Enforcement

We will add **Compliance Rate (%)**, **Peak Risk Windows**, and **Hydration Counts** to the weekly monitor reports, and enforce full countdowns for Hydration Breaks on strict sites (hiding early dismissal buttons).

---

## Proposed Changes

### 1. Stats & Webhook Enhancements (`src/background.js`)

- **Track Hydration Breaks**: Add `todayHydrationBreaksCompleted` and `weekHydrationBreaksCompleted` to `DEFAULT_STATS`.
- **Update `HYDRATION_COMPLETED` Message Handler**: Increment hydration statistics when a user finishes a water break.
- **Enhance `sendWeeklyReport`**:
  - Calculate **Compliance Rate**: `(weekEyeBreaksCompleted / weekDoomScrollsBlocked * 100).toFixed(1)%`.
  - Calculate **Peak Scrolling Window**: Call `analyzePatterns(stats.doomScrollSessions)` and include the top risk time (e.g., `Sunday around 10 PM`).
  - Include **Hydration Summary**: `Water Breaks Taken: X times`.

---

### 2. Strict Hydration Overlay (`src/overlay.js` & `src/content.js`)

- **Pass Strict Flag to Hydration**: Update `buildHydrationHTML(duration, isStrict)` in `src/overlay.js`.
- **Hide Action Buttons on Strict Sites**:
  - If `isStrict` is true, add `eyeflow-strict` class to the card and hide the `.eyeflow-hydration-actions` buttons (`Yes, just had some` and `Not right now`).
  - The user must wait out the countdown timer to finish the water break, exactly like an eye break.

---

## Verification Plan

### Automated Tests

- Run `npm run build` to verify ESBuild compilation succeeds.
- Run `npm test` and `npm run test:e2e` to verify unit and Puppeteer E2E tests pass.

### Manual Verification

- Test sending a webhook report from the popup and check that Compliance %, Peak Scrolling Window, and Water Breaks Taken are included.
- Load a strict site (like YouTube Shorts or Instagram Reels) and trigger a hydration break to verify early dismissal buttons are hidden.
