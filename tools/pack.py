"""Build dist/glint-<version>.zip for the Chrome Web Store."""
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))['version']
include = ['manifest.json', 'LICENSE', '_locales', 'icons', 'src']
out = root / 'dist' / f'glint-{version}.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in include:
        p = root / item
        files = [p] if p.is_file() else sorted(f for f in p.rglob('*') if f.is_file())
        for f in files:
            if f.suffix == '.svg' and f.parent.name == 'icons':
                continue
            z.write(f, f.relative_to(root).as_posix())
print(out)
