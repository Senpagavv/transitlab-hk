"""Offline, allow-list based v7 packager. Never reads .env or contacts a network.
Usage: python game-feeder/tools/deploy/build_static.py [output-directory]
"""
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from html.parser import HTMLParser
import argparse, hashlib, json, re, shutil, sys, tempfile

V7 = Path(__file__).resolve().parents[2] / 'v7'
HERE = Path(__file__).resolve().parent
PAGES = ['index.html', 'mode1-bus/index.html', 'mode1-bus/editor.html',
         'mode2-metro/index.html', 'mode3-roads/index.html', 'mode4-tod/index.html',
         'mode5-sandbox/index.html', 'editor/index.html']
EXT = {'.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.webp', '.woff2', '.ico'}
MAX_FILE = 25 * 1024 * 1024
STATIC = "// Generated static configuration. Local shared/site.js remains unchanged.\nwindow.TL_SITE = { static: true, ai: false, dataMap: false, board: false, submit: '發給發起人' };\n"

def prohibited(path):
    p = PurePosixPath(path.replace('\\', '/'))
    parts = [x.lower() for x in p.parts]
    name = p.name.lower()
    browser_bot = p.as_posix().endswith('shared/levelgen/bot.js')
    return (any(x.startswith('.env') or x in {'node_modules', '.git', '__pycache__', 'tests', 'bots', 'results', 'examples'} for x in parts)
            or ('data' in parts and 'hk' not in parts)
            or p.suffix.lower() not in EXT
            or name.startswith(('test_', 'test-', 'fuzz_', 'verify_', 'check-output', '模式'))
            or (not browser_bot and (name.startswith(('bot_', 'robot_', 'v7_')) or name=='bot.js'))
            or name in {'开始.html', '关卡编辑器.html', 'readme.md', 'integration.md', 'preview.html', 'serve.js'}
            or 'mode4-bus' in parts)

class Tags(HTMLParser):
    def __init__(self): super().__init__(); self.refs = []
    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in {'href', 'src'} and v: self.refs.append(v)

def local_ref(parent, ref):
    u = urlsplit(ref)
    if u.scheme or u.netloc or not u.path or ref.startswith('/'):
        return None
    p = (parent / unquote(u.path)).resolve()
    if not p.is_relative_to(V7.resolve()):
        raise ValueError('Reference escapes v7: ' + ref)
    if p.is_dir(): p /= 'index.html'
    return p

def refs(p, text):
    if p.suffix == '.html':
        tags = Tags(); tags.feed(text)
        return tags.refs
    # All literal local assets; includes importScripts, fetch, Worker, script.src,
    # CSS url(), and inline scripts. Dynamic HK filenames are enumerated below.
    return re.findall(r'''["']([^"'\s<>]+\.(?:js|css|json|svg|html|png|woff2)(?:[?#][^"'\s<>]*)?)["']''', text)

def strip_external_fonts(s):
    return re.sub(r'<link\b[^>]*https://fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*', '', s)

def runtime_refs(s):
    out = re.findall(r'''(?:\bfetch|\bjsonFile|new\s+Worker)\(\s*["']([^"']+)["']\s*[,)]''', s)
    for block in re.findall(r'\bimportScripts\(([^)]*)\)',s):
        out += re.findall(r'''["']([^"']+)["']''',block)
    out += re.findall(r'''url\(\s*["']?([^\s)'"<>]+)["']?\s*\)''',s)
    return out

def secret_check(p):
    # Scan publishable bytes only. Never open .env, even if a bad input directory contains one.
    if p.suffix not in {'.js', '.html', '.json', '.css', '.svg'}: return
    text = p.read_text(encoding='utf-8')
    patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', r'\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{25,})\b',
                r'''(?i)["']?(?:api[_-]?key|client[_-]?secret|access[_-]?token)["']?\s*[:=]\s*["'](?!["']|[<{])[A-Za-z0-9_+/=-]{16,}["']''']
    if any(re.search(pattern, text) for pattern in patterns):
        raise ValueError('Potential secret in publishable file: ' + str(p))

def check_site(root):
    for entry in root.rglob('*'):
        if entry.is_symlink(): raise ValueError('Symlink: '+str(entry))
        if entry.is_dir() and (entry.name.lower().startswith('.env') or entry.name.lower() in {'node_modules','.git','__pycache__','tests','bots','data','results','examples'}):
            raise ValueError('Forbidden directory: '+str(entry))
    files = sorted(p for p in root.rglob('*') if p.is_file())
    for p in files:
        rel = p.relative_to(root).as_posix()
        if rel not in {'_headers', '_redirects'} and prohibited(rel): raise ValueError('Forbidden file: ' + rel)
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()): raise ValueError('Symlink: ' + rel)
        if p.stat().st_size > MAX_FILE: raise ValueError('Over 25 MiB: ' + rel)
        secret_check(p)
    if len(files) > 20000: raise ValueError('Over 20,000 files')
    missing = []
    for p in files:
        if p.suffix not in {'.html','.js','.css'}: continue
        s=p.read_text(encoding='utf-8'); dependencies=runtime_refs(s)
        if p.suffix=='.html':
            t=Tags();t.feed(s);dependencies+=t.refs
        for ref in dependencies:
            u = urlsplit(ref)
            if u.scheme in {'http','https'} or u.netloc: raise ValueError('External runtime URL: '+str(p)+' -> '+ref)
            if u.scheme or not u.path: continue
            if ref.startswith('/') and p.suffix!='.html': continue  # guarded backend roots are inventoried separately
            target = root / unquote(u.path.lstrip('/')) if ref.startswith('/') else p.parent / unquote(u.path)
            if target.is_dir(): target /= 'index.html'
            if not target.is_file() or not target.resolve().is_relative_to(root.resolve()): missing.append((p.relative_to(root).as_posix(), ref))
    if missing: raise ValueError('Broken HTML/CSS/fetch/Worker/importScripts references: ' + repr(missing))
    return files

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', default=r'F:\transitlab-hk\site')
    parser.add_argument('--check-only', action='store_true', help='Check an existing output; never reads forbidden contents')
    args = parser.parse_args()
    out = Path(args.output).resolve()
    if args.check_only:
        files = check_site(out); print('FORBIDDEN / SECRET / RUNTIME REFERENCE CHECK PASS:', len(files)); return
    # Never overwrite or recursively delete an existing directory. Updates use a new empty destination.
    if out == V7 or out.is_relative_to(V7) or V7.is_relative_to(out): raise ValueError('Output overlaps source')
    if out.exists() and any(out.iterdir()): raise ValueError('Output is not empty; choose a new empty output directory: ' + str(out))
    selected = set(); pending = [V7 / p for p in PAGES]
    pending += sorted((V7/'hk').glob('*.json'))
    pending += sorted((V7/'shared/levelgen').glob('*.js'))
    pending += [V7/'levels/registry.js', V7/'mode5-sandbox/scenario-worker.js', V7/'mode5-sandbox/worker.js']
    references = []; omitted = []
    while pending:
        p = pending.pop().resolve()
        rel = p.relative_to(V7.resolve()).as_posix()
        if p in selected: continue
        if prohibited(rel): raise ValueError('Forbidden runtime dependency: ' + rel)
        if not p.is_file(): raise ValueError('Missing runtime asset: ' + rel)
        selected.add(p)
        if p.suffix not in {'.html', '.js', '.css'}: continue
        s = p.read_text(encoding='utf-8')
        for ref in refs(p, s):
            target = local_ref(p.parent, ref)
            if target is None: continue
            # These are bundled-only navigation branches (bundled is false on website index.html).
            if target.name.startswith('模式') or target.name in {'开始.html', '关卡编辑器.html'}:
                omitted.append({'file':rel,'ref':ref,'reason':'offline-only navigation; bundled=false on published pages'}); continue
            # Prose mentioning data filenames is not a URL; only runtime files that exist enter this closure.
            if not target.is_file():
                if re.search(r'''(?:fetch|new\s+Worker|jsonFile)\(\s*["']''' + re.escape(ref), s):
                    raise ValueError('Missing runtime reference: ' + rel + ' -> ' + ref)
                continue
            if target.suffix in EXT: pending.append(target); references.append({'file':rel,'ref':ref})
    # Source-file absolute URL inventory, with source-specific guard evidence. Fail on a new backend path.
    root_urls = []
    policies = {'hub/hub.js':'TL_SITE.dataMap=false; hubLive omitted',
                'mode5-sandbox/layout.js':'TL_SITE.dataMap=false; live link never inserted',
                'mode5-sandbox/ui.js':'TL_SITE.dataMap=false; liveMap never created',
                'shared/board.js':'TL_SITE.board=false guards mount/receive/open/refresh/submit/request',
                'shared/levelpack.js':'TL_FEATURES.levelUpload=false guards upload before fetch',
                'ai/client.js':'TL_SITE.ai=false guards call/status/comment; generate uses examples'}
    for mode in ['mode1-bus','mode2-metro','mode3-roads','mode4-tod']:
        policies[mode+'/index.html']='TLBoard.bind calls guarded board API; TL_SITE.board=false'
    expected = {'/','/login','/api/auth/me','/api/game/leaderboard','/api/game/leaderboard/me','/api/feeder/levels','/api/feeder/ai','/status','/level','/comment'}
    for p in sorted(selected):
        if p.suffix not in {'.js','.html','.css'}: continue
        rel=p.relative_to(V7).as_posix(); s=p.read_text(encoding='utf-8')
        for m in re.finditer(r'''["'](/[^\s"'<>]*)(?:["'])''', s):
            url=m.group(1)
            # SVG path fragments, closing HTML tags and JS regexes are not URLs.
            if url.startswith('/>') or url.startswith('</') or re.search(r'[{}()|\\]',url): continue
            if len(url)>256 and re.fullmatch(r'[A-Za-z0-9+/=]+',url): continue  # packed map data, never executed as a URL
            if re.search(r'\.(?:split|join|replace)\(\s*$', s[max(0,m.start()-40):m.start()]): continue
            if re.fullmatch(r'/\d+',url): continue  # score denominators, e.g. /10
            if url=='/' and re.search(r'\+\s*$',s[max(0,m.start()-8):m.start()]): continue  # storage-key separator
            # a file name joined onto a relative directory: '../' + mode dir + '/index.html#pack=…', '../../' + dir + '/data.js'
            if re.fullmatch(r'/[\w.-]+\.(?:html|js)(?:#[\w=-]*)?', url) and re.search(r'\+\s*$', s[max(0,m.start()-8):m.start()]): continue
            if url not in expected: raise ValueError('Unreviewed absolute URL: ' + rel + ' ' + url)
            if rel not in policies: raise ValueError('Unreviewed absolute URL: ' + rel + ' ' + url)
            root_urls.append({'file':rel,'line':s[:m.start()].count('\n')+1,'url':url,'guard':policies[rel]})
    root_urls += [{'file':'index.html','url':'/feeder/','guard':'intentional local game entry and fallback redirect'},
                  {'file':'404.html','url':'/feeder/','guard':'intentional return to games'},
                  {'file':'_redirects','url':'/','guard':'302 to /feeder/'}]
    out.mkdir(parents=True, exist_ok=True)
    try:
        for p in sorted(selected):
            target=out/'feeder'/p.relative_to(V7); target.parent.mkdir(parents=True,exist_ok=True)
            if p.suffix=='.html': target.write_text(strip_external_fonts(p.read_text(encoding='utf-8')),encoding='utf-8',newline='\n')
            else: shutil.copy2(p,target)
        (out/'feeder/shared/site.js').write_text(STATIC,encoding='utf-8',newline='\n')
        for name in ['_headers','_redirects','404.html','index.html']:
            shutil.copy2(HERE/name,out/name)
        files=check_site(out)
        sizes=sorted([(p.relative_to(out).as_posix(),p.stat().st_size) for p in files],key=lambda x:x[1],reverse=True)
        report={'files':len(files),'bytes':sum(n for _,n in sizes),'largest10':sizes[:10],
                'pages':['/feeder/'+p for p in PAGES], 'rootUrls':root_urls,'relativeReferences':references,
                'offlineOnlyReferences':omitted,'forbiddenCheck':'PASS','secretCheck':'PASS',
                'sourceSiteConfig':(V7/'shared/site.js').read_text(encoding='utf-8'),
                'hashes':{p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
        # Audit reports belong next to site, so scripts and checks never enter the upload.
        reportpath=out.parent/(out.name+'-build-report.json')
        reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(f'PASS: {len(files)} files, {report["bytes"]:,} bytes ({report["bytes"]/1048576:.2f} MiB)')
        for name,size in sizes[:10]: print(f'{size:>10,}  {name}')
        print('Absolute URLs (all guarded):')
        for row in root_urls: print(f'  {row["file"]}:{row.get("line",1)} {row["url"]} -> {row["guard"]}')
        print('Report:',reportpath)
    except Exception:
        print('BUILD FAILED: do not upload this output directory.',file=sys.stderr)
        raise

if __name__=='__main__':
    try: main()
    except (ValueError,OSError) as e: print('ERROR:',e,file=sys.stderr);sys.exit(1)
