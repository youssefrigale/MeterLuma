// Release metadata for MeterLuma CI: version agreement, clean tree, notices drift, test summaries,
// per-platform build facts, BUILD-INFO.json, latest.json and SHA256SUMS.txt. It never prints secret values.
// Usage: node .github/scripts/release-meta.mjs <versions [tag] | clean | verify <tag> | notices | tests <out> label=file... | platform --flags | finalize --flags>
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter(arg => arg.startsWith('--')).map(arg => { const at = arg.indexOf('='); return at < 0 ? [arg.slice(2), 'true'] : [arg.slice(2, at), arg.slice(at + 1)]; }));
const positional = rest.filter(arg => !arg.startsWith('--'));
const text = file => readFileSync(resolve(root, file), 'utf8');
const json = file => JSON.parse(text(file));
const fail = message => { console.error(`::error::${message}`); process.exit(1); };
const output = (name, value) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); };
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = cmd => { try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trimEnd(); } catch { return null; } };
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const required = name => flags[name] ?? fail(`Missing --${name}=...`);
const listFiles = dir => readdirSync(dir).filter(name => statSync(join(dir, name)).isFile()).sort().map(name => ({ name, bytes: statSync(join(dir, name)).size, sha256: sha256(join(dir, name)) }));
const dirty = () => { const status = run('git status --porcelain --untracked-files=all'); if (status === null) fail('git status failed'); return status ? status.split('\n') : []; };

function versions() {
  const pkg = text('src-tauri/Cargo.toml').split(/^\[/m).find(section => section.startsWith('package]')) ?? '';
  const cargo = pkg.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  let tauri = json('src-tauri/tauri.conf.json').version ?? cargo;
  if (typeof tauri === 'string' && tauri.endsWith('.json')) tauri = json(join('src-tauri', tauri)).version;
  return { packageJson: json('package.json').version ?? null, cargoToml: cargo, tauriConf: tauri ?? null };
}

function checkVersions(tag) {
  const found = versions(), unique = [...new Set(Object.values(found))];
  if (unique.length !== 1 || !unique[0]) fail(`Versions disagree: package.json ${found.packageJson}, src-tauri/Cargo.toml ${found.cargoToml}, src-tauri/tauri.conf.json ${found.tauriConf}.`);
  const [version] = unique;
  if (!semver.test(version)) fail(`Version ${version} is not a semantic version.`);
  if (tag !== undefined && tag !== `v${version}`) fail(`Tag ${tag} does not match the version ${version}; expected v${version}.`);
  return { version, ...found };
}

function notices() {
  const expected = new Set();
  for (const block of text('src-tauri/Cargo.lock').split('[[package]]').slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1], version = block.match(/^version = "([^"]+)"/m)?.[1];
    if (name && version && name !== 'meterluma') expected.add(`${name} ${version}`);
  }
  for (const [path, pkg] of Object.entries(json('package-lock.json').packages ?? {})) if (path && !pkg.dev && !pkg.link) expected.add(`${path.split('node_modules/').pop()} ${pkg.version}`);
  const runtime = new Set(json('licenses/runtime-components.json').map(component => `${component.name} ${component.version}`));
  const listed = new Set([...text('THIRD_PARTY_NOTICES.txt').matchAll(/^={72}\r?\n(.+?)\r?\nLicense expression:/gm)].map(match => match[1].trim()));
  const missing = [...expected].filter(entry => !listed.has(entry)), stale = [...listed].filter(entry => !expected.has(entry) && !runtime.has(entry));
  for (const entry of stale) console.log(`::warning::THIRD_PARTY_NOTICES.txt lists ${entry}, which neither lockfile resolves any more.`);
  if (missing.length) fail(`THIRD_PARTY_NOTICES.txt is missing ${missing.length} locked package(s): ${missing.join(', ')}. Regenerate it with scripts/generate-notices.py.`);
  console.log(`THIRD_PARTY_NOTICES.txt covers all ${expected.size} locked packages (${stale.length} stale entries).`);
}

function tests(out, specs) {
  if (!out || !specs.length) fail('Usage: tests <out.json> label=playwright.json|cargo.log ...');
  const summary = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  for (const spec of specs) {
    const at = spec.indexOf('='), label = spec.slice(0, at), file = spec.slice(at + 1);
    if (at < 1 || !existsSync(file)) { summary[label || spec] = null; continue; }
    if (file.endsWith('.json')) { const stats = JSON.parse(readFileSync(file, 'utf8')).stats ?? {}; summary[label] = { passed: stats.expected ?? 0, failed: stats.unexpected ?? 0, flaky: stats.flaky ?? 0, skipped: stats.skipped ?? 0 }; continue; }
    const rows = [...readFileSync(file, 'utf8').matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
    summary[label] = rows.length ? rows.reduce((total, row) => ({ passed: total.passed + Number(row[1]), failed: total.failed + Number(row[2]), ignored: total.ignored + Number(row[3]) }), { passed: 0, failed: 0, ignored: 0 }) : null;
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}

function platform() {
  const changed = dirty();
  if (changed.length) fail(`The build changed the working tree: ${changed.join('; ')}`);
  const testsFile = flags.tests && existsSync(flags.tests) ? JSON.parse(readFileSync(flags.tests, 'utf8')) : null;
  const info = {
    platform: required('platform'), target: required('target'), bundles: required('bundles').split(','),
    signed: required('signed') === 'true', notarized: flags.notarized === 'true' ? true : flags.notarized === 'false' ? false : null,
    updaterArtifacts: flags.updater === 'true', cleanTree: true, commit: run('git rev-parse HEAD'), nativeTests: testsFile,
    toolchain: {
      rustc: run('rustc -V'), cargo: run('cargo -V'), node: run('node -v'), npm: run('npm -v'), tauriCli: run('npx tauri -V'),
      xcode: process.platform === 'darwin' ? run('xcodebuild -version')?.replace(/\s*\n\s*/g, ' ') ?? null : null,
      runner: `${process.env.RUNNER_OS ?? process.platform} ${process.env.RUNNER_ARCH ?? process.arch}`,
      runnerImage: [process.env.ImageOS, process.env.ImageVersion].filter(Boolean).join(' ') || null,
    },
    files: listFiles(resolve(required('assets'))),
  };
  if (!info.files.length) fail('No release files were collected.');
  writeFileSync(resolve(required('out')), JSON.stringify(info, null, 2) + '\n');
  console.log(`Recorded ${info.platform}: signed=${info.signed} notarized=${info.notarized} updater=${info.updaterArtifacts} files=${info.files.map(file => file.name).join(', ')}`);
}

function updaterManifest(out, version) {
  const signatures = readdirSync(out).filter(name => name.endsWith('.sig'));
  if (!signatures.length) return null;
  const base = process.env.METERLUMA_DOWNLOAD_BASE_URL?.trim();
  if (!base) { console.log('::warning::Updater artifacts exist but the METERLUMA_DOWNLOAD_BASE_URL variable is not set, so latest.json was not generated.'); return null; }
  const prefix = base.replaceAll('{version}', version).replace(/\/+$/, '');
  if (!prefix.startsWith('https://')) fail('METERLUMA_DOWNLOAD_BASE_URL must be an https URL.');
  const entry = suffix => { const sig = signatures.find(name => name.endsWith(`${suffix}.sig`)); return sig && { signature: readFileSync(join(out, sig), 'utf8').trim(), url: `${prefix}/${encodeURIComponent(sig.slice(0, -4))}` }; };
  const platforms = {}, windows = entry('-setup.exe'), mac = entry('.app.tar.gz');
  if (windows) platforms['windows-x86_64'] = windows;
  if (mac) Object.assign(platforms, { 'darwin-aarch64': mac, 'darwin-x86_64': mac });
  const manifest = { version, notes: `MeterLuma ${version}`, pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), platforms };
  writeFileSync(join(out, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function finalize() {
  const downloads = resolve(required('downloads')), out = resolve(required('out')), tag = required('tag');
  const { version, ...found } = checkVersions(tag), commit = run('git rev-parse HEAD');
  if (flags.sha && flags.sha !== commit) fail(`The checkout ${commit} is not the verified commit ${flags.sha}.`);
  mkdirSync(out, { recursive: true });
  const platforms = [];
  for (const dir of readdirSync(downloads).sort()) {
    const meta = join(downloads, dir, 'platform.json'), assets = join(downloads, dir, 'assets');
    if (!existsSync(meta)) continue;
    const info = JSON.parse(readFileSync(meta, 'utf8'));
    if (info.commit !== commit) fail(`${info.platform} was built from ${info.commit}, not ${commit}.`);
    for (const file of info.files) {
      if (existsSync(join(out, file.name))) fail(`Two builds produced ${file.name}.`);
      copyFileSync(join(assets, file.name), join(out, file.name));
      if (sha256(join(out, file.name)) !== file.sha256) fail(`${file.name} changed between its build job and the release job.`);
    }
    platforms.push(info);
  }
  if (!platforms.length) fail('No platform builds were downloaded.');
  const interfaceTests = flags['interface-tests'] && existsSync(flags['interface-tests']) ? JSON.parse(readFileSync(flags['interface-tests'], 'utf8')) : null;
  const manifest = updaterManifest(out, version);
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com', repository = process.env.GITHUB_REPOSITORY ?? null, runId = process.env.GITHUB_RUN_ID ?? null;
  const info = {
    schema: 1, product: 'MeterLuma', identifier: json('src-tauri/tauri.conf.json').identifier, version, tag, commit,
    cleanTree: flags['verified-clean'] === 'true' && platforms.every(item => item.cleanTree === true),
    builtAt: new Date().toISOString(), repository,
    workflow: { name: process.env.GITHUB_WORKFLOW ?? null, event: process.env.GITHUB_EVENT_NAME ?? null, ref: process.env.GITHUB_REF ?? null, runId, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, url: repository && runId ? `${server}/${repository}/actions/runs/${runId}` : null },
    versions: found, lockfiles: { 'package-lock.json': sha256(resolve(root, 'package-lock.json')), 'src-tauri/Cargo.lock': sha256(resolve(root, 'src-tauri/Cargo.lock')) },
    tests: { interface: interfaceTests, native: Object.fromEntries(platforms.map(item => [item.platform, item.nativeTests])) },
    signing: Object.fromEntries(platforms.map(item => [item.platform, { signed: item.signed, notarized: item.notarized }])),
    updater: { artifacts: platforms.some(item => item.updaterArtifacts), manifest: manifest ? 'latest.json' : null },
    platforms: platforms.map(({ files, ...item }) => ({ ...item, files: files.map(file => file.name) })),
    files: listFiles(out),
  };
  writeFileSync(join(out, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');
  const sums = listFiles(out).filter(file => file.name !== 'SHA256SUMS.txt');
  writeFileSync(join(out, 'SHA256SUMS.txt'), sums.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
  const yes = value => value === true ? 'yes' : value === false ? 'no' : 'n/a';
  if (flags.notes) writeFileSync(resolve(flags.notes), [
    `MeterLuma ${version}, built by CI from commit ${commit}${info.workflow.url ? ` in ${info.workflow.url}` : ''}.`, '',
    ...platforms.map(item => `- ${item.platform} (${item.target}): signed ${yes(item.signed)}, notarized ${yes(item.notarized)}, updater artifacts ${yes(item.updaterArtifacts)}`), '',
    `Clean tree: ${yes(info.cleanTree)}. Updater manifest: ${manifest ? 'latest.json' : 'not generated'}.`,
    'Verify downloads against SHA256SUMS.txt as described in docs/release-process.md.', '',
    '| File | SHA-256 |', '| --- | --- |', ...sums.map(file => `| ${file.name} | \`${file.sha256}\` |`), '',
  ].join('\n'));
  console.log(`Release ${tag}: ${sums.length} files, cleanTree=${info.cleanTree}, latest.json=${Boolean(manifest)}`);
}

const commands = {
  versions: () => { const { version } = checkVersions(positional[0]); console.log(`package.json, Cargo.toml and tauri.conf.json agree on ${version}.`); output('version', version); },
  clean: () => { const changed = dirty(); if (changed.length) fail(`The working tree is not clean: ${changed.join('; ')}`); console.log('The working tree is clean.'); output('clean', 'true'); },
  verify: () => {
    const tag = positional[0] ?? fail('Usage: verify vX.Y.Z');
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`${tag} is not a release tag like v1.2.3.`);
    commands.versions(); commands.clean(); output('sha', run('git rev-parse HEAD')); output('tag', tag);
  },
  notices, tests: () => tests(positional[0], positional.slice(1)), platform, finalize,
};
(commands[command] ?? (() => fail(`Unknown command "${command ?? ''}". Use versions, clean, verify, notices, tests, platform or finalize.`)))();
