"""Generate notices from installed frontend dependencies and cargo metadata.

Run cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1
and save its JSON as .tools/dependency-metadata.json before running this script.
The inventory includes transitive/build/platform dependencies; an exact binary
may include only a subset. No third-party license is replaced by LICENSE.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
metadata = json.loads((ROOT / '.tools/dependency-metadata.json').read_text(encoding='utf-8-sig'))
lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
sections = [
    'MeterLuma third-party notices',
    'Generated from package-lock.json and src-tauri/Cargo.lock. Includes resolved '
    'Rust build/platform dependencies as well as direct frontend runtime dependencies. '
    'Not every listed package is bundled on every platform. Each component retains '
    'its own license. MeterLuma personal-use and redistribution restrictions do not '
    'apply to these separately licensed components.',
    'Rust source archives are available at the exact version URLs below. MPL-2.0 '
    'components are used without source modifications; their source is available '
    'from those archives. For alternative licenses, the MIT or Apache-2.0 option is '
    'used where offered; conjunctive notice obligations are retained. System webviews '
    'and other operating-system libraries have separate distribution terms.',
]
missing = []
inventory = []
sources = json.loads((ROOT / 'scripts/license-sources.json').read_text(encoding='utf-8'))

def package_dir(name):
    row = next(row for row in metadata['packages'] if row['name'] == name)
    return Path(row['manifest_path']).parent

def add(name, version, license_name, source, directory):
    sections.append(f'\n{"=" * 72}\n{name} {version}\nLicense expression: {license_name}\nSource: {source}\n')
    found = False
    for file in sorted(directory.iterdir()):
        if file.is_file() and file.name.lower().startswith(('license', 'licence', 'copying', 'notice', 'unlicense', 'copyright')) and file.stat().st_size < 512_000:
            if file.suffix.lower() in ('.spdx', '.json'):
                continue
            sections.append(f'--- {file.name} ---\n{file.read_text(encoding="utf-8", errors="replace")}\n')
            found = True
    if not found:
        upstream = ROOT / '.tools/upstream-notices' / f'{name}-{version}.json'
        if not upstream.exists() and '--fetch-upstream' in sys.argv:
            recovered = []
            for url in sources.get(f'{name}-{version}', []):
                if not url.startswith('https://raw.githubusercontent.com/'):
                    raise ValueError('Unexpected license source domain')
                with urllib.request.urlopen(url, timeout=30) as response:
                    data = response.read(512_001)
                if len(data) > 512_000:
                    raise ValueError('Upstream notice exceeded the size limit')
                recovered.append({'url': url, 'text': data.decode('utf-8')})
            if recovered:
                upstream.parent.mkdir(parents=True, exist_ok=True)
                upstream.write_text(json.dumps(recovered), encoding='utf-8')
        if upstream.exists():
            for notice in json.loads(upstream.read_text(encoding='utf-8')):
                sections.append(f'--- Upstream notice: {notice["url"]} ---\n{notice["text"]}\n')
            found = True
    if not found and (name.startswith('winapi-') or name == 'libappindicator-sys'):
        # Companion crate archive from the same project supplies the declared
        # alternative license texts. Keep this crate's own source notices too.
        companion = package_dir('winapi' if name.startswith('winapi-') else 'libappindicator')
        for filename in ('LICENSE-APACHE', 'LICENSE-MIT'):
            file = companion / filename
            if file.exists():
                sections.append(f'--- {name} project license from companion {companion.name}/{filename} ---\n{file.read_text(encoding="utf-8", errors="replace")}\n')
                found = True
        header = directory / 'src/lib.rs'
        if header.exists():
            comments = '\n'.join(line for line in header.read_text(encoding='utf-8', errors='replace').splitlines()[:12] if line.startswith('//'))
            sections.append('Archive source notices:\n' + comments + '\n')
    if not found and name == 'selectors':
        # MPL is a standard license; the source header supplies the notice and
        # the exact archive URL above supplies the unmodified covered source.
        standard = package_dir('cssparser') / 'LICENSE'
        sections.append('Archive source notice:\n' + (directory / 'lib.rs').read_text(encoding='utf-8').split('\n\n', 1)[0])
        sections.append('MPL-2.0 full text:\n' + standard.read_text(encoding='utf-8'))
        found = True
    if not found:
        missing.append(f'{name} {version}')
        sections.append('No standalone license/notice file was included at the archive root. '
                        'Consult the exact source archive and its license metadata before release.\n')
    inventory.append({'name': name, 'version': version, 'license': license_name, 'source': source, 'noticeCollected': found})

for path, package in sorted(lock['packages'].items()):
    if not path or package.get('dev'):
        continue
    directory = ROOT / path
    info = json.loads((directory / 'package.json').read_text(encoding='utf-8'))
    add(info['name'], info['version'], info.get('license', 'UNSPECIFIED'), package.get('resolved', ''), directory)

for package in sorted(metadata['packages'], key=lambda row: (row['name'], row['version'])):
    if package['name'] == 'meterluma':
        continue
    source = f'https://crates.io/api/v1/crates/{package["name"]}/{package["version"]}/download'
    add(package['name'], package['version'], package.get('license') or 'UNSPECIFIED', source, Path(package['manifest_path']).parent)

for component in json.loads((ROOT / 'licenses/runtime-components.json').read_text(encoding='utf-8')):
    add(component['name'], component['version'], component['license'], component['source'], ROOT / 'licenses' / component['directory'])

for file in sorted((ROOT / 'src/assets/providers').glob('*.svg')):
    text = file.read_text(encoding='utf-8')
    start, end = text.find('<!--'), text.find('-->')
    if start >= 0 and end > start:
        sections.append(f'\nProvider asset {file.name}\nUpstream: https://github.com/robinebers/openusage\n{text[start + 4:end].strip()}\nProvider marks remain with their owners. A copyright license is not a trademark endorsement.\n')

(ROOT / 'THIRD_PARTY_NOTICES.txt').write_text('\n\n'.join(sections), encoding='utf-8', newline='\n')
(ROOT / '.tools/license-inventory.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
print(f'Inventoried {len(inventory)} packages; {len(missing)} still need notice follow-up.')
print('Unresolved notices: ' + ', '.join(missing))
