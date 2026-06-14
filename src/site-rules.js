// RESERVED FOR V2 REFACTOR — not imported anywhere intentionally
// ============================================================
// SITE-RULES.JS — EyeFlow Site Detection Config
// ============================================================
// These rules centralize the per-site context logic that used to be
// spread across content.js. Update this file when adding or changing
// the site-specific doom-scroll behavior.
//
// STRUCTURE:
//   SITE_RULES = {
//     'hostname': {
//       strongDS:  [path prefixes]  → fullscreen eye break trigger
//       gentle:    [path prefixes]  → gentle reminder only
//       suppress:  [path prefixes]  → suppress reminders entirely
//     }
//   }
// ============================================================

const SITE_RULES = {

  // -------------------------------------------------------
  // INSTAGRAM
  // Strong DS: Home feed, Explore, Reels
  // Gentle:    Direct messages, single posts
  // Suppress:  Live streams, video calls
  // -------------------------------------------------------
  'instagram.com': {
    strongDS: ['/', '/explore', '/reels'],
    gentle:   ['/p/'],
    suppress: ['/live', '/video/call', '/ar/', '/direct']
  },

  // -------------------------------------------------------
  // YOUTUBE
  // Strong DS: Shorts (infinite vertical scroll)
  // Gentle:    Normal long videos (user is watching, not scrolling)
  // Suppress:  Live chat, community (typing context)
  // -------------------------------------------------------
  'youtube.com': {
    strongDS: ['/shorts'],
    gentle:   ['/watch'],
    suppress: ['/live_chat', '/channel/community']
  },

  // -------------------------------------------------------
  // REDDIT
  // Strong DS: Home feed, Popular, Community feeds
  // Gentle:    Single post + comments
  // Suppress:  Notifications, settings
  // -------------------------------------------------------
  'reddit.com': {
    strongDS: ['/', '/r/', '/hot', '/new', '/top', '/rising'],
    gentle:   ['/comments/'],
    suppress: ['/notifications', '/settings', '/message', '/chat']
  },

  // -------------------------------------------------------
  // X (formerly Twitter)
  // Strong DS: Home, Explore, Communities
  // Gentle:    Single tweet/status, notifications
  // Suppress:  Direct messages, mentions panel
  // -------------------------------------------------------
  'x.com': {
    strongDS: ['/home', '/explore', '/i/communities'],
    gentle:   ['/status/', '/notifications'],
    suppress: ['/messages', '/i/mentions']
  },
  'twitter.com': {
    strongDS: ['/home', '/explore'],
    gentle:   ['/status/', '/notifications'],
    suppress: ['/messages']
  },

  // -------------------------------------------------------
  // FACEBOOK
  // Strong DS: Home feed, Watch, Groups feed, Pages feed
  // Gentle:    Notifications, friends list
  // Suppress:  Messenger, marketplace checkout
  // -------------------------------------------------------
  'facebook.com': {
    strongDS: ['/', '/watch', '/groups', '/pages'],
    gentle:   ['/notifications', '/friends'],
    suppress: ['/messages', '/marketplace/checkout']
  },

  // -------------------------------------------------------
  // TIKTOK
  // Strong DS: Everything (it's ALL infinite scroll)
  // Gentle:    (none — TikTok is always doom scroll context)
  // Suppress:  DMs
  // -------------------------------------------------------
  'tiktok.com': {
    strongDS: ['/'],
    gentle:   [],
    suppress: ['/messages']
  },

  // -------------------------------------------------------
  // SNAPCHAT
  // Gentle only (not strong DS — stories are less addictive than feeds)
  // -------------------------------------------------------
  'snapchat.com': {
    strongDS: [],
    gentle:   ['/'],
    suppress: ['/chat']
  }
};

// -------------------------------------------------------
// HELPER: Get the context type for a given URL
// Returns: 'strongDS' | 'gentle' | 'suppress' | 'normal'
// -------------------------------------------------------
// Usage: const ctx = getSiteContext('instagram.com', '/reels/');
//        → returns 'strongDS'
function getSiteContext(hostname, pathname) {
  // Strip www/m prefix for consistent matching
  const cleanHost = hostname.replace(/^(www|m)\./, '');
  const rules = SITE_RULES[cleanHost];

  // Site not in our rules — treat as normal browsing
  if (!rules) return 'normal';

  const path = pathname || '/';

  // Check suppress first (highest priority — never interrupt these)
  for (const prefix of rules.suppress) {
    if (path.startsWith(prefix)) return 'suppress';
  }

  // Check strongDS
  for (const prefix of rules.strongDS) {
    if (path === prefix || path.startsWith(prefix)) return 'strongDS';
  }

  // Check gentle
  for (const prefix of rules.gentle) {
    if (path.startsWith(prefix)) return 'gentle';
  }

  // Site is in our list but this path doesn't match any rule
  // Default: gentle (don't be too aggressive on unknown paths)
  return 'gentle';
}

// -------------------------------------------------------
// HELPER: Is this a doom scroll surface?
// -------------------------------------------------------
function isDoomScrollSurface(hostname, pathname) {
  return getSiteContext(hostname, pathname) === 'strongDS';
}

// -------------------------------------------------------
// HELPER: Should we suppress all reminders here?
// -------------------------------------------------------
function isSuppressedSurface(hostname, pathname) {
  return getSiteContext(hostname, pathname) === 'suppress';
}

// -------------------------------------------------------
// HELPER: Is this a tracked site at all?
// -------------------------------------------------------
function isTrackedSite(hostname) {
  const cleanHost = hostname.replace(/^(www|m)\./, '');
  return cleanHost in SITE_RULES;
}
