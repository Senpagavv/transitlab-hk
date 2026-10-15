"""Bundle the level editor for modes 2-4 into one offline file, 关卡编辑器.html (2026-10-15): a teammate double-clicks it,
draws a level, test-plays it in the bundled mode pages next door (../modeN-*/模式N-….html) and exports the file to hand in.
Run by ../build.py after the modes are bundled."""
import base64
from pathlib import Path

p = Path(__file__).resolve().parent
v7 = p.parent
s = (p / 'index.html').read_text(encoding='utf8')
s = s.replace('<link rel="stylesheet" href="../shared/style.css">', '<style>' + (v7 / 'shared' / 'style.css').read_text(encoding='utf8') + '</style>')
s = s.replace('<link rel="stylesheet" href="editor.css">', '<style>' + (p / 'editor.css').read_text(encoding='utf8') + '</style>')
s = s.replace('src="../shared/logo-tide.svg"', 'src="data:image/svg+xml;base64,' + base64.b64encode((v7 / 'shared' / 'logo-tide.svg').read_bytes()).decode() + '"')
s = s.replace('href="../index.html', 'href="../开始.html')
for f in ['../shared/site.js', '../levels/registry.js', '../hub/stations.js', '../mode2-metro/data.js', '../mode2-metro/engine.js', '../mode3-roads/data.js', '../mode3-roads/engine.js',
          '../mode4-tod/data.js', '../mode4-tod/engine.js', '../shared/i18n.js', '../shared/levelpack.js', 'strings.js', 'analyse.js', 'editor.js']:
    tag = f'<script src="{f}"></script>'
    assert tag in s, f'missing {tag}'
    s = s.replace(tag, '<script>\n' + (p / f).resolve().read_text(encoding='utf8') + '\n</script>')
assert '<script src=' not in s and 'href="../shared/' not in s and 'href="editor.css"' not in s, 'a file was not inlined'
(p / '关卡编辑器.html').write_text(s, encoding='utf8')
print('written', p / '关卡编辑器.html', f'{len(s) // 1024} KB')
