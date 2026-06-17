const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = path.join(__dirname, 'src');

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Copy static assets
function copyAssets() {
  console.log('Copying static assets...');

  // Files to copy directly
  const staticFiles = [
    'manifest.json',
    'popup.html',
    'popup.css',
    'onboarding.html',
    'onboarding.css',
    'overlay.css',
    'offscreen.html',
  ];

  staticFiles.forEach((file) => {
    const src = path.join(SRC_DIR, file);
    const dest = path.join(DIST_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  });

  // Copy icons folder
  const iconsSrc = path.join(SRC_DIR, 'icons');
  const iconsDest = path.join(DIST_DIR, 'icons');
  if (fs.existsSync(iconsSrc)) {
    if (!fs.existsSync(iconsDest)) {
      fs.mkdirSync(iconsDest, { recursive: true });
    }
    fs.readdirSync(iconsSrc).forEach((file) => {
      fs.copyFileSync(path.join(iconsSrc, file), path.join(iconsDest, file));
    });
  }
}

async function build() {
  copyAssets();

  const ctx = await esbuild.context({
    entryPoints: [
      path.join(SRC_DIR, 'background.js'),
      path.join(SRC_DIR, 'content.js'),
      path.join(SRC_DIR, 'popup.js'),
      path.join(SRC_DIR, 'onboarding.js'),
      path.join(SRC_DIR, 'offscreen.js'),
    ],
    bundle: true,
    outdir: DIST_DIR,
    target: ['es2020'],
    format: 'iife', // Immediately invoked function expression is standard for content scripts
    logLevel: 'info',
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete.');
  }
}

build().catch(() => process.exit(1));
