#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TransitLab · 界面简化 一键安装/卸载
================================
改动内容（无侵入，可随时完全还原）：
  1. 新增 shared/tl-simplify.css + shared/tl-simplify.js 两个文件
  2. 六个关卡页各加 2 行引用（1 行 <link> + 1 行 <script>）
效果：
  · 顶部导航栏上下留白等距、不越界
  · 左右栏次要信息自动折成折叠条（规则/图例/逐年表/去向榜/调度日志…）
  · 原本压在地图上的两张卡（年份进度、今年说明）搬进右栏顶部，地图零遮挡

用法：
  python3 apply.py                     # 默认仓库 ~/Documents/GitHub/transitlab-hk/game-feeder/v7
  python3 apply.py --repo /path/to/v7  # 指定仓库路径
  python3 apply.py --dry-run           # 只看会改什么，不写文件
  python3 apply.py --undo              # 完全还原（删 2 行 + 删 2 个文件）

装完立即生效：刷新浏览器即可看到变化；`git diff --stat` 能看到改动清单。
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

DEFAULT_REPO = os.path.expanduser('~/Documents/GitHub/transitlab-hk/game-feeder/v7')
PAGES = ['mode1-bus', 'mode2-metro', 'mode3-roads', 'mode4-tod', 'mode4-bus', 'mode5-sandbox']
CSS_TAG = '<link rel="stylesheet" href="../shared/tl-simplify.css">'
JS_TAG = '<script src="../shared/tl-simplify.js"></script>'
MARK = 'tl-simplify'


def patch_page(path, dry):
    s = open(path, encoding='utf-8').read()
    if MARK in s:
        return 'skip（已有）'
    s2, n1 = re.subn(r'(<link rel="stylesheet" href="\.\./shared/style\.css">)', r'\1' + CSS_TAG, s, count=1)
    if n1 != 1:
        return 'FAIL: 找不到 shared/style.css 引用'
    s3 = s2.replace('</body>', JS_TAG + '</body>', 1)
    if not dry:
        open(path, 'w', encoding='utf-8').write(s3)
    return 'patched（+2 行）'


def unpatch_page(path, dry):
    s = open(path, encoding='utf-8').read()
    if MARK not in s:
        return 'skip（本来就没有）'
    s = s.replace(CSS_TAG, '').replace(JS_TAG, '')
    if not dry:
        open(path, 'w', encoding='utf-8').write(s)
    return 'removed（-2 行）'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=DEFAULT_REPO)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--undo', action='store_true')
    a = ap.parse_args()
    repo = a.repo
    if not os.path.isdir(repo):
        print('❌ 找不到仓库目录：', repo)
        print('   用 --repo 指定 v7 所在路径')
        sys.exit(1)
    shared = os.path.join(repo, 'shared')
    here = os.path.dirname(os.path.abspath(__file__))

    print(('DRY-RUN ' if a.dry_run else '') + ('卸载' if a.undo else '安装') + ' →', repo)

    if a.undo:
        for p in PAGES:
            f = os.path.join(repo, p, 'index.html')
            if os.path.isfile(f):
                print('  ', p, unpatch_page(f, a.dry_run))
        for f in ('tl-simplify.css', 'tl-simplify.js'):
            t = os.path.join(shared, f)
            if os.path.isfile(t):
                if not a.dry_run:
                    os.remove(t)
                print('   删除 shared/' + f)
        print('✅ 已还原')
        return

    for f in ('tl-simplify.css', 'tl-simplify.js'):
        src = os.path.join(here, f)
        if not os.path.isfile(src):
            print('❌ 缺少', src, '——请把本脚本和两个文件放在同一目录')
            sys.exit(1)
        dst = os.path.join(shared, f)
        print('   复制', f, '→ shared/')
        if not a.dry_run:
            shutil.copy2(src, dst)

    for p in PAGES:
        f = os.path.join(repo, p, 'index.html')
        if not os.path.isfile(f):
            print('  ', p, 'skip（没有 index.html）')
            continue
        print('  ', p, patch_page(f, a.dry_run))

    if not a.dry_run:
        try:
            out = subprocess.run(['git', '-C', repo, 'diff', '--stat'], capture_output=True, text=True, timeout=10)
            print('\ngit diff --stat：')
            print(out.stdout or '（无改动？检查上面输出）')
        except Exception:
            pass
    print('✅ 完成。刷新浏览器即可看到：导航栏上下等距、左右栏折叠、地图上无遮挡卡片。')


if __name__ == '__main__':
    main()


