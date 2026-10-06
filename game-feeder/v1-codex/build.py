"""Bundle the local demo into one offline HTML and a portable source ZIP."""
from pathlib import Path
import re,zipfile
p=Path(__file__).resolve().parent
s=(p/'index.html').read_text(encoding='utf8')
s=s.replace('<link rel="stylesheet" href="style.css">','<style>'+(p/'style.css').read_text(encoding='utf8')+'</style>')
logo=(p/'logo-tide.svg').read_text(encoding='utf8')
logo=logo[logo.index('<svg'):]
s=s.replace('<img src="logo-tide.svg" width="40" height="40" alt="綠色潮汐標誌">',logo)
for f in ['data.js','engine.js','ui.js']:
 s=s.replace(f'<script src="{f}"></script>','<script>\n'+(p/f).read_text(encoding='utf8')+'\n</script>')
(p/'开始游戏.html').write_text(s,encoding='utf8')
with zipfile.ZipFile(p.parent/'接驳巴士长局Demo.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in p.iterdir():
  if f.is_file():z.write(f,'接驳巴士长局Demo/'+f.name)
print('Standalone HTML and ZIP written')
