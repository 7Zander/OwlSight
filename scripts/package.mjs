// SPDX-License-Identifier: GPL-3.0-or-later
import { packager } from '@electron/packager';
import { mkdir, writeFile, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = manifest.devDependencies.electron;
const releaseName = manifest.releaseName || manifest.version;
const decoder = path.resolve(process.env.OWLSIGHT_DECODER_DIR || path.join(root, 'resources/decoder'));
const cache = path.resolve(process.env.OWLSIGHT_ELECTRON_CACHE || path.join(root, 'build/electron-cache'));
const work = path.resolve(process.env.OWLSIGHT_PACKAGE_WORK_DIR || path.join(root, 'build'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.env.OWLSIGHT_PACKAGE_OUT || path.join(root, 'dist', stamp));
if (!existsSync(path.join(decoder, 'owlsight-decoder.exe'))) throw new Error('Run npm run build:decoder before packaging.');
if (existsSync(path.join(out, 'OwlSight-win32-x64'))) throw new Error('Output already exists; choose a new output directory.');

const zipName = `electron-v${electronVersion}-win32-x64.zip`;
let electronZipDir;
if (existsSync(cache)) for (const dir of readdirSync(cache)) {
  const zip = path.join(cache, dir, zipName);
  if (!existsSync(zip)) continue;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(zip)) hash.update(chunk);
  const expected = JSON.parse(readFileSync(require.resolve('electron/checksums.json'), 'utf8'))[zipName];
  if (!expected || hash.digest('hex') !== expected) throw new Error('Cached Electron ZIP checksum mismatch.');
  electronZipDir = path.dirname(zip);
  break;
}

const publicDocs = ['README.md', 'USER_GUIDE.md', 'CHANGELOG.md', 'PRIVACY.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md'];
const allowed = new Set(['package.json', 'node_modules', 'src', 'ui', 'resources', 'third_party', 'LICENSE', ...publicDocs]);
const excluded = new Set(['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', '.agents', '.codex', '.claude', '.git', '__pycache__', 'logs', 'direct_url.json']);
await mkdir(work, { recursive: true });
const results = await packager({
  electronZipDir, dir: root, out, name: 'OwlSight', platform: 'win32', arch: 'x64',
  electronVersion, appVersion: manifest.version, buildVersion: manifest.version.split('-')[0] + '.0',
  asar: false, prune: true, overwrite: false, tmpdir: path.join(work, 'package-tmp'),
  ignore: file => {
    const relative = file.replace(/^[\\/]+/, '');
    if (!relative) return false;
    const segments = relative.split(/[\\/]/);
    return !allowed.has(segments[0]) || segments.some(part => excluded.has(part))
      || /\.(pyc|log|jsonl)$/i.test(relative);
  },
  download: { cacheRoot: cache },
  afterCopy: [async ({ buildPath }) => {
    const runtimeTarget = path.join(buildPath, 'resources/decoder');
    await cp(decoder, runtimeTarget, { recursive: true, filter: source =>
      !path.relative(decoder, source).split(path.sep).some(part => excluded.has(part))
      && !/\.(pyc|log|jsonl)$/i.test(source) });
    // Use helper code from the source snapshot that is being packaged.
    for (const name of ['decoder.py', 'preview_service.py', 'perf_support.py', 'register_exr.py', 'ocio_service.py']) {
      await copyFile(path.join(root, 'native', name), path.join(runtimeTarget, name));
    }
  }],
  win32metadata: { CompanyName: 'OwlSight', FileDescription: `OwlSight EXR Viewer ${releaseName}`, ProductName: 'OwlSight' }
});
const directory = results[0];
await copyFile(path.join(root, 'USER_GUIDE.md'), path.join(directory, '使用说明.md'));
await copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE-OwlSight.txt'));
await writeFile(path.join(directory, 'THIRD_PARTY_NOTICES.md'), readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').replaceAll('](third_party/', '](resources/app/third_party/'));
await writeFile(path.join(directory, 'SOURCE.txt'),
  `OwlSight ${releaseName} (${manifest.version})\nLicense: GPL-3.0-or-later.\n` +
  `The corresponding project source and build scripts are supplied as OwlSight-${releaseName}-source.zip alongside the Windows ZIP in the same release.\n` +
  'Third-party notices and source references: THIRD_PARTY_NOTICES.md and resources/app/third_party/licenses/.\n');
await writeFile(path.join(directory, 'version.json'), JSON.stringify({
  releaseName, version: manifest.version, builtAt: stamp, platform: 'win32', arch: 'x64',
  electron: electronVersion,
  decoder: JSON.parse(readFileSync(path.join(decoder, 'versions.json'), 'utf8'))
}, null, 2) + '\n');
await writeFile(path.join(work, 'latest-package.json'), JSON.stringify({
  version: manifest.version, releaseName, directory, executable: path.join(directory, 'OwlSight.exe')
}, null, 2) + '\n');
console.log(path.join(directory, 'OwlSight.exe'));
