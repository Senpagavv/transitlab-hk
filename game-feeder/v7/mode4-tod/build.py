"""Bundle v7 mode 4 (station-side development) as an offline single file."""
import base64
from pathlib import Path

p = Path(__file__).resolve().parent
shared = p.parent / 'shared'
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="../shared/style.css"><link rel="stylesheet" href="tod.css">',
              '<style>' + (shared / 'style.css').read_text(encoding='utf8') + (p / 'tod.css').read_text(encoding='utf8') + '</style>')
s = s.replace('src="../shared/logo-tide.svg"', 'src="data:image/svg+xml;base64,' + base64.b64encode((shared / 'logo-tide.svg').read_bytes()).decode() + '"')
for f in ['../levels/registry.js', 'data.js', 'engine.js', '../shared/i18n.js', '../shared/nav.js', '../shared/progress.js', 'strings.js', 'ui.js']:
    tag = f'<script src="{f}"></script>'
    assert tag in s, f'missing {tag}'
    s = s.replace(tag, '<script>\n' + (p / f).resolve().read_text(encoding='utf8') + '\n</script>')
s = s.replace('href="../index.html"', 'href="../开始.html"')
assert 'src="' not in s.split('<body')[1].replace('src="data:', ''), 'a local file reference was not inlined'
out = p / '模式4-站旁开发.html'
out.write_text(s, encoding='utf8')
print('written', out, f'{out.stat().st_size / 1024:.1f} KiB ({out.stat().st_size} bytes)')
