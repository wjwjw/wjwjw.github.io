#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
推箱子关卡生成器 / 校验器（照 maze-challenge 的 build_levels.py 惯例）

用法：
    python build_levels.py            # 校验 SRC 全部关卡并生成 js/levels.js

关卡即数据（字符网格，与游戏内 js/levels.js 同一映射）：
    #  墙      @  玩家    +  玩家在目标点
    $  箱子    .  目标点  *  箱子在目标点      空格  地板

校验内容：
  1. 每关矩形补齐、必须完全被墙包住（边界外不可逃逸）；
  2. 箱子数 == 目标点数，玩家恰好 1 个，所有箱子/目标点与玩家在同一连通区域；
  3. BFS(玩家, 箱子集合) 全状态搜索（含角落死锁剪枝）确认可解，
     并求出 (最少推数, 同推数下最少步数) 的参考解 -> 写入 par / parPushes。

生成物 js/levels.js 带「自动生成」头，不要手改；改关卡请改本文件 SRC 再重新生成。
"""
import json
import os
import sys
from heapq import heappush, heappop

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "js", "levels.js")

WALL, BOX, GOAL, BOX_GOAL, PLAYER, PLAYER_GOAL, FLOOR = "#", "$", ".", "*", "@", "+", " "
DIRS = ((0, -1), (0, 1), (-1, 0), (1, 0))  # 上 下 左 右

# ============================================================
# 关卡源数据（18 关，由易到难）
# ============================================================
SRC = [
    ("L1 直推入门", [
        "########",
        "#      #",
        "# @$.  #",
        "#      #",
        "########",
    ]),
    ("L2 绕到箱后", [
        "########",
        "#      #",
        "# .    #",
        "#  $   #",
        "# @    #",
        "#      #",
        "########",
    ]),
    ("L3 双箱开工", [
        "########",
        "#      #",
        "# .$ . #",
        "#  $   #",
        "# @    #",
        "#      #",
        "########",
    ]),
    ("L4 三层小楼", [
        "#########",
        "#   @   #",
        "# ##### #",
        "# #...# #",
        "# #$$$# #",
        "# #   # #",
        "#       #",
        "#########",
    ]),
    ("L5 一排三箱", [
        "#########",
        "#       #",
        "#  $$$  #",
        "#  ...  #",
        "#   @   #",
        "#       #",
        "#########",
    ]),
    ("L6 十字路口", [
        "#########",
        "#       #",
        "#   .   #",
        "#  $.$  #",
        "#  .$   #",
        "#   @   #",
        "#       #",
        "#########",
    ]),
    ("L7 天窗小院", [
        "#########",
        "#   #   #",
        "# $   . #",
        "#   #   #",
        "###   ###",
        "#   @   #",
        "#########",
    ]),
    ("L8 仓库转角", [
        "##########",
        "#        #",
        "#  ####  #",
        "#  #  #  #",
        "#  # $   #",
        "#  #  @  #",
        "#  ####  #",
        "#      . #",
        "##########",
    ]),
    ("L9 四角归位", [
        "#########",
        "#       #",
        "# .$ $. #",
        "#  $ $  #",
        "# .   . #",
        "#   @   #",
        "#########",
    ]),
    ("L10 岔口运货", [
        "##########",
        "#        #",
        "# $. $ . #",
        "#  . $   #",
        "#  @     #",
        "#        #",
        "##########",
    ]),
    ("L11 中庭四箱", [
        "###########",
        "#         #",
        "#  .   .  #",
        "# $$@$$   #",
        "#  .   .  #",
        "#         #",
        "###########",
    ]),
    ("L12 三柱门", [
        "###########",
        "#         #",
        "# #.#.#.# #",
        "# #$ $ $# #",
        "#    @    #",
        "#         #",
        "###########",
    ]),
    ("L13 穿堂过巷", [
        "###########",
        "#     #   #",
        "# $ $   . #",
        "#  #  # $ #",
        "#  .  # . #",
        "#  @      #",
        "###########",
    ]),
    ("L14 田字四箱", [
        "###########",
        "#         #",
        "# .$   $. #",
        "#   ###   #",
        "# .$ @ $. #",
        "#         #",
        "###########",
    ]),
    ("L15 五箱大班", [
        "###########",
        "#         #",
        "# .$...$. #",
        "# $  $  $ #",
        "#    @    #",
        "#         #",
        "###########",
    ]),
    ("L16 回字迷宫", [
        "###########",
        "#         #",
        "# ####### #",
        "# #     # #",
        "# # $$$ # #",
        "# # .@. # #",
        "# #     # #",
        "# # ## ## #",
        "#    .    #",
        "###########",
    ]),
    ("L17 中央广场", [
        "############",
        "#          #",
        "# . $..$ . #",
        "#  $ $@$ $ #",
        "#   .   .  #",
        "#          #",
        "############",
    ]),
    ("L18 九宫回廊", [
        "############",
        "#          #",
        "# ## ## ## #",
        "# $  ..  $ #",
        "# ## ## ## #",
        "# $  ..  $ #",
        "# ## ## ## #",
        "#     @    #",
        "############",
    ]),
]

MAX_STATES = 3000000  # 状态数上限，防止失控（正常小关远用不到）


def fail(msg):
    print("[build_levels] 错误: " + msg)
    sys.exit(1)


def parse(name, lines):
    w = max(len(r) for r in lines)
    rows = [list(r.ljust(w)) for r in lines]
    h = len(rows)
    walls, boxes, goals = set(), set(), set()
    player = None
    for y in range(h):
        for x in range(w):
            c = rows[y][x]
            if c == WALL:
                walls.add((x, y))
            elif c == BOX:
                boxes.add((x, y))
            elif c == GOAL:
                goals.add((x, y))
            elif c == BOX_GOAL:
                boxes.add((x, y)); goals.add((x, y))
            elif c == PLAYER:
                player = (x, y)
            elif c == PLAYER_GOAL:
                player = (x, y); goals.add((x, y))
            elif c != FLOOR:
                fail("%s: 非法字符 %r @(%d,%d)" % (name, c, x, y))
    if player is None:
        fail(name + ": 缺少玩家 @")
    if not boxes:
        fail(name + ": 缺少箱子 $")
    if len(boxes) != len(goals):
        fail("%s: 箱子 %d 个 != 目标点 %d 个" % (name, len(boxes), len(goals)))
    # 边界必须全是墙
    for x in range(w):
        for y in (0, h - 1):
            if (x, y) not in walls:
                fail("%s: 边界 (%d,%d) 不是墙，地图未封死" % (name, x, y))
    for y in range(h):
        for x in (0, w - 1):
            if (x, y) not in walls:
                fail("%s: 边界 (%d,%d) 不是墙，地图未封死" % (name, x, y))
    # 玩家可达区域必须覆盖所有箱子与目标点
    seen = {player}
    stack = [player]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in DIRS:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in walls and (nx, ny) not in seen:
                seen.add((nx, ny))
                stack.append((nx, ny))
    for b in boxes:
        if b not in seen:
            fail("%s: 箱子 %s 在玩家不可达区域" % (name, b))
    for g in goals:
        if g not in seen:
            fail("%s: 目标点 %s 在玩家不可达区域" % (name, g))
    return {"w": w, "h": h, "walls": walls, "boxes": boxes, "goals": goals, "player": player}


def compute_safe(lv):
    """反向拉箱 BFS：从每个目标点倒推「箱子可能被推到目标」的格子集合，
    并顺带得到每个格子到最近目标点的最少推数（拉箱距离，作 A* 启发式）。

    一次推箱：箱子 p -> p+d，玩家站在 p-d。反过来，箱子在 g 且 g-d、g-2d
    都不是墙，说明箱子可以从 g-d 被推到 g。所有目标点出发做这个倒推：
      · 集合之外的格子，箱子一旦进去就永远到不了任何目标（死角死锁），剪枝；
      · 距离 dist[c] 是「箱子在 c 时到最近目标至少要几次推」的下界，
        满足三角不等式（一致启发式），A* 首次弹出即最优。
    """
    walls, goals = lv["walls"], lv["goals"]
    dist = {g: 0 for g in goals}
    queue = list(goals)
    while queue:
        gx, gy = queue.pop(0)
        for dx, dy in DIRS:
            bx, by = gx - dx, gy - dy          # 上一次推箱时箱子的位置
            px, py = gx - 2 * dx, gy - 2 * dy  # 当时玩家站立的位置
            if (bx, by) in walls or (px, py) in walls:
                continue
            if (bx, by) not in dist:
                dist[(bx, by)] = dist[(gx, gy)] + 1
                queue.append((bx, by))
    return dist


def solve(lv):
    """A* 最小化 (推数, 步数) 字典序。返回 (pushes, moves) 或 None。"""
    w, h, walls, goals = lv["w"], lv["h"], lv["walls"], lv["goals"]
    pulldist = compute_safe(lv)
    BIG = 1 << 30

    def hval(boxes):
        s = 0
        for b in boxes:
            s += pulldist.get(b, BIG)
        return s

    start = (lv["player"], frozenset(lv["boxes"]))
    # 键 = (g推 + h推, g步, seq)；启发式一致 -> 状态首次弹出即 (推数,步数) 最优
    heap = [(hval(start[1]), 0, 0, 0, start[0], start[1])]
    seen = {start: (0, 0)}
    seq = 0
    pops = 0
    while heap:
        _, gm, _, gp, player, boxes = heappop(heap)
        pops += 1
        if pops > MAX_STATES:
            return None
        if boxes <= goals:  # 全部到位
            return (gp, gm)
        px, py = player
        for dx, dy in DIRS:
            nx, ny = px + dx, py + dy
            if (nx, ny) in walls or not (0 <= nx < w and 0 <= ny < h):
                continue
            if (nx, ny) in boxes:
                bx, by = nx + dx, ny + dy
                if (bx, by) in walls or (bx, by) in boxes:
                    continue
                if not (0 <= bx < w and 0 <= by < h):
                    continue
                if (bx, by) not in pulldist:
                    continue  # 死角/死线，剪枝
                nboxes = frozenset((boxes - {(nx, ny)}) | {(bx, by)})
                nstate = ((nx, ny), nboxes)
                ngp, ngm = gp + 1, gm + 1
            else:
                nboxes = boxes
                nstate = ((nx, ny), boxes)
                ngp, ngm = gp, gm + 1
            old = seen.get(nstate)
            if old is not None and (ngp, ngm) >= old:
                continue
            seen[nstate] = (ngp, ngm)
            seq += 1
            heappush(heap, (ngp + hval(nboxes), ngm, seq, ngp, nstate[0], nstate[1]))
    return None


def main():
    out = []
    for idx, (name, lines) in enumerate(SRC):
        lv = parse(name, lines)
        r = solve(lv)
        if r is None:
            fail("%s: 无解（BFS 搜索完毕）" % name)
        pushes, moves = r
        out.append({
            "name": name,
            "grid": list(lines),
            "par": moves,
            "parPushes": pushes,
        })
        print("  [%2d] %-10s %2dx%-2d  箱x%d  par=%3d步 %2d推" % (
            idx + 1, name.split(" ")[0], lv["w"], lv["h"], len(lv["boxes"]), moves, pushes))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body = json.dumps(out, ensure_ascii=False, indent=1)
    js = (
        "// 自动生成：build_levels.py（推箱子关卡，BFS 已校验可解）—— 勿手改，\n"
        "// 改关卡请改 build_levels.py 的 SRC 后重新运行：python build_levels.py\n"
        "// 字符: # 墙  @ 玩家  + 玩家在目标  $ 箱子  * 箱子在目标  . 目标点  空格 地板\n"
        "// par=参考步数（最优解的移动次数），parPushes=同一最优解的推箱次数\n"
        "// 用 var 而非 const：目标设备 WebView ≈ Chromium 47，见 ../../docs/STANDARD.md §6\n"
        "var LEVELS = " + body + ";\n"
    )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    print("[build_levels] %d 关全部可解，已生成 %s" % (len(out), os.path.relpath(OUT, HERE)))


if __name__ == "__main__":
    main()
