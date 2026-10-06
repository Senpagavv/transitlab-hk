"""Bundle v2 into one offline HTML (开始游戏.html). Run after editing any source file."""
from pathlib import Path

p = Path(__file__).resolve().parent
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="style.css">', '<style>' + (p / 'style.css').read_text(encoding='utf8') + '</style>')
logo = (p / 'logo-tide.svg').read_text(encoding='utf8')
s = s.replace('<img src="logo-tide.svg" width="40" height="40" alt="綠色潮汐標誌">', logo[logo.index('<svg'):])
for f in ['data.js', 'engine.js', 'ui.js']:
    s = s.replace(f'<script src="{f}"></script>', '<script>\n' + (p / f).read_text(encoding='utf8') + '\n</script>')
assert 'src="' not in s.split('<body>')[1], 'a local file reference was not inlined'
(p / '开始游戏.html').write_text(s, encoding='utf8')
print('written', p / '开始游戏.html')
