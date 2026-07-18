import {
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\n\u274c  ${msg}\n`);
  process.exit(1);
}

function mtimeMs(filePath) {
  return statSync(filePath).mtimeMs;
}

/** Recursively collect .ts files under dir. */
function collectTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTs(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load manifests
// ---------------------------------------------------------------------------

const manifestPath    = path.join(projectRoot, 'manifest.json');
const packageJsonPath = path.join(projectRoot, 'package.json');
const versionsPath    = path.join(projectRoot, 'versions.json');
const mainJsPath      = path.join(projectRoot, 'main.js');
const stylesPath      = path.join(projectRoot, 'styles.css');

const manifest    = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const versions    = JSON.parse(readFileSync(versionsPath, 'utf8'));

const pluginVersion = manifest.version;

// ---------------------------------------------------------------------------
// Check 1: version consistency
// ---------------------------------------------------------------------------

if (packageJson.version !== pluginVersion) {
  fail(
    `Version mismatch: manifest.json="${pluginVersion}" vs ` +
    `package.json="${packageJson.version}". Update package.json to match.`
  );
}

if (!(pluginVersion in versions)) {
  fail(
    `versions.json is missing an entry for "${pluginVersion}". ` +
    `Add "\"${pluginVersion}\": \"<minAppVersion>\"" to versions.json.`
  );
}

console.log(`\u2713  Version consistency: all files agree on ${pluginVersion}`);

// ---------------------------------------------------------------------------
// Check 2: artifact freshness
// ---------------------------------------------------------------------------

if (!existsSync(mainJsPath)) {
  fail(`main.js not found. Run "npm run build" first.`);
}

const artifactMtime = mtimeMs(mainJsPath);

const sourceFiles = [
  path.join(projectRoot, 'main.ts'),
  ...collectTs(path.join(projectRoot, 'src')),
];

const stale = sourceFiles.find(src => existsSync(src) && mtimeMs(src) > artifactMtime);
if (stale) {
  fail(
    `main.js is older than "${path.relative(projectRoot, stale)}". ` +
    `Run "npm run build" to produce a fresh artifact before releasing.`
  );
}

console.log(`\u2713  Artifact freshness: main.js is up-to-date`);

// ---------------------------------------------------------------------------
// Prepare release folder
// ---------------------------------------------------------------------------

const releaseRoot = path.join(projectRoot, 'release');
const pluginDir   = path.join(releaseRoot, manifest.id);

rmSync(pluginDir, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

const filesToInclude = [
  { name: 'manifest.json', src: manifestPath },
  { name: 'main.js',       src: mainJsPath   },
];

if (existsSync(stylesPath)) {
  filesToInclude.push({ name: 'styles.css', src: stylesPath });
}

for (const { name, src } of filesToInclude) {
  copyFileSync(src, path.join(pluginDir, name));
}

console.log(`\u2713  Release folder prepared at ${path.relative(projectRoot, pluginDir)}`);

// ---------------------------------------------------------------------------
// Check 3: produce a release zip
// ---------------------------------------------------------------------------

const zipName = `${manifest.id}-${pluginVersion}.zip`;
const zipPath = path.join(releaseRoot, zipName);

// Remove stale zip if present
rmSync(zipPath, { force: true });

try {
  const srcPaths = filesToInclude.map(f => path.join(pluginDir, f.name));

  if (os.platform() === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Force -Path ${srcPaths.map(p => `"${p}"`).join(',')} -DestinationPath "${zipPath}"`,
    ]);
  } else {
    // -j: junk paths (store filenames only, no directory prefix)
    execFileSync('zip', ['-j', zipPath, ...srcPaths]);
  }

  console.log(`\u2713  Release zip: ${path.relative(projectRoot, zipPath)}`);
} catch (err) {
  console.warn(`\u26a0  Could not create zip: ${err.message}`);
  console.warn(`   Release folder is ready at ${path.relative(projectRoot, pluginDir)}`);
}

console.log(`\n\ud83d\ude80  Release ${pluginVersion} is ready.`);
