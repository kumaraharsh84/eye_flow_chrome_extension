/**
 * @file build.js
 * @description Builds the loadable extension into dist/.
 *
 * Source files are ES modules; Chrome loads the bundled IIFE files from dist/.
 * dist/ is wiped first so nothing stale ever ships in a store package.
 *
 *   node build.js            one-off build (minified)
 *   node build.js --watch    rebuild on change (unminified, for debugging)
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');

const STATIC_FILES = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'onboarding.html',
  'onboarding.css',
  'overlay.css',
  'offscreen.html',
];
const ENTRY_POINTS = ['background.js', 'content.js', 'popup.js', 'onboarding.js', 'offscreen.js'];

function copyAssets() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'icons'), { recursive: true });

  for (const file of STATIC_FILES) {
    fs.copyFileSync(path.join(SRC_DIR, file), path.join(DIST_DIR, file));
  }

  // Only the icons themselves ship; helper files in src/icons stay out of the package.
  for (const file of fs.readdirSync(path.join(SRC_DIR, 'icons'))) {
    if (file.endsWith('.png')) {
      fs.copyFileSync(path.join(SRC_DIR, 'icons', file), path.join(DIST_DIR, 'icons', file));
    }
  }
}

async function build() {
  copyAssets();

  const context = await esbuild.context({
    entryPoints: ENTRY_POINTS.map((file) => path.join(SRC_DIR, file)),
    bundle: true,
    outdir: DIST_DIR,
    target: ['chrome116'],
    format: 'iife',
    // Whitespace and syntax only: identifiers stay readable for store review.
    minifyWhitespace: !isWatch,
    minifySyntax: !isWatch,
    legalComments: 'none',
    logLevel: 'info',
  });

  if (isWatch) {
    await context.watch();
    console.log('Watching for changes...');
  } else {
    await context.rebuild();
    await context.dispose();
    console.log('Build complete.');
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
