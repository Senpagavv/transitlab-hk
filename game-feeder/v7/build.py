"""Build everything in v7: each mode bundles itself (modeN-*/build.py), then the launcher is bundled into 开始.html.
Each mode stays a separate page and a separate bundle; the launcher only links to them."""
import base64, runpy
from pathlib import Path

p = Path(__file__).resolve().parent
runpy.run_path(str(p / 'levels' / 'build_registry.py'), run_name='__main__')   # levels/m1…m4/*.json → levels/registry.js
for b in sorted(p.glob('mode*/build.py')):
    print('--', b.parent.name)
    runpy.run_path(str(b), run_name='__main__')

shared = p / 'shared'
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="shared/style.css">', '<style>' + (shared / 'style.css').read_text(encoding='utf8') + '</style>')
s = s.replace('src="shared/logo-tide.svg"', 'src="data:image/svg+xml;base64,' + base64.b64encode((shared / 'logo-tide.svg').read_bytes()).decode() + '"')
# the hub (v3's cover and dot map): its scripts, the level registry and this browser's progress
for f in ['shared/i18n.js', 'levels/registry.js', 'shared/progress.js', 'hub/stations.js', 'hub/cover-data.js', 'hub/strings.js', 'hub/hub.js']:
    tag = f'<script src="{f}"></script>'
    assert tag in s, f'missing {tag}'
    s = s.replace(tag, '<script>\n' + (p / f).read_text(encoding='utf8') + '\n</script>')
assert 'src="shared/' not in s and 'href="shared/' not in s and '<script src=' not in s, 'a file was not inlined'
(p / '开始.html').write_text(s, encoding='utf8')
print('written', p / '开始.html', f'{len(s) // 1024} KB')
