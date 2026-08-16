#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 maze-challenge/js/levels.js —— 迷宫主题关卡生成器（v2 重做）

设计目标（用户规则）：
  1. 每关必须有安全路线（零伤可通关）—— 硬规则，由下方 validator 与 proper 模型双重保证。
  2. "明显的安全路线" 只在低等关卡：L1–L5 用完美迷宫（唯一通路=明显安全路线，且必然弯曲不直）。
  3. 中高关卡：加 braid 环产生"短险 / 长安全"双路，安全路线被墙/死路/分支掩埋，需探索规划。
  4. 所有路径必须弯曲绕行，不得直来直去（完美迷宫的 @→E 最长路径天然蜿蜒）。

与引擎 engine.js 的移动规则对齐：
  - 墙/F/I/越界：阻挡，不前进
  - 地刺 S：阻挡 + 扣 1 血，不前进（不可踏入 → 是障碍物，不是可穿越风险）
  - 香蕉 B：踏入后朝面向前进 1；落点若是香蕉则连锁
  - 弹簧 P：踏入后沿面向反方向退后 2；落点若是香蕉/弹簧则继续连锁
  - 火墙 F / 冰墙 I：阻挡；相邻 1 格则扣 1 血（红屏/冻结）

难度建模（proper 模型，比原 validator 更严）：
  - safe 通路：只能站 .H@E 且不与 F/I 相邻；显式避开 B/P（保证安全路线在真实引擎也零伤）。
  - greedy 通路：允许与 F/I 相邻、允许踩 B/P（仅作可通行，不计推力伤害），但 S/F/I 仍阻挡。
  - risk_ratio = safe_len / greedy_len（>1 说明存在"更短但贴火/冰"的险路 → 安全路线需绕远、非明显）。

校验项（沿用原 validator 输出便于对照）：
  conn        : @→E 是否连通
  safe        : 是否存在零伤路线
  avoid_push  : 是否完全不踩 B/P 也能通关（若 safe 可达而 avoid_push 不可达 → GATED）
  monsters_ok : 怪兽路径不落在墙上
"""
import json, os, random
from collections import deque

DIRS4 = [(0, -1), (0, 1), (-1, 0), (1, 0)]
WALLS = {"#", "F", "I"}

# ===================== 迷宫生成 =====================
def gen_maze(N, rng):
    """递归回溯完美迷宫（奇数 N，墙在偶坐标，通路在奇坐标）。"""
    grid = [["#"] * N for _ in range(N)]
    def carve(x, y):
        grid[y][x] = "."
        dirs = [(0, -2), (0, 2), (-2, 0), (2, 0)]
        rng.shuffle(dirs)
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 1 <= nx < N - 1 and 1 <= ny < N - 1 and grid[ny][nx] == "#":
                grid[y + dy // 2][x + dx // 2] = "."
                carve(nx, ny)
    carve(1, 1)
    return grid

def braid(grid, rng, prob):
    """打通部分死路墙，制造环路（loop）。环路 = 多条 @→E 路线 = 风险/抉择来源。"""
    N = len(grid)
    walls = []
    for y in range(1, N - 1):
        for x in range(1, N - 1):
            if grid[y][x] == "#":
                h = grid[y][x - 1] == "." and grid[y][x + 1] == "."
                v = grid[y - 1][x] == "." and grid[y + 1][x] == "."
                if h or v:
                    walls.append((x, y))
    rng.shuffle(walls)
    cnt = int(round(len(walls) * prob))
    for i in range(cnt):
        x, y = walls[i]
        grid[y][x] = "."

def to_str(grid):
    return tuple("".join(r) for r in grid)

def farthest(grid_str, start):
    """BFS 找距 start 最远的 '.' 单元格（作为终点 E，保证安全路线最长、最蜿蜒）。"""
    W = len(grid_str[0]); H = len(grid_str)
    dist = {start: 0}; q = deque([start]); best = start; bd = 0
    while q:
        x, y = q.popleft()
        for dx, dy in DIRS4:
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and grid_str[ny][nx] == "." and (nx, ny) not in dist:
                dist[(nx, ny)] = dist[(x, y)] + 1
                if dist[(nx, ny)] > bd:
                    bd = dist[(nx, ny)]; best = (nx, ny)
                q.append((nx, ny))
    return best

def has_fi_adj(grid_str, x, y):
    W = len(grid_str[0]); H = len(grid_str)
    for dx, dy in DIRS4:
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H and grid_str[ny][nx] in "FI":
            return True
    return False

def safe_neighbors(grid_str, pos):
    W = len(grid_str[0]); H = len(grid_str); x, y = pos; res = []
    for dx, dy in DIRS4:
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H:
            c = grid_str[ny][nx]
            # 安全路线：只走地板/爱心/起终点，且绝不与火/冰相邻；显式避开 B/P
            if c in ".HE@" and not has_fi_adj(grid_str, nx, ny):
                res.append((nx, ny))
    return res

def greedy_neighbors(grid_str, pos):
    W = len(grid_str[0]); H = len(grid_str); x, y = pos; res = []
    for dx, dy in DIRS4:
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H:
            c = grid_str[ny][nx]
            # 贪心通路：允许贴火/冰、允许踩 B/P，但 S/F/I 仍阻挡
            if c in ".HE@BP":
                res.append((nx, ny))
    return res

def bfs_path(grid_str, start, goal, neigh):
    seen = {start: None}; q = deque([start])
    while q:
        pos = q.popleft()
        if pos == goal:
            path = []; p = pos
            while p is not None:
                path.append(p); p = seen[p]
            return path[::-1]
        for npos in neigh(grid_str, pos):
            if npos not in seen:
                seen[npos] = pos; q.append(npos)
    return None

def find_corridor(grid_str, minlen, reserved):
    """找一条足够长的直线通路（横或竖）放怪兽 ping-pong。"""
    W = len(grid_str[0]); H = len(grid_str); best = None
    for y in range(H):
        x = 0
        while x < W:
            if grid_str[y][x] == "." and (x, y) not in reserved:
                x2 = x
                while x2 < W and grid_str[y][x2] == "." and (x2, y) not in reserved:
                    x2 += 1
                length = x2 - x
                if length >= minlen and (best is None or length > best[4]):
                    best = (x, y, x2 - 1, y, length)
                x = x2
            else:
                x += 1
    for x in range(W):
        y = 0
        while y < H:
            if grid_str[y][x] == "." and (x, y) not in reserved:
                y2 = y
                while y2 < H and grid_str[y2][x] == "." and (x, y2) not in reserved:
                    y2 += 1
                length = y2 - y
                if length >= minlen and (best is None or length > best[4]):
                    best = (x, y, x, y2 - 1, length)
                y = y2
            else:
                y += 1
    return best

# ===================== 原 validator（对照用） =====================
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
OPP = {"up": "down", "down": "up", "left": "right", "right": "left"}
ALLDIRS = ["up", "down", "left", "right"]

def step(grid, pos, direction, forbid_push=False):
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
        return (pos, True)
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
    seen = {start}; q = deque([start])
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

def validate(name, grid, monsters, quiet=False):
    starts, exits = find(grid, "@"), find(grid, "E")
    conn = _reach(grid, starts[0], exits[0], False, False) if starts and exits else False
    safe = _reach(grid, starts[0], exits[0], False, True) if starts and exits else False
    avoid_push = _reach(grid, starts[0], exits[0], True, True) if starts and exits else False
    gated = safe and (not avoid_push)
    mok = True
    for m in monsters:
        for (x, y) in m["path"]:
            if y < 0 or y >= len(grid) or x < 0 or x >= len(grid[0]) or grid[y][x] in WALLS:
                mok = False
    ok = bool(starts) and bool(exits) and conn and safe and mok
    if not quiet:
        flag = "GATED " if gated else "       "
        print(f"{'OK ' if ok else 'FAIL'} {flag} {name}: {len(grid[0])}x{len(grid)} conn={conn} safe={safe} avoid_push={avoid_push} monsters_ok={mok}")
    return ok, gated

# ===================== 单关构建 =====================
def place_hazards(grid_str, spec, safe_set, greedy_set, reserved, rng, target):
    W = len(grid_str[0]); H = len(grid_str)
    g = [list(r) for r in grid_str]
    # 装饰候选：地板、不在安全线上、未被预留
    candidates = [(x, y) for y in range(H) for x in range(W)
                  if g[y][x] == "." and (x, y) not in safe_set and (x, y) not in reserved]

    used = set()
    def take(pool, n, avoid=set()):
        pool = [c for c in pool if c not in used and c not in avoid]
        rng.shuffle(pool)
        chosen = pool[:n]
        for c in chosen:
            used.add(c)
        return chosen

    if target in ("mid", "high"):
        # 贪心捷径"整条"格（含与安全线重合者）—— 下毒后安全线必须绕环路，从而变长
        greedy_cells = [c for c in greedy_set
                        if c not in reserved and g[c[1]][c[0]] in ".@E"]
        # 火/冰墙：转"捷径格"旁的墙 → 捷径与火/冰相邻（贪心可走、安全需绕远）
        fi_wall = []
        for (x, y) in greedy_cells:
            for dx, dy in DIRS4:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and g[ny][nx] == "#":
                    fi_wall.append((nx, ny))
        for ch in ("F", "I"):
            n = spec.get(ch, 0)
            if n:
                chos = take(fi_wall, n)
                if len(chos) < n:
                    return None
                for (x, y) in chos:
                    g[y][x] = ch
        # 香蕉/弹簧：直接放在"捷径格"上，安全线为避开推力需绕远
        for ch in ("B", "P"):
            n = spec.get(ch, 0)
            if n:
                chos = take(greedy_cells, n)
                if len(chos) < n:
                    chos += take(candidates, n - len(chos))
                if len(chos) < n:
                    return None
                for (x, y) in chos:
                    g[y][x] = ch
    else:
        # 低关：危害只做装饰，绝不碰安全线也不与捷径相邻，保证"明显安全"
        for ch in ("F", "I", "B", "P"):
            n = spec.get(ch, 0)
            if n:
                chos = take(candidates, n)
                if len(chos) < n:
                    return None
                for (x, y) in chos:
                    g[y][x] = ch

    # 地刺：放在装饰候选（远离双路线），只增视觉压迫不影响长短关系
    n = spec.get("S", 0)
    if n:
        chos = take(candidates, n)
        if len(chos) < n:
            return None
        for (x, y) in chos:
            g[y][x] = "S"
    # 爱心：纯装饰补给
    n = spec.get("H", 0)
    if n:
        chos = take(candidates, n)
        if len(chos) < n:
            return None
        for (x, y) in chos:
            g[y][x] = "H"
    return to_str(g)

def build_one(idx, name, N, braid_p, spec, mcount, target, speed, seed0=0, tries=400):
    best = None
    has_fi = ("F" in spec) or ("I" in spec)
    for s in range(seed0 + idx * 100003, seed0 + idx * 100003 + tries):
        rng = random.Random(s)
        grid = gen_maze(N, rng)
        braid(grid, rng, braid_p)
        grid_str = to_str(grid)
        start = (1, 1)
        E = farthest(grid_str, start)
        g2 = [list(r) for r in grid_str]
        g2[start[1]][start[0]] = "@"
        g2[E[1]][E[0]] = "E"
        g2_str = to_str(g2)

        safe = bfs_path(g2_str, start, E, safe_neighbors)
        if not safe:
            continue
        safe_set = set(safe)
        greedy = bfs_path(g2_str, start, E, greedy_neighbors)
        if not greedy:
            continue
        greedy_set = set(greedy)

        # 怪兽：放在直线通路上，预留不被危害占用
        reserved = {start, E}
        monsters = []
        for mi in range(mcount):
            seg = find_corridor(g2_str, 4, reserved)
            if not seg:
                break
            x1, y1, x2, y2, _ = seg
            reserved.update((x, y) for x in range(min(x1, x2), max(x1, x2) + 1)
                            for y in range(min(y1, y2), max(y1, y2) + 1))
            monsters.append({"path": [[x1, y1], [x2, y2]], "speed": speed})

        grid_haz = place_hazards(g2_str, spec, safe_set, greedy_set, reserved, rng, target)
        if grid_haz is None:
            continue
        # 重新确认 proper 安全路线在最终网格上仍存在
        safe2 = bfs_path(grid_haz, start, E, safe_neighbors)
        if not safe2:
            continue
        ok, gated = validate(name, grid_haz, monsters, quiet=True)
        if not ok:
            continue

        ratio = len(safe2) / len(greedy)
        # 按难度档位强制"风险比"区间：低关≈1(明显安全)；中高关必须存在短险长安全的抉择
        if target == "low":
            if ratio < 0.97 or ratio > 1.06:
                continue
            score = len(safe2)
        elif target == "mid":
            if ratio < 1.12 or ratio > 1.45:
                continue
            score = len(safe2) + ratio * 8
        else:  # high
            if ratio < 1.25 or ratio > 2.20:
                continue
            score = len(safe2) + ratio * 30
        if best is None or score > best[0]:
            best = (score, grid_haz, monsters, ratio, len(safe2), len(greedy), gated)
    return best

# ===================== 关卡参数表 =====================
# (名称, 尺寸N, braid概率, 危害种类计数, 怪兽数, 难度档, 怪兽速度)
SPEC = [
    ("L1 你好迷宫",     9,  0.00, {},                  0, "low",  1.5),
    ("L2 小心地刺",     9,  0.00, {"S": 3},            0, "low",  1.5),
    ("L3 爱心补给",     11, 0.00, {"S": 3, "H": 2},    0, "low",  1.5),
    ("L4 香蕉滑梯",     11, 0.00, {"B": 3, "H": 1},    0, "low",  1.5),
    ("L5 弹簧蹦蹦",     11, 0.00, {"P": 2, "B": 1},    0, "low",  1.5),
    ("L6 慢吞吞怪兽",   11, 0.30, {"S": 2, "B": 2},    1, "mid",  1.5),
    ("L7 炽热火墙",     11, 0.30, {"F": 4, "S": 2},    0, "mid",  1.5),
    ("L8 冰冻三尺",     11, 0.30, {"I": 4, "S": 2},    0, "mid",  1.5),
    ("L9 刺与兽",       13, 0.32, {"S": 4, "B": 2},    1, "mid",  1.6),
    ("L10 香蕉弹簧迷宫", 13, 0.32, {"B": 4, "P": 3, "S": 2}, 0, "mid", 1.6),
    ("L11 冰火两重天",   13, 0.36, {"F": 3, "I": 3, "S": 2}, 0, "high", 1.7),
    ("L12 怪兽节拍",     13, 0.36, {"S": 3, "F": 2},    1, "high", 1.7),
    ("L13 怪兽方阵",     13, 0.36, {"S": 3, "I": 2},    2, "high", 1.7),
    ("L14 陷阱迷踪",     13, 0.38, {"B": 4, "P": 4, "S": 3}, 0, "high", 1.7),
    ("L15 冰刺回廊",     13, 0.38, {"I": 3, "S": 4},   0, "high", 1.7),
    ("L16 火与兽",       13, 0.38, {"F": 3, "S": 3},   1, "high", 1.7),
    ("L17 连蕉滑道",     13, 0.38, {"B": 6, "P": 2, "S": 2}, 0, "high", 1.7),
    ("L18 冰火兽阵",     15, 0.38, {"F": 3, "I": 3, "S": 3}, 1, "high", 1.7),
    ("L19 双重陷阱",     15, 0.40, {"B": 4, "P": 4, "F": 2, "I": 2, "S": 3}, 1, "high", 1.7),
    ("L20 大冒险终章",   15, 0.40, {"F": 3, "I": 3, "B": 3, "P": 3, "S": 4, "H": 2}, 2, "high", 1.7),
]

# ===================== 主流程 =====================
levels = []
allok = True
any_gated = False
for idx, (name, N, bp, spec, mc, target, speed) in enumerate(SPEC):
    tries = 900 if target in ("mid", "high") else 500
    res = build_one(idx, name, N, bp, spec, mc, target, speed, tries=tries)
    if res is None:
        print(f"!!! 无法生成 {name}（{tries} 个种子均不满足 safe/结构约束）")
        allok = False
        continue
    score, grid_haz, monsters, ratio, sl, gl, gated = res
    levels.append({"name": name, "grid": list(grid_haz), "monsters": monsters})
    any_gated |= gated
    has_fi = ("F" in spec) or ("I" in spec)
    tag = {"low": "低·明显安全", "mid": "中·有抉择", "high": "高·隐蔽安全"}[target]
    print(f"    [{tag}] safe_len={sl} greedy_len={gl} risk_ratio={ratio:.2f} "
          f"mon={len(monsters)} fi={has_fi}  -> 见下方网格")
    for row in grid_haz:
        print("    " + row)
    print()

print("\n全部校验:", "PASS" if allok else "FAIL (需修正)")
print("含机制必用关(GATED):", any_gated)

# 写出 js/levels.js
out_dir = os.path.join(os.path.dirname(__file__), "js")
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "levels.js"), "w", encoding="utf-8") as f:
    f.write("// 自动生成：build_levels.py (v2 迷宫生成器) ｜ 关卡即数据，字符映射见 GAME_DESIGN.md\n")
    f.write("// 字符: # 墙  F 火墙  I 冰墙  . 地板  @ 起点  E 终点  S 地刺  H 爱心  B 香蕉  P 弹簧\n")
    f.write("// monsters: path=[[x,y]...] 沿线 ping-pong 往返; speed=格/秒\n")
    f.write("// 设计: 每关保证零伤安全路线; 低关唯一通路=明显安全; 中高关 braid 产生短险/长安全抉择\n")
    f.write("const LEVELS = ")
    f.write(json.dumps(levels, ensure_ascii=False, indent=1))
    f.write(";\n")
    f.write("if (typeof module !== 'undefined') module.exports = LEVELS;\n")
print("已写出 js/levels.js , 共", len(levels), "关")
