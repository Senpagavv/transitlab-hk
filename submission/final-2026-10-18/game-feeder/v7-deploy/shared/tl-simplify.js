/* ==========================================================================
   TransitLab · 页面信息简化（tl-simplify.js）
   作用：把左右栏的次要说明区块自动折成 <details class="tl-fold">，默认收起：
        · 左栏：三條規則、怎麼看（图例）
        · 右栏：潮汐表/逐年表、大家去哪裡/變化最大、調度提示
   原则：一条信息不删——全部折起、点开即回；目标/工具/控制按钮一律不动。
   实现：按 data-i18n 键识别区块头，原节点原样搬进折叠体（i18n 切语言后
        文案仍自动更新）。不依赖任何框架；删除本文件即完全恢复原状。
   ========================================================================== */
(function () {
  'use strict';

  /* 折叠哪些区块：区块头元素的 data-i18n 键（左右栏通用） */
  var FOLD = {
    'g.rules': 1, 'm2.rulesH3': 1, 'r3.rulesH3': 1, 'b4.rulesH': 1, 'm5.rulesH': 1, // 三條規則
    'g.read': 1,                                                                     // 怎麼看（图例）
    'g.tide': 1, 'g.habit': 1, 'g.groups': 1,                                        // 潮汐表/习惯/三种人
    'm2.yearsH': 1, 'r3.yearsH': 1,                                                  // 逐年表
    'm2.whereH2': 1, 'r3.roadsH2': 1, 'b4.roadsH': 1, 'm5.topRoads': 1,              // 大家去哪裡/變化最大
    'g.log': 1,                                                                      // 調度提示
    'm5.areas': 1                                                                    // 片區
  };
  /* 折叠体的“延续元素”：区块头之后这些兄弟节点跟着进同一个折叠体 */
  function cont(el) {
    if (el.hidden) return true;
    var t = el.tagName, c = el.classList;
    if (t === 'OL' || t === 'UL' || t === 'P' || t === 'TABLE' || t === 'HR') return true;
    return c.contains('legend') || c.contains('tidekey') || c.contains('roadbox') ||
           c.contains('areas') || c.contains('note') || c.contains('mini') || c.contains('gleg');
  }

  function key(lbl) { return lbl.getAttribute('data-i18n') || lbl.getAttribute('data-i18n-html') || ''; }

  function simplify(side) {    if (!side || side.dataset.tlDone) return;
    side.dataset.tlDone = '1';
    var kids = Array.prototype.slice.call(side.children);
    kids.forEach(function (el) {
      var isRow = el.classList.contains('row');
      var head = null;
      if (el.classList.contains('lbl') && FOLD[key(el)]) head = el;
      else if (isRow) {
        var lbl = el.querySelector('.lbl[data-i18n],.lbl[data-i18n-html]');
        if (lbl && FOLD[key(lbl)]) head = lbl;
      }
      if (!head) return;

      var d = document.createElement('details');
      d.className = 'tl-fold';
      var sum = document.createElement('summary');
      var body = document.createElement('div');
      body.className = 'tl-fold-body';
      var next = el.nextSibling;              /* 先记位：折叠体插到未收编内容之前 */

      if (isRow) {
        /* 整行改成 summary（保留 row 布局与行内 chip；chip 展开后隐藏） */
        var chip = el.querySelector('.chip');
        if (chip) chip.classList.add('tl-fold-chip');
        var s2 = document.createElement('summary');
        s2.className = el.className;
        while (el.firstChild) s2.appendChild(el.firstChild);
        sum = s2;
        side.removeChild(el);                  /* 空壳行移除 */
      } else {
        sum.appendChild(head);                 /* lbl 进 summary */
      }
      var sib = next;
      for (;;) {
        while (sib && sib.nodeType === 3 && !sib.textContent.trim()) sib = sib.nextSibling; /* 跳过空白 */
        if (sib && sib.nodeType === 1 && cont(sib)) { var nx = sib.nextSibling; body.appendChild(sib); sib = nx; continue; }
        break;
      }
      d.appendChild(sum);
      if (body.childNodes.length) d.appendChild(body);
      side.insertBefore(d, sib);
    });
  }

  /* 把原本压在地图上的两张卡（年份/进度、今年说明）搬到右栏顶部：
     地图上从此没有任何遮挡卡，卡片也不会“点也点不掉” */
  function liftMapCards() {
    var plate = document.querySelector('.mapplate');
    var aside = document.querySelector('aside.side.right');
    if (!plate || !aside || aside.querySelector('.tl-mapcards')) return;
    var cards = Array.prototype.filter.call(plate.children, function (c) {
      return c.classList && (c.classList.contains('clockbox') || c.classList.contains('lanebox'));
    });
    if (!cards.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'tl-mapcards';
    cards.forEach(function (c) { wrap.appendChild(c); });
    aside.insertBefore(wrap, aside.firstChild);
  }

  function run() {
    liftMapCards();
    document.querySelectorAll('aside.side').forEach(simplify);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  /* 切语言无需重建：summary 里就是原 lbl 节点，data-i18n 会自己刷新文案 */
})();
