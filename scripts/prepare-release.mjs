import { readFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const manifestPath = path.join(projectRoot, 'manifest.json');
const mainJsPath = path.join(projectRoot, 'main.js');
const stylesPath = path.join(projectRoot, 'styles.css');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const releaseRoot = path.join(projectRoot, 'release');
const pluginDir = path.join(releaseRoot, manifest.id);

rmSync(pluginDir, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

const filesToCopy = [
  ['manifest.json', manifestPath],
  ['main.js', mainJsPath],
];

if (existsSync(stylesPath)) {
  filesToCopy.push(['styles.css', stylesPath]);
}

for (const [filename, source] of filesToCopy) {
  const destination = path.join(pluginDir, filename);
  copyFileSync(source, destination);
}

console.log(`Release folder prepared at ${pluginDir}`);

