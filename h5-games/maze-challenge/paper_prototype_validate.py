#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
纸面原型验证脚本（非游戏代码，仅用于落地前验证地图可解性）
验证目标：
  1. 每关 @ 与 E 连通（任意路径存在）
  2. 存在一条"零伤安全路线"：绕过 地刺S / 火墙F相邻 / 冰墙I相邻 / 香蕉B / 弹簧P
     （怪兽格不强制避开，因为靠时序可过，单独报告）
  3. 行列长度一致
"""
from collections import deque

WALLS = {"#", "F", "I"}  # 火墙F、冰墙I 视为不可通行的墙，且邻接扣血

def load(grid_str):
    rows = [list(r) for r in grid_str.strip("\n").split("\n")]
    return rows

def dims(rows):
    return len(rows), (len(rows[0]) if rows else 0)

def find(rows, ch):
    out = []
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == ch:
                out.append((x, y))
    return out

def unsafe_cells(rows):
    """标记'不安全'格：自身是 S，或正交相邻于 F/I。B/P 也视为不安全（失控位移）。"""
    h, w = dims(rows)
    bad = set()
    for y in range(h):
        for x in range(w):
            c = rows[y][x]
            if c in ("S", "B", "P"):
                bad.add((x, y))
            if c in ("F", "I"):
                # 墙本身不可走；其正交相邻格视为不安全
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h:
                        bad.add((nx, ny))
    return bad

def bfs(rows, start, goal, blocked):
    h, w = dims(rows)
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        if (x, y) == goal:
            return True
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and (nx, ny) not in blocked:
                seen.add((nx, ny)); q.append((nx, ny))
    return False

def validate(name, grid_str):
    rows = load(grid_str)
    h, w = dims(rows)
    len_ok = all(len(r) == w for r in rows)
    starts = find(rows, "@"); exits = find(rows, "E")
    conn = False; safe = False
    if starts and exits:
        s = starts[0]; e = exits[0]
        conn = bfs(rows, s, e, set())  # 任意路径
        safe = bfs(rows, s, e, unsafe_cells(rows))  # 零伤安全路线
    print(f"=== {name} ===")
    print(f"  尺寸: {w} x {h}  行等长: {len_ok}  @数:{len(starts)}  E数:{len(exits)}")
    print(f"  任意路径连通: {conn}   零伤安全路线存在: {safe}")
    if not (len_ok and starts and exits and conn and safe):
        print("  !!! 未通过，需修正")
    else:
        print("  OK")
    return conn and safe

# ---------- 地图定义 ----------
L1 = """
#########
#@......#
#.###.#.#
#.#...#.#
#.#.###.#
#...#...#
###.#.###
#......E#
#########
"""

L10 = """
###########
#@........#
#.#######.#
#..BB.SB#.#
#.#.SPS.#.#
#.#BS.BB#.#
#.#.SPS.#.#
#.#BB.SB..#
#.#######.#
#........E#
###########
"""

L15 = """
###############
#@............#
#.###########.#
#...........#.#
#.#.H.S.B.S.#.#
#.#S.P.H.P.S#.#
#.#.........#.#
#.#.B.S.I.S.#.#
#.#.........#.#
#.#.S.H.F.H.#.#
#.#.........#.#
#.#P.S.B.S....#
#.###########.#
#............E#
###############
"""

if __name__ == "__main__":
    validate("L1 教学(9x9)", L1)
    validate("L10 推力谜题(11x11)", L10)
    validate("L15 全要素汇演(15x15)", L15)

    # 额外：验证内部"捷径"可从左门走到右门（证明机关被真正使用）
    def bfs_any(grid, s, g):
        rows = load(grid); h, w = dims(rows)
        seen = {s}; q = deque([s])
        while q:
            x, y = q.popleft()
            if (x, y) == g: return True
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = x+dx, y+dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and rows[ny][nx] != '#':
                    seen.add((nx, ny)); q.append((nx, ny))
        return False
    # L10 左门(2,3) 右门(8,7)；L15 左门(2,3) 右门(12,11)
    print("L10 内部左门→右门连通:", bfs_any(L10, (2,3), (8,7)))
    print("L15 内部左门→右门连通:", bfs_any(L15, (2,3), (12,11)))
