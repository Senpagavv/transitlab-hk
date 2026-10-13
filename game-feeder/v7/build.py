"""Build everything in v7: each mode bundles itself (modeN-*/build.py), then the launcher is bundled into 开始.html.
Each mode stays a separate page and a separate bundle; the launcher only links to them."""
import base64, runpy
from pathlib import Path

p = Path(__file__).resolve().parent
for b in sorted(p.glob('mode*/build.py')):
    print('--', b.parent.name)
    runpy.run_path(str(b), run_name='__main__')

shared = p / 'shared'
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="shared/style.css">', '<style>' + (shared / 'style.css').read_text(encoding='utf8') + '</style>')
s = s.replace('src="shared/logo-tide.svg"', 'src="data:image/svg+xml;base64,' + base64.b64encode((shared / 'logo-tide.svg').read_bytes()).decode() + '"')
s = s.replace('<script src="shared/i18n.js"></script>', '<script>\n' + (shared / 'i18n.js').read_text(encoding='utf8') + '\n</script>')
assert 'src="shared/' not in s and 'href="shared/' not in s, 'a shared file was not inlined'
(p / '开始.html').write_text(s, encoding='utf8')
print('written', p / '开始.html', f'{len(s) // 1024} KB')
