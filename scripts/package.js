/**
 * @file scripts/package.js
 * @description Zips dist/ into release/eyeflow-v<version>.zip for the Chrome Web Store.
 *
 * Run through `npm run package`, which builds first. The archive is written with
 * Node's own zlib so entry paths always use forward slashes, whatever the OS.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function listFiles(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath, relativePath) : [relativePath];
    });
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const relativePath of files) {
    const data = fs.readFileSync(path.join(DIST_DIR, relativePath));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(relativePath, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // Local file header signature
    local.writeUInt16LE(20, 4); // Version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(0, 10); // Time
    local.writeUInt16LE(0x21, 12); // Date: 1980-01-01, keeps builds reproducible
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // Central directory signature
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function main() {
  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('dist/manifest.json not found. Run "npm run build" first.');
  }

  const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = listFiles(DIST_DIR);
  const outputPath = path.join(RELEASE_DIR, `eyeflow-v${version}.zip`);

  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.writeFileSync(outputPath, buildZip(files));

  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(
    `Packaged ${files.length} files into ${path.relative(ROOT, outputPath)} (${sizeKb} KB)`
  );
}

main();
