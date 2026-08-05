/**
 * @file build.js
 * @description Build pipeline for packaging the Manifest V3 extension into dist/.
 *
 * @purpose
 * This Node.js script copies static extension assets and uses esbuild to bundle
 * JavaScript entry points into browser-loadable files. Chrome loads files from
 * dist/ during local testing and store packaging, so this script is the bridge
 * between readable source modules and the final extension artifact.
 *
 * @responsibilities
 *   - Copy manifest, HTML, CSS, and icon assets into dist/.
 *   - Bundle background, content, popup, onboarding, and offscreen scripts.
 *   - Support watch mode for iterative local development.
 *
 * @dependents
 *   - package.json scripts: build, watch, pretest, and pretest:extension.
 *   - Puppeteer tests load the generated dist/ extension.
 */
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
    // esbuild bundles ES module source into IIFEs because extension pages and
    // content scripts are loaded as plain browser scripts from dist/. Keeping
    // the source modular while emitting IIFEs preserves developer ergonomics
    // without requiring Chrome to resolve source-time imports at runtime.
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
