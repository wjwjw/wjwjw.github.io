# -*- coding: utf-8 -*-
"""
掌中灵 H5 游戏 —— 像素风图标生成器（唯一事实来源）
=====================================================
运行：  python build_icons.py
产出：  <id>.svg       16x16 逻辑像素，矢量，任意尺寸都锐利（shape-rendering=crispEdges）
        <id>.png       64x64  （启动器卡片 1x）
        <id>@2x.png    128x128（启动器预览面板 / 高清屏）
        preview.html   图标总览页（尺寸矩阵 + 明暗底对照 + 调色板 + 接入片段）

设计规范见同目录 SPEC.md。改图标只需改本文件的 ART / ICONS，然后重跑。

为什么用纯 stdlib 写 PNG：目标设备是老 Android WebView，图标必须是真·位图；
    这里手写 PNG 编码器（zlib + struct），不引入任何第三方依赖，任何 Python 3 都能跑。
"""

import os
import zlib
import struct

# ============================================================
# 一、统一调色板（跨全部图标共用，保证「一套」的观感）
# ============================================================
INK    = '#2c3650'   # 统一描边 / 暗面（取自各游戏内部配色的公共交集）
INK2   = '#46527a'   # 次级暗面
PAPER  = '#fffcf2'   # 亮面 / 主体（暖白，比纯白更贴合游戏内 #FFFCF2 的调子）
GOLD   = '#ffd166'   # 统一强调色（所有游戏都出现的暖黄）
RED    = '#e5484d'   # 苹果红（贪吃蛇专用）
RED_L  = '#ff9f9f'   # 苹果高光

GRID = 16            # 逻辑像素网格边长
PAD  = 2             # 底板内缩：主体可用区为 12x12


def hex2rgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb2hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(v)))) for v in rgb)


def mix(c1, c2, t):
    """c1 向 c2 混合 t（0..1）"""
    a, b = hex2rgb(c1), hex2rgb(c2)
    return rgb2hex(tuple(a[i] * (1 - t) + b[i] * t for i in range(3)))


# ============================================================
# 二、底板：所有图标共用的「贴纸」外形
# ------------------------------------------------------------
#   row0  ..KKKKKKKKKKKK..     2 段圆角
#   row1  .KBBBBBBBBBBBBK.     顶部 1px 高光带（光源在左上）
#   row2  .KAAAAAAAAAAAAK.  ┐
#    ...                    ├ 主体区 12x12（局部坐标 (0,0) 落在这里）
#   row13 .KAAAAAAAAAAAAK.  ┘
#   row14 .KaaaaaaaaaaaaK.     底部 1px 暗面
#   row15 ..KKKKKKKKKKKK..     2 段圆角
# ============================================================
def make_plate():
    plate = []
    plate.append('..' + 'K' * 12 + '..')
    plate.append('.K' + 'B' * 12 + 'K.')
    for _ in range(12):
        plate.append('.K' + 'A' * 12 + 'K.')
    plate.append('.K' + 'a' * 12 + 'K.')
    plate.append('..' + 'K' * 12 + '..')
    return plate


def compose(art):
    """把 12x12 主体叠到底板上，返回 16x16 字符网格"""
    plate = make_plate()
    grid = [list(r) for r in plate]
    for r in range(12):
        for c in range(12):
            ch = art[r][c]
            if ch != '.':
                grid[r + PAD][c + PAD] = ch
    return [''.join(r) for r in grid]


# ============================================================
# 三、九个图标
# ------------------------------------------------------------
# 字符表： . 透明 / K 描边 / D 次级暗 / W 亮面 / Y 金
#          A 主题色 / B 主题色高光 / a 主题色暗面 / R 苹果红 / r 苹果高光
# 主体一律落在 12x12 的 1..10 区间内，四周留 1px 呼吸位，避免贴到描边上。
# ============================================================
ICONS = [
    {
        'id': 'number-runner',
        'title': '数字跑酷',
        'subtitle': '三车道无尽跑酷 · 合并相同数字',
        'accent': '#ff8c42',
        'motive': '白色数字「2」+ 速度线',
        'note': '数字直接以亮面画在底板上（不加白块），笔画 2px 保证小尺寸不糊；右侧三道长短不一的速度线给「无尽奔跑」的运动感。',
        'art': [
            '............',
            '............',
            '..WWWWW.....',
            '.WW...WW.WW.',
            '.....WW.....',
            '....WW..WWW.',
            '...WW.......',
            '..WW.....WW.',
            '.WW.........',
            '.WWWWWWW....',
            '............',
            '............',
        ],
    },
    {
        'id': 'maze-challenge',
        'title': '迷宫闯关',
        'subtitle': '像素小冒险 · 方向键 / WASD 移动',
        'accent': '#5a8dee',
        'motive': '螺旋迷宫墙 + 金色主角',
        'note': '白色墙体压在蓝色底板上，走廊即底色；正中 2x2 金块是「你在这里」。',
        'art': [
            '............',
            '.WWWWW.WWWW.',
            '.W........W.',
            '.W.WWWWW..W.',
            '.W.W...W..W.',
            '.W.W.YYW..W.',
            '.W.W.YYW..W.',
            '.W.W...W..W.',
            '.W.WWWWW..W.',
            '.W........W.',
            '.WWWWWWWWWW.',
            '............',
        ],
    },
    {
        'id': 'spot-difference',
        'title': '火眼金睛',
        'subtitle': '找不同 · 方向键移动取景框，OK 标记',
        'accent': '#f2a33c',
        'motive': '放大镜 + 金色差异点',
        'note': '镜片用暗色，是全套里唯一的大暗面，金色四角星在暗底上极醒目 =「找到了」。',
        'art': [
            '............',
            '...KKKK.....',
            '..KWWKKK....',
            '.KWKYKKKK...',
            '.KKYYYKKK...',
            '.KKKYKKKK...',
            '.KKKKKKKK...',
            '..KKKKKK....',
            '...KKKK.....',
            '........KK..',
            '.........KK.',
            '............',
        ],
    },
    {
        'id': 'memory-match',
        'title': '记忆翻牌',
        'subtitle': '翻牌配对 · 预览-扣牌-方向键翻相同图案',
        'accent': '#8b6ce8',
        'motive': '两张错位牌：正面金星 + 背面金徽',
        'note': '左上那张是扣着的牌（背面小徽），右下那张是翻开的牌（金色四角星），错位叠放点出「翻」。',
        'art': [
            '............',
            '.....KKKKKK.',
            '.....KWWYYK.',
            '.KKKKKKKYYK.',
            '.KWWWWWKWWK.',
            '.KWWYWWKKKK.',
            '.KWYYYWK....',
            '.KYYYYYK....',
            '.KWYYYWK....',
            '.KWWYWWK....',
            '.KKKKKKK....',
            '............',
        ],
    },
    {
        'id': 'kids-quiz',
        'title': '小小达人',
        'subtitle': '认知问答 · 看图选答案，不识字也能玩',
        'accent': '#2ab7b0',
        'motive': '答题卡 + 深色问号',
        'note': '白卡 + 深色问号是全套里对比最高的一枚；问号底部留空一格再点出圆点，小尺寸下也不会糊成一团。',
        'art': [
            '............',
            '.KKKKKKKKKK.',
            '.KWWKKKKWWK.',
            '.KWKKWWKKWK.',
            '.KWWWWWKKWK.',
            '.KWWWWKKWWK.',
            '.KWWWKKWWWK.',
            '.KWWWWWWWWK.',
            '.KWWWKKWWWK.',
            '.KWWWWWWWWK.',
            '.KKKKKKKKKK.',
            '............',
        ],
    },
    {
        'id': 'puzzle-slide',
        'title': '拼图乐园',
        'subtitle': '滑动拼图 · 方向键把打乱的画推回原样',
        'accent': '#e0524f',
        'motive': '3x3 拼图板：中心空位 + 右下金色块',
        'note': '深色格线把 2x2 白格切成九宫格；中心那格露底色 = 空位，右下金格 = 正在推的块。',
        'art': [
            '............',
            '.KKKKKKKKKK.',
            '.KWWKWWKWWK.',
            '.KWWKWWKWWK.',
            '.KKKKKKKKKK.',
            '.KWWK..KWWK.',
            '.KWWK..KWWK.',
            '.KKKKKKKKKK.',
            '.KWWKWWKYYK.',
            '.KWWKWWKYYK.',
            '.KKKKKKKKKK.',
            '............',
        ],
    },
    {
        'id': 'snake',
        'title': '贪吃蛇',
        'subtitle': '吃苹果长大 · 方向键转弯，撞墙会穿过去',
        'accent': '#3fa96b',
        'motive': 'L 形蛇身（带眼）+ 红苹果',
        'note': '苹果红与绿底板互补，是全套里唯一用暖色撞色的一枚；苹果做成 5x4 的圆润轮廓 + 1px 果柄，蛇头两只暗眼定住朝向。',
        'art': [
            '............',
            '........K...',
            '.......RRR..',
            '......RrRRR.',
            '......RRRRR.',
            '.......RRR..',
            '...KWK......',
            '...WWW......',
            '.WWWWW......',
            '.WWWWW......',
            '..WWWW......',
            '............',
        ],
    },
    {
        'id': 'brick-3d',
        'title': '3D 俄罗斯方块',
        'subtitle': '基于 three.js 的 3D 俄罗斯方块，鼠标旋转视角',
        'accent': '#ec407a',
        'motive': '等距立方体（顶 / 左 / 右三面）',
        'note': '顶面亮、左面金、右面暗——三面三个明度台阶，小尺寸下也能读出「立体的方块」。',
        'art': [
            '............',
            '.....TT.....',
            '...TTTTTT...',
            '.TTTTTTTTTT.',
            '.LLTTTTTTXX.',
            '.LLLLTTXXXX.',
            '.LLLLLXXXXX.',
            '.LLLLLXXXXX.',
            '.LLLLLXXXXX.',
            '...LLLXXX...',
            '.....LX.....',
            '............',
        ],
    },
    {
        'id': 'coming-soon',
        'title': '新游戏待定',
        'subtitle': '开发中 · 敬请期待',
        'accent': '#8a8f98',
        'motive': '粗十字 + 金色中心',
        'note': '占位枚：中性灰底板不跟任何游戏抢眼，粗十字读作「还会长出新东西」。',
        'art': [
            '............',
            '.....WWW....',
            '.....WWW....',
            '.....WWW....',
            '.....WWW....',
            '.WWWYYYWWW..',
            '.WWWYYYWWW..',
            '.WWWYYYWWW..',
            '.....WWW....',
            '.....WWW....',
            '.....WWW....',
            '............',
        ],
    },
]

# 三维立方体用 T(顶) / L(左) / X(右) 三个面
# ⚠️ 不要复用 R：R 已经给了苹果红，字典里重复的键会静默覆盖，苹果会变成深色方块。
THREETONE = ('T', 'L', 'X')


def cmap_for(accent):
    """按主题色推导整套颜色映射"""
    light = mix(accent, PAPER, 0.42)          # 顶部高光带
    dark = mix(accent, INK, 0.30)             # 底部暗面
    return {
        'K': INK, 'D': INK2, 'W': PAPER, 'Y': GOLD,
        'A': accent, 'B': light, 'a': dark,
        'R': RED, 'r': RED_L,
        # 立方体三面：顶最亮、左中间、右最暗 -> 三个明度台阶读出体积
        'T': PAPER, 'L': GOLD, 'X': INK,
    }


# ============================================================
# 四、输出：SVG
# ============================================================
def grid_to_svg(grid, cmap):
    runs = {}
    for y in range(GRID):
        x = 0
        row = grid[y]
        while x < GRID:
            ch = row[x]
            if ch == '.':
                x += 1
                continue
            x2 = x
            while x2 + 1 < GRID and row[x2 + 1] == ch:
                x2 += 1
            runs.setdefault(cmap[ch], []).append((x, y, x2 - x + 1))
            x = x2 + 1
    parts = []
    # 固定顺序输出，保证重复构建产物字节一致（便于 git diff）
    for color in sorted(runs.keys()):
        d = ''.join('M%g %gh%gv1h-%gz' % (x, y, w, w) for (x, y, w) in runs[color])
        parts.append('<path fill="%s" d="%s"/>' % (color, d))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="64" height="64" shape-rendering="crispEdges" '
            'aria-hidden="true">%s</svg>' % (GRID, GRID, ''.join(parts)))


# ============================================================
# 五、输出：PNG（纯 stdlib 编码器，最近邻放大 = 真像素）
# ============================================================
def _png_chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))


def grid_to_png_bytes(grid, cmap, scale):
    w = GRID * scale
    rows = []
    for y in range(GRID):
        line = bytearray()
        for x in range(GRID):
            ch = grid[y][x]
            if ch == '.':
                line += b'\x00\x00\x00\x00'
            else:
                c = cmap[ch]
                line += bytes((int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16), 255))
        line *= scale                      # 横向最近邻放大
        for _ in range(scale):             # 纵向最近邻放大
            rows.append(b'\x00' + bytes(line))
    raw = b''.join(rows)
    png = b'\x89PNG\r\n\x1a\n'
    png += _png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, w, 8, 6, 0, 0, 0))
    png += _png_chunk(b'IDAT', zlib.compress(raw, 9))
    png += _png_chunk(b'IEND', b'')
    return png


# ============================================================
# 六、输出：总览页
# ============================================================
def build_preview(icons, colors_used):
    cards = []
    for it in icons:
        cards.append(
            '<article class="card" style="--accent:%s">'
            '<div class="hero"><img src="%s.svg" width="88" height="88" alt="%s"></div>'
            '<h3>%s</h3><p class="sub">%s</p>'
            '<p class="motive">%s</p>'
            '<p class="note">%s</p>'
            '<div class="sizes">'
            '<span><img src="%s.svg" width="64" height="64" alt=""><i>64</i></span>'
            '<span><img src="%s.svg" width="48" height="48" alt=""><i>48</i></span>'
            '<span><img src="%s.svg" width="32" height="32" alt=""><i>32</i></span>'
            '<span><img src="%s.svg" width="24" height="24" alt=""><i>24</i></span>'
            '<span><img src="%s.svg" width="16" height="16" alt=""><i>16</i></span>'
            '</div>'
            '<code class="fname">%s.svg · %s.png · %s@2x.png</code>'
            '</article>' % (
                it['accent'], it['id'], it['title'], it['title'], it['subtitle'],
                it['motive'], it['note'], it['id'], it['id'], it['id'], it['id'], it['id'],
                it['id'], it['id'], it['id']))

    swatches = ''.join(
        '<span class="sw"><i style="background:%s"></i><b>%s</b><em>%s</em></span>' % (hexv, name, hexv)
        for name, hexv in colors_used)

    config_lines = []
    for it in icons:
        config_lines.append(
            '  {\n'
            '    id: "%s",\n'
            '    icon: "../h5-games/assets/icons/%s.svg",\n'
            '    color: "%s"\n'
            '  },' % (it['id'], it['id'], it['accent']))

    # 用 token 替换而不是 % 格式化：模板里全是 CSS 的百分号
    html = PREVIEW_TMPL
    html = html.replace('{{CARDS}}', ''.join(cards))
    html = html.replace('{{SWATCHES}}', swatches)
    html = html.replace('{{CONFIG}}', '\n'.join(config_lines))
    html = html.replace('{{COUNT}}', str(len(icons)))
    return html


PREVIEW_TMPL = u"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>像素图标总览 · 掌中灵 H5 游戏</title>
<style>
:root{
  --page:#f4f2ec; --ink:#2c3650; --soft:#6b7280; --line:#ddd8cc; --card:#fffefb;
}
body.dark{
  --page:#0b0e1a; --ink:#eef2ff; --soft:#9aa3c0; --line:rgba(255,255,255,.12); --card:#121832;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--page); color:var(--ink); padding:34px 26px 60px;
  font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",Roboto,sans-serif;
  transition:background .2s ease,color .2s ease;
}
img{image-rendering:pixelated;image-rendering:-webkit-optimize-contrast;display:block}
.wrap{max-width:1180px;margin:0 auto}
header{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:.5px}
h1 small{display:block;font-size:14px;font-weight:400;color:var(--soft);letter-spacing:0}
.toggles{display:flex;gap:8px;flex-wrap:wrap}
button{
  font:inherit;font-size:13px;padding:7px 14px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line);background:var(--card);color:var(--ink);transition:.15s;
}
button:hover{border-color:var(--ink)}
button.on{background:var(--ink);color:var(--page);border-color:var(--ink)}
section{margin-top:34px}
h2{font-size:16px;margin:0 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line);font-weight:700}
h2 em{font-style:normal;font-weight:400;color:var(--soft);font-size:13px;margin-left:8px}
.sws{display:flex;flex-wrap:wrap;gap:10px}
.sw{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);
    border-radius:10px;padding:7px 12px 7px 8px}
.sw i{width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,0,0,.14);display:block}
.sw b{font-size:12.5px;font-weight:600}
.sw em{font-style:normal;font-size:11.5px;color:var(--soft);font-family:ui-monospace,Menlo,Consolas,monospace}
.grid{display:flex;flex-wrap:wrap;margin:0 -8px}
.card{
  width:calc(33.333% - 16px);margin:8px;background:var(--card);border:1px solid var(--line);
  border-radius:14px;padding:16px 16px 14px;position:relative;overflow:hidden;
}
.card::after{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent)}
.card .hero{display:flex;justify-content:center;padding:8px 0 12px}
.card h3{margin:0 0 2px;font-size:16px}
.card .sub{margin:0;font-size:12.5px;color:var(--soft);min-height:34px}
.card .motive{margin:8px 0 4px;font-size:12.5px;font-weight:600;color:var(--accent)}
.card .note{margin:0 0 12px;font-size:12px;color:var(--soft);line-height:1.6;min-height:58px}
.sizes{display:flex;align-items:flex-end;gap:12px;padding:10px 0 8px;border-top:1px dashed var(--line)}
.sizes span{display:flex;flex-direction:column;align-items:center;gap:4px}
.sizes i{font-style:normal;font-size:10.5px;color:var(--soft);font-family:ui-monospace,Menlo,Consolas,monospace}
.fname{display:block;font-size:11px;color:var(--soft);font-family:ui-monospace,Menlo,Consolas,monospace;
       word-break:break-all;line-height:1.6}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;overflow:auto;
    font:12.5px/1.75 ui-monospace,Menlo,Consolas,monospace;color:var(--ink);margin:0}
.spec{display:flex;flex-wrap:wrap;gap:10px}
.spec div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;font-size:13px}
.spec b{display:block;font-size:11.5px;color:var(--soft);font-weight:600;letter-spacing:.4px}
footer{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--soft)}
@media (max-width:900px){.card{width:calc(50% - 16px)}}
@media (max-width:600px){.card{width:calc(100% - 16px)}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>像素图标总览 · 掌中灵 H5 游戏
      <small>16×16 逻辑像素 · 统一底板 / 统一描边 / 统一高光 · 共 {{COUNT}} 枚</small>
    </h1>
    <div class="toggles">
      <button id="btnBg">切换明 / 暗底</button>
      <button id="btnGrid">显示像素网格</button>
    </div>
  </header>

  <section>
    <h2>规格 <em>所有图标共用同一套几何，只换主题色与主体</em></h2>
    <div class="spec">
      <div><b>网格</b>16 × 16 逻辑像素</div>
      <div><b>主体可用区</b>12 × 12（四周留 1px 呼吸位）</div>
      <div><b>底板</b>2 段圆角方贴纸</div>
      <div><b>描边</b>1px 统一深色 #2c3650</div>
      <div><b>光源</b>左上：顶部 1px 高光带 + 底部 1px 暗面</div>
      <div><b>产出</b>SVG（矢量）+ PNG 64 / 128</div>
    </div>
  </section>

  <section>
    <h2>调色板 <em>四色基座 + 每枚一个主题色</em></h2>
    <div class="sws">{{SWATCHES}}</div>
  </section>

  <section>
    <h2>图标 <em>每枚下方列出 64 / 48 / 32 / 24 / 16 px 的实际渲染</em></h2>
    <div class="grid">{{CARDS}}</div>
  </section>

  <section>
    <h2>接入启动器 <em>把 config.js 里各游戏的 icon 字段换成对应 SVG 路径即可</em></h2>
    <pre>{{CONFIG}}</pre>
  </section>

  <footer>由 <code>build_icons.py</code> 生成 · 改图标只需改脚本里的 ART 网格后重跑</footer>
</div>
<script>
(function () {
  var body = document.body;
  document.getElementById('btnBg').onclick = function () {
    body.classList.toggle('dark');
  };
  var on = false;
  document.getElementById('btnGrid').onclick = function () {
    on = !on;
    this.classList.toggle('on', on);
    var imgs = document.querySelectorAll('.card img');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].style.backgroundImage = on
        ? 'linear-gradient(45deg, rgba(128,128,128,.30) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.30) 75%),'
        + 'linear-gradient(45deg, rgba(128,128,128,.30) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.30) 75%)'
        : 'none';
      imgs[i].style.backgroundSize = on ? '4px 4px, 4px 4px' : 'auto';
      imgs[i].style.backgroundPosition = on ? '0 0, 2px 2px' : '0 0';
    }
  };
})();
</script>
</body>
</html>
"""


# ============================================================
# 七、主流程
# ============================================================
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for it in ICONS:
        cmap = cmap_for(it['accent'])
        grid = compose(it['art'])
        for r in grid:
            assert len(r) == GRID, '%s 行宽错误: %r' % (it['id'], r)
        assert len(grid) == GRID
        # 兜底：网格里出现的每个字符都必须在调色板里有定义，
        # 否则（例如字符打错、或 cmap 里键重名被覆盖）会静默画成透明/错色。
        unknown = sorted(set(''.join(grid)) - set(cmap) - {'.'})
        assert not unknown, '%s 出现未定义字符: %s' % (it['id'], unknown)
        # 主体必须留在 12x12 的 1..10 区间内，避免贴到统一描边上
        for r in range(12):
            for c in range(12):
                if it['art'][r][c] != '.':
                    assert 0 <= r <= 11 and 0 <= c <= 11

        with open(os.path.join(here, it['id'] + '.svg'), 'w', encoding='utf-8') as f:
            f.write(grid_to_svg(grid, cmap))
        with open(os.path.join(here, it['id'] + '.png'), 'wb') as f:
            f.write(grid_to_png_bytes(grid, cmap, 4))       # 64
        with open(os.path.join(here, it['id'] + '@2x.png'), 'wb') as f:
            f.write(grid_to_png_bytes(grid, cmap, 8))       # 128
        print('  ok  %-18s %s' % (it['id'], it['accent']))

    colors_used = [
        ('描边 / 暗面', INK), ('次级暗面', INK2),
        ('亮面 / 主体', PAPER), ('强调金', GOLD),
    ] + [(it['title'], it['accent']) for it in ICONS] + [('苹果红', RED)]

    with open(os.path.join(here, 'preview.html'), 'w', encoding='utf-8') as f:
        f.write(build_preview(ICONS, colors_used))
    print('\n  共 %d 枚图标 + preview.html' % len(ICONS))


if __name__ == '__main__':
    main()
