# Changelog — EyeFlow

All notable changes to this project are documented here.
Format: [Version] — Date — What changed

---

## [1.0.0] — 2025

### First public release

#### Core features
- Doom-scroll detection on Instagram, YouTube Shorts, Reddit, X, Facebook, TikTok
- Fullscreen eye-break overlay with animated 6-step guided exercise
- Gradual interruption system: nudge → warning banner → full break
- Gentle corner reminder for normal browsing sites
- Hydration reminder (default: every 2 hours)
- Post-break experience: mood check, time-on-site alert, redirect suggestions

#### Smart detection
- Context-aware: Instagram home = strong DS, Instagram DMs = gentle only
- YouTube Shorts = strong DS, YouTube long video = gentle/passive
- Chat and live contexts suppressed (no interruptions during calls)
- Idle detection: no false triggers when user walks away
- Tab switch pause/resume: timer pauses when tab is not active
- Long video passive watching support: not marked idle if video is playing

#### Settings
- Fixed Time mode vs Surprise Mode (random interval range)
- Sensitivity slider (0–100%)
- Custom timing for: eye break interval, gentle reminder interval, water reminder
- Eye break duration (15–40 seconds)
- Work mode snooze: 1h / 2h / 4h — pauses gentle reminders only
- Strict DS protection continues during snooze
- Dark / light theme

#### Stats dashboard (popup)
- Doom scrolls blocked today + this week
- Eye breaks completed today + this week
- Average mood after breaks
- Pattern insights (after 7+ sessions)

#### Onboarding
- 3-screen first-run experience
- Mode selection: Strict / Balanced / Gentle

---

## Planned — v1.1

- Weekly "your story" insight screen
- Firefox support improvements
- Snapchat detection refinement
- Export stats as CSV

## Planned — v2.0

- EyeFlow website integration (shared login, unified dashboard)
- Cross-device streak sync
