"""Bundle v7 mode 1 (stations and walking) and its level editor into offline single files. Run after editing any
source file here or in ../shared. Fonts load from Google Fonts when online; offline the system fallbacks are used."""
import base64
from pathlib import Path

p = Path(__file__).resolve().parent
shared = p.parent / 'shared'
css = (shared / 'style.css').read_text(encoding='utf8')
logo = 'data:image/svg+xml;base64,' + base64.b64encode((shared / 'logo-tide.svg').read_bytes()).decode()

def bundle(page, scripts, out):
    s = (p / page).read_text(encoding='utf8')
    s = s.replace('<link rel="stylesheet" href="../shared/style.css">', '<style>' + css + '</style>')
    s = s.replace('src="../shared/logo-tide.svg"', f'src="{logo}"')
    s = s.replace('href="../index.html', 'href="../开始.html')   # back to the hub: the bundled one
    for f in scripts:
        tag = f'<script src="{f}"></script>'
        assert tag in s, f'missing {tag} in {page}'
        s = s.replace(tag, '<script>\n' + (p / f).resolve().read_text(encoding='utf8') + '\n</script>')
    assert 'src="' not in s.split('<body')[1].replace('src="data:', ''), f'a local file reference was not inlined in {page}'
    (p / out).write_text(s, encoding='utf8')
    print('written', p / out, f'{len(s) // 1024} KB')

bundle('index.html', ['../shared/flyin.js', '../levels/registry.js', 'data.js', 'engine.js', '../shared/i18n.js', '../shared/nav.js', '../shared/progress.js', '../shared/save.js', '../shared/levelpack.js', '../shared/board.js', 'strings.js', '../shared/tips.js', 'ui.js',
        'demo-plans.js', 'demo.js'], '模式1-车站与步行.html')   # the last two: AI demo (temporary)
bundle('editor.html', ['data.js', 'engine.js', '../shared/i18n.js', 'strings.js', 'editor.js'], '模式1-关卡编辑器.html')
