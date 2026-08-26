# 数字跑酷 3D · 体验优化说明

> 设计视角：先结论，再论据。本次只动「反馈通道」与「数值系统」两层——这两类是"感觉不对"的第一嫌疑，不动核心循环（三车道 + 撞相同数字翻倍）本身。
> 改动文件：`h5-games/number-runner/js/game.js`。约束未变：经典 IIFE、无 ES module、无 emoji、兼容 Android 6 WebView。

## 修复清单

### 🔴 1. 计分被距离分覆盖 → 惩罚是假的
- **原状**：每帧 `score = Math.max(score, distScore)` 把分数锁回「距离 / 6」的基线。吃到炸弹 `-40`、错数字 `-15`、传送 `+120`，下一帧就被距离分涨回/覆盖，**玩家的操作对分数毫无影响**。
- **改法**：拆分为「距离基线 + 操作分」。
  - `score = Math.max(0, floor(distance/6) + actionScore)`，每帧重算。
  - 合并 `actionScore += (value + combo*2)`；炸弹 `-40`；错数字 `-15`；传送 `+120`；击败 Boss `+250`。
  - `actionScore` 跨关卡累计（一次通关跑的总分），重开本局时归零。
  - 扣分下限钳在 `-floor(distance/6)`，保证总分不为负、但惩罚真实可见。
- **玩家体感**：撞错 / 吃炸弹，分数真的往下掉；合并和奖励真的往上加。操作有了意义。

### 🔴 2. 生命值 HUD 与逻辑不一致 → 隐形命
- **原状**：`lives = 5`，但 `updateLives()` 只画 3 个方块。结果前 3 次死亡 HUD 纹丝不动，第 4 次才开始掉血——**3 条命是隐形的**，极不公平。
- **改法**：`lives = 3`，与 HUD 的 3 格、开始界面文案「共 3 条」三者对齐。
- **玩家体感**：掉一条命，HUD 立刻少一格，反馈诚实。

### 🟡 3. Boss 战波次叠加 + 数值偏硬 + 连击无效
- **原状**：Boss 阶段常规波次（`spawnRow`，每 ~0.9s）与 Boss 攻击波（每 2.3s）**同时刷**，场上拥挤；Boss 伤害只吃 `player.value`，连击无关；HP 偏高（360/520/760）像血牛。
- **改法**：
  - Boss 阶段**停用 `spawnRow`**，只由 `spawnBossAttack` 驱动。
  - 每波**保证一个可合并数字**（与攻击分放不同车道）——打 Boss 的"正确玩法"清晰：去撞数字累积伤害、躲开攻击。
  - 连击放大 Boss 伤害：`dmg = player.value * (1 + (combo-1)*0.5)`，奖励无伤连击。
  - **Boss 血量改为「入场数值的倍数」**（见下方 Turn 2），彻底解决最终关"两下通关"。原绝对数值 `220/300/400` 已废弃。

### 🔴 4. 最终 Boss 一击秒 + 胜利界面硬切（Turn 2 追加）
> 用户反馈："最后一关时间太短了，而且通关表现很突然。"

- **根因**：Boss 血量是绝对常数（泰坦 400）。但玩家数字**指数滚雪球**（2→4→8…→256/512），一次合并的伤害 `player.value × (1+combo·0.5)` 轻易破千。结果泰坦登场后**一两下就被秒**，且 `bossDefeated` 对最终关直接调 `victory()` —— 没有任何过渡，胜利界面"啪"地蹦出来。
- **改法 A · 血量锚定入场数值（核心修复）**：
  - `BOSSCFG` 由 `hp` 改为 `hpMul`；入场时 `bossMaxHP = round(player.value × hpMul)`。
  - 击杀所需合并次数恒定 ≈ `log2(hpMul/2)`，**与数字多大无关**：摆锤魔 96→约 26 次、法师 384→约 28 次、泰坦 1500→约 30 次。雪球越大，单次伤害越高，但 HP 同步放大，时长不再塌缩。
  - `[PLACEHOLDER · 待 playtest]` 目标单场 Boss 战：摆锤魔≈12s / 法师≈16s / 泰坦≈20s。
- **改法 B · 终局金色演出（消除硬切）**：
  - 最终 Boss 被击败时不再立刻 `victory()`，而是进入 `cinematic` 状态：清场 + `flashScreen()` 金色径向闪屏 + 播放 `victory` 音效 + toast "击败 XX！通关！"。
  - 演出期间世界**继续向前滑行 2.2s**（距离/地面滚动/玩家归位照旧，但停刷怪、停判定、停计分），金色闪屏在 2.2s 内淡出。
  - 计时归零后 `restoreWarpBg()` 复位、`victory()` 才真正切入胜利界面。
  - 胜利文案动态化：`victoryTip` 改为 "你击败了 **数字泰坦**，恭喜通关！"（取自最终关 Boss 名，不写死）。
- **玩家体感**：最终关不再是"两秒速通"，而是有分量的一场对峙；通关时先看到金色爆发与角色冲线，再从容落定到胜利结算，节奏有了呼吸感。

### 🟢 5. 手感增强（低成本高回报）
- 炸弹击中加 `shake = 0.35` 震屏（摆锤原本就有，炸弹补齐）。
- 合并时玩家做一次 `scale` bump（0.18s 内放大 25% 回弹），给正反馈"咔哒"感。

## 验证
- `node --check` 两次改动均通过，无语法错误。
- 逻辑自检（Turn 1）：所有分数写入收口到 `actionScore`；全场唯一每帧写 `score` 的是重算式；`actionScore` 在重开/重来时归零、跨关卡保留。
- 逻辑自检（Turn 2）：`hpMul` 在 `BOSSCFG` 定义、`enterBossPhase` 用其乘入场数值算 `bossMaxHP`；`cinematic`/`cinemaTimer` 在 `update()` 顶部短路、终局 `bossDefeated` 置位、`victory()` 后复位；`flashScreen`/`restoreWarpBg`/`ORIG_WARP_BG` 配对使用，无残留金色覆盖。grep 确认无旧 `.hp`/`cfg.hp` 残留引用。

## 待 playtest 的开放项（未动，需实测）
- **Boss `hpMul` 三档（96 / 384 / 1500）为占位**：目标是单场 Boss 战 摆锤魔≈12s / 法师≈16s / 泰坦≈20s。实测偏短则调大 `hpMul`、偏长则调小（注意对数刻度：翻倍 hpMul 只多约 1 次合并）。
- 终局演出时长 `cinemaTimer = 2.2s` 为占位：想更燃可加到 3.0s 并叠加镜头推进；想更快落定可降到 1.6s。
- 连击目前**不随时间衰减**，只被失误清零——对休闲向 OK，若想加压可加"X 秒不合并则连击-1"。
- 难度曲线 `levelSpeed` / `spawnTimer` 未动；若实测后期太挤，优先调 `spawnTimer` 下限（当前 0.55s）。

## 改动文件清单
- `h5-games/number-runner/js/game.js`：计分模型、生命 HUD、Boss 波次与伤害、Boss 血量 `hpMul` 模型、终局金色演出 `cinematic`、`victory` 文案动态化。
- `NUMBER_RUNNER_OPTIMIZE.md`：本说明文档（两次改动累计）。
- 约束未变：经典 IIFE、无 ES module、无 emoji（数字用 CanvasTexture）、兼容 Android 6 WebView。

> 注：按项目约定，`git push` 由你（用户）在终端手动完成；本会话只落地代码与文档，不代推。
