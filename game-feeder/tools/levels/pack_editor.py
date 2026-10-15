"""The level editors as one zip for teammates (2026-10-15): the bundled single files (python game-feeder/v7/build.py first)
in their folders, so «▶ Test play» finds the game pages next door, plus a short how-to. Nothing else of the project.
Run: python game-feeder/tools/levels/pack_editor.py [out.zip]   (default: the Desktop)"""
import sys, zipfile
from pathlib import Path

V7 = Path(__file__).resolve().parents[2] / 'v7'
FILES = ['开始.html', 'editor/关卡编辑器.html', 'mode1-bus/模式1-关卡编辑器.html', 'mode1-bus/模式1-车站与步行.html',
         'mode2-metro/模式2-地铁.html', 'mode3-roads/模式3-路会塞.html', 'mode4-tod/模式4-站旁开发.html']
HOWTO = """TransitLab 關卡編輯器（給組員）

一、打開
  解壓後，雙擊「TransitLab/editor/关卡编辑器.html」（第二、三、四關），
  或「TransitLab/mode1-bus/模式1-关卡编辑器.html」（第一關 車站與步行）。兩個編輯器頂上可以互相切換。
  用 Chrome 或 Edge。不用裝任何東西，不用上網也能用（上網時字體比較好看）。

二、做一關
  1. 頂上選玩法：01 車站與步行、02 地鐵、03 路會塞、04 站旁開發。
  2. 畫地圖：屋苑（人從這裡出門）、去處（市中心、就業區）、河；第三關加道路和現有港鐵線，第四關加空地。
     點一個東西，右邊可以改名字和數字。「從這裡開始」可以拿現有的關卡來改。
     河：勾「河擋住走路」，人就不能走過去，只能坐地鐵或開車過河。
  3. 右邊填「關卡資料」：標題、開場兩句（玩家一進來先看到）、在全港地圖上放在哪個站、作者、數字從哪裡來。
  4. 按「▶ 試玩」自己玩一次（會用真的遊戲頁打開）；按「機器人試算」看難不難，覺得可以就按「用這個門檻」。
  5. 按「導出 .json」。

三、交
  把你所有的 .json 壓成一個 zip，發給發起人。Claude 會檢查、定最後的門檻、做 AI 示範、放進遊戲。
  請在「數字從哪裡來」寫清楚人數、吸引力是怎麼定的（查了什麼資料，還是估的）。

注意：編輯器把正在做的關卡存在這台電腦的瀏覽器裡；換電腦或清瀏覽器資料就沒了——做完記得導出。
"""

def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Desktop' / 'TransitLab关卡编辑器-给组员.zip'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            src = V7 / f
            assert src.exists(), f'missing {src}: run python game-feeder/v7/build.py first'
            z.write(src, 'TransitLab/' + f)
        z.writestr('TransitLab/先看我-怎么做关卡.txt', HOWTO.encode('utf-8'))
    print('written', out, f'{out.stat().st_size // 1024} KB', len(FILES) + 1, 'files')

if __name__ == '__main__':
    main()
