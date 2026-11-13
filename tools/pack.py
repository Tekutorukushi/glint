"""Build store zips: dist/glint-<version>.zip (Chrome Web Store) and
dist/glint-<version>-firefox.zip (addons.mozilla.org).

The repo manifest is the Chrome one. Firefox gets a rewritten copy: background as an event page
(`background.scripts`, Firefox has no extension service workers), a fixed add-on ID and the
data-collection declaration. Keeping them apart avoids "unrecognized key" warnings in Chrome.
"""
import json
import pathlib
import zipfile

GECKO_ID = 'glint@tekutorukushi'   # permanent once published on AMO — never change
GECKO_MIN = '142.0'                # data_collection_permissions: Firefox 140, Firefox for Android 142

root = pathlib.Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
include = ['LICENSE', '_locales', 'icons', 'src']


def firefox_manifest(m):
    m = json.loads(json.dumps(m))
    m.pop('minimum_chrome_version', None)
    m['background'] = {'scripts': ['src/shared/defaults.js', m['background']['service_worker']]}
    m['browser_specific_settings'] = {'gecko': {
        'id': GECKO_ID,
        'strict_min_version': GECKO_MIN,
        # everything stays in browser storage, nothing is sent to the developer (PRIVACY.md)
        'data_collection_permissions': {'required': ['none']},
    }}
    return m


def build(out, m):
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(m, ensure_ascii=False, indent=2) + '\n')
        for item in include:
            p = root / item
            files = [p] if p.is_file() else sorted(f for f in p.rglob('*') if f.is_file())
            for f in files:
                if f.suffix == '.svg' and f.parent.name == 'icons':
                    continue
                z.write(f, f.relative_to(root).as_posix())
    print(out)


(root / 'dist').mkdir(exist_ok=True)
build(root / 'dist' / f'glint-{version}.zip', manifest)
build(root / 'dist' / f'glint-{version}-firefox.zip', firefox_manifest(manifest))
