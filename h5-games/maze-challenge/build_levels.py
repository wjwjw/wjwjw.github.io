#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 maze-challenge/js/levels.js 并做"模拟器级"BFS 校验。

与引擎 engine.js 完全对齐的移动规则：
  - 墙/F/I/越界：阻挡，不前进
  - 地刺 S：阻挡 + 扣血，不前进（不可踏入）
  - 香蕉 B：踏入后朝面向前进 1；落点若是香蕉则连锁
  - 弹簧 P：踏入后朝面向反方向退后 2；落点若是香蕉/弹簧则继续连锁
  - 上述推力撞墙/F/I 停止；撞 S 则扣血并停在之前一格

校验项：
  conn        : 是否存在任意（含受伤）可通关路线（@→E 连通）
  safe        : 是否存在"零伤"可通关路线（设计支柱：每关必有安全路线）
  avoid_push  : 是否存在"完全不踩 B/P"的路线 —— 若 safe 可达而 avoid_push 不可达，
                说明该关"必须依赖香蕉/弹簧特性"才通关（标记为 GATED）
  monsters_ok : 怪兽路径不落在墙上
"""
import json, os
from collections import deque

DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
OPP = {"up": "down", "down": "up", "left": "right", "right": "left"}
ALLDIRS = ["up", "down", "left", "right"]
WALLS = {"#", "F", "I"}

def build(N, center_rows, monsters=None):
    c = N - 4
    assert len(center_rows) == c and all(len(r) == c for r in center_rows), f"center must be {c}x{c}"
    grid = []
    for y in range(N):
        row = []
        for x in range(N):
            if y == 0 or y == N - 1 or x == 0 or x == N - 1:
                row.append("#")
            elif y == 1 or y == N - 2 or x == 1 or x == N - 2:
                if x == 1 and y == 1:
                    row.append("@")
                elif x == N - 2 and y == N - 2:
                    row.append("E")
                else:
                    row.append(".")
            else:
                row.append(center_rows[y - 2][x - 2])
        grid.append("".join(row))
    return grid, (monsters or [])

# ---------- 移动模拟（与 engine.resolveForced 对齐） ----------
def step(grid, pos, direction, forbid_push=False):
    """返回 (新位置, 是否扣血)。forbid_push=True 时把 B/P 当墙。"""
    H, W = len(grid), len(grid[0])
    x, y = pos
    dx, dy = DIRS[direction]
    nx, ny = x + dx, y + dy
    if ny < 0 or ny >= H or nx < 0 or nx >= W:
        return (pos, False)
    t = grid[ny][nx]
    if t in WALLS:
        return (pos, False)
    if forbid_push and t in ("B", "P"):
        return (pos, False)
    if t == "S":
        return (pos, True)   # 地刺：扣血不前进
    # 踏入目标格
    px, py = nx, ny
    dmg = False
    guard = 0
    cur = direction
    while guard < 64:
        guard += 1
        c = grid[py][px]
        if c == "B" and not forbid_push:
            ax, ay = px + DIRS[cur][0], py + DIRS[cur][1]
            if ay < 0 or ay >= H or ax < 0 or ax >= W:
                break
            at = grid[ay][ax]
            if at in WALLS:
                break
            if at == "S":
                dmg = True; break
            px, py = ax, ay
            continue
        elif c == "P" and not forbid_push:
            b = OPP[cur]
            bx, by = DIRS[b][0], DIRS[b][1]
            steps = 0
            while steps < 2:
                ax, ay = px + bx, py + by
                if ay < 0 or ay >= H or ax < 0 or ax >= W:
                    break
                at = grid[ay][ax]
                if at in WALLS:
                    break
                if at == "S":
                    dmg = True; break
                px, py = ax, ay; steps += 1
            continue
        else:
            break
    return ((px, py), dmg)

def _reach(grid, start, goal, forbid_push, require_safe):
    seen = {start}
    q = deque([start])
    while q:
        pos = q.popleft()
        if pos == goal:
            return True
        for d in ALLDIRS:
            npos, dmg = step(grid, pos, d, forbid_push)
            if require_safe and dmg:
                continue
            if npos not in seen:
                seen.add(npos); q.append(npos)
    return False

def find(grid, ch):
    return [(x, y) for y, r in enumerate(grid) for x, c in enumerate(r) if c == ch]

def validate(name, grid, monsters):
    starts, exits = find(grid, "@"), find(grid, "E")
    conn = _reach(grid, starts[0], exits[0], False, False)
    safe = _reach(grid, starts[0], exits[0], False, True)
    avoid_push = _reach(grid, starts[0], exits[0], True, True)
    gated = safe and (not avoid_push)
    mok = True
    for m in monsters:
        for (x, y) in m["path"]:
            if y < 0 or y >= len(grid) or x < 0 or x >= len(grid[0]) or grid[y][x] in WALLS:
                mok = False
    ok = bool(starts) and bool(exits) and conn and safe and mok
    flag = "GATED " if gated else "       "
    print(f"{'OK ' if ok else 'FAIL'} {flag} {name}: {len(grid[0])}x{len(grid)} conn={conn} safe={safe} avoid_push={avoid_push} monsters_ok={mok}")
    return ok, gated

# ---------- 已验证网格（纸面原型） ----------
L1 = [
    "#########",
    "#@......#",
    "#.###.#.#",
    "#.#...#.#",
    "#.#.###.#",
    "#...#...#",
    "###.#.###",
    "#......E#",
    "#########",
]
L10 = [
    "###########",
    "#@........#",
    "#.#######.#",
    "#..BB.SB#.#",
    "#.#.SPS.#.#",
    "#.#BS.BB#.#",
    "#.#.SPS.#.#",
    "#.#BB.SB..#",
    "#.#######.#",
    "#........E#",
    "###########",
]
L15 = [
    "###############",
    "#@............#",
    "#.###########.#",
    "#...........#.#",
    "#.#.H.S.B.S.#.#",
    "#.#S.P.H.P.S#.#",
    "#.#.........#.#",
    "#.#.B.S.I.S.#.#",
    "#.#.........#.#",
    "#.#.S.H.F.H.#.#",
    "#.#.........#.#",
    "#.#P.S.B.S....#",
    "#.###########.#",
    "#............E#",
    "###############",
]

# ---------- 自定义"机制必用"关 ----------
# L11 香蕉桥：唯一横向连接是香蕉桥，不踩香蕉则无法跨越（GATED）
L11 = [
    "###########",
    "#@#######.#",
    "#.#######.#",
    "#.#######.#",
    "#.BBBBBBB.#",
    "#.#######.#",
    "#.#######.#",
    "#.#######.#",
    "#.#######.#",
    "#.#######E#",
    "###########",
]
# L12 弹簧体验关：外环安全可达，内圈 B/P/H 为可选机关
L12 = [
    "###########",
    "#@........#",
    "#.#######.#",
    "#.#..P..#.#",
    "#.#.....#.#",
    "#.#.B.B.#.#",
    "#.#.....#.#",
    "#.#..H..#.#",
    "#.#######.#",
    "#........E#",
    "###########",
]
# L17 连续香蕉桥（两侧地刺墙包夹）：必须连滑过香蕉才能抵达（GATED）
L17 = [
    "###########",
    "#@#######.#",
    "#.#######.#",
    "#.SSSSSSS.#",
    "#.BBBBBBB.#",
    "#.SSSSSSS.#",
    "#.#######.#",
    "#.#######.#",
    "#.#######.#",
    "#.#######E#",
    "###########",
]

# ---------- 关卡列表 ----------
levels = []
def add(name, grid, monsters):
    levels.append({"name": name, "grid": grid, "monsters": monsters})

add("L1 你好迷宫", L1, [])
add("L2 小心地刺", *build(11, [
    ".......", ".......", "..S.S..", ".......", "..S.S..", ".......", ".......",
], []))
add("L3 爱心补给", *build(11, [
    ".......", "..H....", "..S.S..", ".......", "..S.S..", "....H..", ".......",
], []))
add("L4 香蕉滑梯", *build(11, [
    ".......", ".......", "..B.B..", ".......", "..B.B..", ".......", ".......",
], []))
add("L5 弹簧蹦蹦", *build(11, [
    ".......", ".......", "..P.P..", ".......", "..P.P..", ".......", ".......",
], []))
add("L6 慢吞吞怪兽", *build(11, [
    ".......", ".......", ".......", ".......", ".......", ".......", ".......",
], [{"path": [[3,5],[7,5]], "speed": 1.5}]))
add("L7 炽热火墙", *build(11, [
    "..S.S..", ".......", "..FFF..", ".......", "..S.S..", ".......", ".......",
], []))
add("L8 冰冻三尺", *build(11, [
    "..S.S..", ".......", "..III..", ".......", "..S.S..", ".......", ".......",
], []))
add("L9 刺与兽", *build(11, [
    "..S.S..", ".......", "..S.S..", ".......", "..S.S..", ".......", "..S.S..",
], [{"path": [[3,5],[7,5]], "speed": 1.6}]))
add("L10 香蕉弹簧迷宫", L10, [])
add("L11 香蕉桥（必用）", L11, [])
add("L12 弹簧体验", L12, [])
add("L13 冰火两重天", *build(13, [
    ".........", "..S...S..", ".........", ".FFFFFFF.",
    ".........", ".IIIIIII.", ".........", "..S...S..", ".........",
], []))
add("L14 怪兽节拍", *build(13, [
    ".B.....P.", ".........", "..S...S..", ".........", ".........",
    ".........", "..S...S..", ".........", ".P.....B.",
], [{"path": [[3,6],[9,6]], "speed": 1.7}]))
add("L15 怪兽方阵", *build(13, [
    "..S...S..", ".........", "..S...S..", ".........", "..S...S..",
    ".........", "..S...S..", ".........", "..S...S..",
], [{"path": [[3,6],[9,6]], "speed": 1.7}, {"path": [[6,3],[6,9]], "speed": 1.7}]))
add("L16 陷阱迷踪", *build(13, [
    ".B.S.P.B.", ".S.....S.", "P.B...B.P", ".S.....S.", ".B.S.P.B.",
    ".S.....S.", "P.B...B.P", ".S.....S.", ".B.S.P.B.",
], []))
add("L17 连蕉滑道（必用）", L17, [])
add("L18 冰刺回廊", *build(13, [
    "..S.I.S..", ".........", ".I.....I.", "..S...S..", ".........",
    "..S...S..", ".I.....I.", ".........", "..S.I.S..",
], []))
add("L19 火与兽", *build(13, [
    "..F.F.F..", ".........", ".FF...FF.", "..F...F..", ".........",
    "..F...F..", ".FF...FF.", ".........", "..F.F.F..",
], [{"path": [[3,6],[9,6]], "speed": 1.7}]))
add("L20 大冒险终章", L15, [{"path": [[4,6],[10,6]], "speed": 1.7}, {"path": [[5,4],[5,10]], "speed": 1.7}])

# ---------- 校验 ----------
allok = True
any_gated = False
for lv in levels:
    ok, gated = validate(lv["name"], lv["grid"], lv["monsters"])
    allok &= ok
    any_gated |= gated

# ---------- 写出 js/levels.js ----------
out_dir = os.path.join(os.path.dirname(__file__), "js")
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "levels.js"), "w", encoding="utf-8") as f:
    f.write("// 自动生成：build_levels.py ｜ 关卡即数据，字符映射见 GAME_DESIGN.md\n")
    f.write("// 字符: # 墙  F 火墙  I 冰墙  . 地板  @ 起点  E 终点  S 地刺  H 爱心  B 香蕉  P 弹簧\n")
    f.write("// monsters: path=[[x,y]...] 沿线 ping-pong 往返; speed=格/秒\n")
    f.write("const LEVELS = ")
    f.write(json.dumps(levels, ensure_ascii=False, indent=1))
    f.write(";\n")
    f.write("if (typeof module !== 'undefined') module.exports = LEVELS;\n")

print("\n全部校验:", "PASS" if allok else "FAIL (需修正)")
print("含机制必用关(GATED):", any_gated)
print("已写出 js/levels.js , 共", len(levels), "关")
