// SPDX-License-Identifier: GPL-3.0-or-later
// Build-time deployment only. OwlSight does not need Node.js at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['qt', 'toolchain', 'exe', 'updater', 'qml', 'destination', 'plan'].map(key => [key, { type: 'string' }])
) });
for (const key of ['qt', 'toolchain', 'exe', 'updater', 'qml', 'destination', 'plan']) {
  if (!values[key]) throw new Error(`Missing --${key}`);
  values[key] = path.resolve(values[key]);
}
const { qt, toolchain, exe, qml, destination, plan } = values;
if (fs.existsSync(destination) || fs.existsSync(plan)) {
  throw new Error('Deployment and planning directories must be new; previous packages are preserved.');
}
const sdkQml = path.join(qt, 'qml');
const readobj = path.join(toolchain, 'bin/llvm-readobj.exe');
const scanner = path.join(qt, 'bin/qmlimportscanner.exe');
const inactiveStyles = /^QtQuick\.(?:Controls\.(?:Fusion|Imagine|Material|Universal|FluentWinUI3|Windows)(?:\.|$)|NativeStyle(?:\.|$))/;
const slash = value => value.split(path.sep).join('/');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path outside ${root}: ${file}`);
  return relative;
};
const copy = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
};
const scan = imports => JSON.parse(execFileSync(scanner, [
  '-rootPath', qml, '-importPath', imports
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }));

// Copy one module, never nested modules. Keep runtime assets, omit designer metadata.
function copyModule(source, target) {
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected SDK symlink: ${file}`);
      if (entry.isDirectory()) {
        if (['designer', 'tooling'].includes(entry.name) || fs.existsSync(path.join(file, 'qmldir'))) continue;
        walk(file);
      } else if (entry.isFile() && !/\.(qmltypes|pdb|a|lib|prl|cmake)$/i.test(entry.name)) {
        copy(file, path.join(target, inside(source, file)));
      }
    }
  }
  walk(source);
}

// Qt's first scan includes every optional Controls style. Rescan against a private
// import tree with only the fixed Basic style. Qt resolves dialog fallback too.
fs.mkdirSync(plan, { recursive: true });
const firstScan = scan(sdkQml);
for (const module of firstScan) {
  if (/^Qt(?:Quick|Qml|\.)/.test(module.name) && !module.path && !inactiveStyles.test(module.name))
    throw new Error(`Unresolved QML import: ${module.name}`);
}
for (const module of firstScan.filter(module => module.path && !inactiveStyles.test(module.name))) {
  const source = path.resolve(module.path);
  copyModule(source, path.join(plan, inside(sdkQml, source)));
}
const modules = scan(plan).filter(module => module.path && !inactiveStyles.test(module.name));
const moduleNames = new Set(modules.map(module => module.name));
for (const name of ['QtQuick', 'QtQuick.Controls', 'QtQuick.Controls.Basic', 'QtQuick.Controls.Basic.impl',
  'QtQuick.Templates', 'QtQuick.Controls.impl', 'QtQuick.Layouts', 'QtQuick.Dialogs',
  'QtQuick.Dialogs.quickimpl', 'Qt.labs.folderlistmodel']) {
  if (!moduleNames.has(name)) throw new Error(`Qt did not resolve required QML module: ${name}`);
}
fs.mkdirSync(destination, { recursive: true });
copy(exe, path.join(destination, 'OwlSight.exe'));
copy(values.updater, path.join(destination, 'OwlSightUpdater.exe'));
for (const module of modules) {
  const relative = inside(plan, path.resolve(module.path));
  copyModule(path.resolve(module.path), path.join(destination, 'qml', relative));
}

// Dynamically loaded plugins cannot be found in PE imports. Keep dialog icons
// and the Windows TLS backend; OpenSSL and unrelated platform plugins are omitted.
const plugins = ['platforms/qwindows.dll', 'imageformats/qico.dll', 'imageformats/qsvg.dll',
  'iconengines/qsvgicon.dll', 'networkinformation/qnetworklistmanager.dll', 'tls/qschannelbackend.dll'];
for (const plugin of plugins) copy(path.join(qt, 'plugins', plugin), path.join(destination, 'plugins', plugin));

const available = new Map();
for (const directory of [path.join(qt, 'bin'), path.join(toolchain, 'x86_64-w64-mingw32/bin')]) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
      const key = entry.name.toLowerCase();
      if (!available.has(key)) available.set(key, path.join(directory, entry.name));
    }
  }
}
function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
const queue = filesUnder(destination).filter(file => /\.(exe|dll)$/i.test(file));
const copied = new Set();
const imports = [];
for (let index = 0; index < queue.length; ++index) {
  const file = queue[index];
  // --coff-imports includes ordinary Import and DelayImport records.
  const output = execFileSync(readobj, ['--coff-imports', file], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true
  });
  const names = [...output.matchAll(/^\s*Name:\s+(\S+\.dll)\s*$/gim)].map(match => match[1]);
  for (const name of new Set(names)) {
    const source = available.get(name.toLowerCase());
    let provider = 'Windows';
    if (source) {
      provider = path.basename(source);
      if (!copied.has(name.toLowerCase())) {
        const target = path.join(destination, provider);
        copy(source, target);
        copied.add(name.toLowerCase());
        queue.push(target);
      }
    } else if (!/^(api-ms-|ext-ms-)/i.test(name) &&
      !fs.existsSync(path.join(process.env.SystemRoot, 'System32', name))) {
      throw new Error(`Unresolved dependency ${name} imported by ${file}`);
    }
    imports.push({ file: slash(inside(destination, file)), name, provider });
  }
}
fs.writeFileSync(path.join(destination, 'qt.conf'), '[Paths]\nPrefix=.\nPlugins=plugins\nQmlImports=qml\n');
const runtimeFiles = filesUnder(destination).sort().map(file => ({
  path: slash(inside(destination, file)), bytes: fs.statSync(file).size,
  sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}));
const record = {
  schema: 1, qt: '6.11.3', style: 'Basic',
  method: 'Qt QML import scan, fixed-style rescan, explicit dynamic plugins, transitive PE imports',
  qmlModules: modules.map(module => module.name).sort(), dynamicPlugins: plugins,
  omittedOptionalStyles: firstScan.filter(module => inactiveStyles.test(module.name)).map(module => module.name),
  imports, files: runtimeFiles,
  scope: 'Packaging dependency analysis only; no application launch or runtime validation.'
};
fs.mkdirSync(path.join(destination, 'third_party'), { recursive: true });
fs.writeFileSync(path.join(destination, 'third_party/runtime-dependencies.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Deployed ${runtimeFiles.length} runtime files, ${copied.size} shared runtime DLLs, ${modules.length} QML modules.`);
