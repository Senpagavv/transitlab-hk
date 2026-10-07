"""Bundle v3 into one offline HTML (开始游戏.html). Run after editing any source file.
Fonts load from Google Fonts when online; offline the system fallbacks are used."""
import base64
from pathlib import Path

p = Path(__file__).resolve().parent
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="style.css">', '<style>' + (p / 'style.css').read_text(encoding='utf8') + '</style>')
logo = 'data:image/svg+xml;base64,' + base64.b64encode((p / 'logo-tide.svg').read_bytes()).decode()
s = s.replace('src="logo-tide.svg"', f'src="{logo}"')
for f in ['data.js', 'engine.js', 'i18n.js', 'cover-data.js', 'ui.js', 'hub.js']:
    tag = f'<script src="{f}"></script>'
    assert tag in s, f'missing {tag}'
    s = s.replace(tag, '<script>\n' + (p / f).read_text(encoding='utf8') + '\n</script>')
assert 'src="' not in s.split('<body')[1].replace('src="data:', ''), 'a local file reference was not inlined'
(p / '开始游戏.html').write_text(s, encoding='utf8')
print('written', p / '开始游戏.html', f'{len(s) // 1024} KB')
