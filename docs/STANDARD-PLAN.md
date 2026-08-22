# Router Standard 总策划书

**渐进式披露革命 —— 融合统一的最强套装预设**

版本：v0.7（2026-08-21）→ v0.8 实测修复（2026-08-22）| 状态：开发中（用户实测驱动）

---

## 〇、一句话定位

**Router Standard 不是"又一个预设"——它是工具调用方式的革命：把"开局全铺 48 工具"的注意力税，改成"按任务阶段渐进解锁 + 按需二级披露"，并融合记忆系统、知识系统、压力感应，做成一套"模型越用越顺手、注意力永远花在刀刃上"的最强套装。**

---

## 一、哲学：还原，不是控制

贯穿全部设计的核心立场（用户定稿，反复校正的结论）：

| 错误方向（已废弃） | 正确方向（本标准） |
|---|---|
| 思维帽/预算帽：限制思考量 | 深度自主：想多深由任务定，不设帽 |
| 强制交替：系统节拍器 | 泄压引导：压力信号出现时给"选择"，不命令 |
| 关键词分类换装：classifyTask 计数 → 换 persona | 阶段化披露：工具按需解锁，模型自己判断 |
| 团队协议：we 提示词工程（压制式话术） | 还原训练接口（RL 句）+ 自然引导 |

**一句话**：模型本身能力足够，接口污染让它失控；标准模式做的就是**接口还原 + 注意力经济 + 压力感知**——不干预模型的思考自由，只优化它看到的世界。

---

## 二、核心创新：渐进式披露（Progressive Tool Disclosure）

### 2.1 问题：工具 schema 是注意力税

- DSH 全量工具目录 ≈ 48 项，完整 schema ≈ 6.5K+ 字符（PTC 的 SDK 段高达 39K）
- 实测（2026-08-15）：59K system 下 Flash 首轮 **0 行动**（推理耗尽在读工具/规划上）
- 模型首轮注意力被"选工具/看工具"吃掉——**元思考爆发**（"which tool should I..."）挤占技术思考

### 2.2 方案：四阶段门控 + 二级披露

```
阶段 0 了解/对齐   read/glob/grep/web_search/ask_user_question
                  + engram_recall（唤醒往事）+ engram_verify/respond（知识出招）
      ↓ 指引：要开始开发？先完成需求对齐——陈述理解 + 打开计划（todo_write）→ 解锁
阶段 1 拟合方案    + todo_write/exit_plan_mode + engram_search/open（记忆盘点）
      ↓ 指引：方案已定？进入开发——write/edit 解锁
阶段 2 开发        + write/edit/str_replace_editor + engram_store/link（沉淀决策）
      ↓ 指引：开发完成？验证——pwsh 解锁
阶段 3 验证        + pwsh/bash/read_image/job_*
      ↓ 交付：全量开放（restrict 释放）
```

### 2.3 机制实现

| 层 | 机制 | 说明 |
|---|---|---|
| **执行层门控** | `tools.restrict({ allow: 阶段0..N })` | 全局工具按阶段可见（过滤到 GLOBAL_SAFE，scope-local 不受限） |
| **PTC SDK 阶段化** | `buildStagedSdk` 替换 tools:sdk 段 | 39K 全量 SDK → 当前阶段工具签名 + 全量声明（run_code 一次多调用保留） |
| **二级披露** | `tools_catalog`（名+一行摘要）/ `tools_help`（完整 schema） | 48 工具全貌按需查——索引轻、详情重、只付需要的注意力 |
| **解锁指引** | `STAGE_GUIDES` 经 pre-step 注入 | "要解锁 X，先做 Y"——引导模型走通用最优路径 |
| **行为信号推进** | `stageOf` 会话状态 | todo_write→阶段1；write→阶段2；pwsh/完成声明→阶段3 |
| **自查自调** | `dev_router_status` / `dev_router_mode` | 模型可随时看阶段/工具面/override |

### 2.4 为什么是"革命"

- 生态现状：**所有预设都是开局全铺**（schema 即注意力税）
- 本标准：**工具知识按需加载**（类 man page）——精准调用不变（help 给完整 schema），开始不分散
- 即使最终不可避免全量开放，**注意力也已花在有用工具上**（用户原话：最优通用路径——了解→对齐→查资料→拟合方案→开发→验证）

---

## 三、系统融合：记忆 + 知识 + 压力感应

### 3.1 记忆系统（engram 深度融合）

| 阶段 | 工具 | 语义 |
|---|---|---|
| 0 了解 | engram_recall | 唤醒跨会话记忆（入口 + 渐进披露展开） |
| 0 了解 | engram_verify / engram_respond | 知识主张白箱验证（✓锚定/?图谱外）+ 学科卡出招 |
| 1 方案 | engram_search / engram_open | 盘点记忆图谱、展开细节 |
| 2 开发 | engram_store / engram_link | 沉淀决策、织因果网（决策树可回溯） |

**设计**：记忆不是"注入负担"而是"能力接入"——阶段 0 先问"我们之前做过什么"，开发中持续沉淀"为什么这么定"。

### 3.2 知识系统（灵枢）

- 主张先 verify 再下结论（en gram_verify：✓锚定 / ?图谱外不裁决——诚实边界）
- 知识出招按条件路由（engram_respond：条件→学科卡→出招动作）
- 自动补卡：弱命中自动补簇桥接（当场学会，下次就有）

### 3.3 外置压力感应提醒（pressure-sensor 插件）

```
监测信号：
  ① 单步推理 > 30K chars（深度过载）
  ② 循环模式（but wait / actually / 重新确认 ×4）
  ③ 连续 3 步无工具调用（失联征兆）
→ 注入温和提醒（2 步冷却防骚扰）：
  "Pressure sensor: <信号>。Choice is ours: 若已足够则行动；
   若需更深则用泄压口（MAXential）——想一步/修正/分支合并/真正 settled 才完成。"
```

**哲学**：提醒不是压制——给选择，不给命令。深度自主是原则（小结果小思考、重要分叉全推理）。

### 3.4 泄压引导（MAXential，persona 常驻）

```
深度推理不循环 "but wait"——倒入泄压口：
想一步 → 修正上一步 → 分支 + 合并替代方案 → 真正 settled 才完成。
触发：两个以上依赖步骤 / 被问同一件事两次 / 抓到自己在重述决定。
```

---

## 四、PTC 底座（保留 run_code 效率）

- 工具面 = run_code（一次执行多步，五轮变一轮）
- SDK 段按阶段精简（39K → 阶段工具签名）——**这是 PTC 在 Flash 上能工作的关键**（59K 压顶 0 行动已实测，阶段精简后 688 字符首轮 + 行动）
- restrict 执行层双保险（SDK 说明 + 调用拦截）

---

## 五、运行期修复（社区 PR 吸收，实测验证）

| 修复 | 来源 | 作用 |
|---|---|---|
| agent/inbox/claimed 首轮捕获 | #13/#17/#32 | 首条真实用户消息（不依赖事件时序） |
| pre-step 引导通道 | #34/#36/#55 | 同一请求携带引导（免 2× API 调用） |
| currentMode 类型统一 | #32B | 原始文本过 bandOf → spec 恒成立的 bug |
| queueMicrotask 死锁 | #32D | 事件窗口内 append reenter |
| sessionModels（assembled.variables） | #9 | 会话选择模型（非启动默认） |
| 子代理放行 | #5 | parentSession 会话跳过路由 |
| extractText/bandOf import | #6/#11 | 首条消息必崩的 ReferenceError |
| shell 缺失放行 | v0.7 | 渐进披露下 shell 是阶段工具，缺失是正常态 |

---

## 六、实测数据支撑

| 实验 | 数据 | 结论 |
|---|---|---|
| RL 接口还原（2026-08-15） | 46 字符 + 双工具 → 25 步/24 工具调用/19KB 产物 vs 污染接口 101K 推理 0 行动 | 接口还原有效 |
| PTC 压顶（2026-08-15/21） | 39K/59K system → Flash 首轮 0 行动 | SDK 全量是注意力税+压顶元凶 |
| 阶段化披露（2026-08-21） | 688 字符首轮 + run_code 行动（standard2 实测） | 阶段精简 SDK 解决压顶 |
| 相变反演（1290 请求） | Pro xc=0.192；Flash 无相变（spec 强锚） | 接口-行为映射（archive/flash、archive/pro 全量数据） |
| 崩溃预算矩阵 | 32K→4K 收敛 5.8× | 预算即收敛机制（但不设帽——还原接口后自然短） |

---

## 七、版本史与演进

| 版本 | 事件 |
|---|---|
| v0.1.x | 分类路由（关键词计数换装）——已废弃（傻逼设计） |
| v0.2.0 | RL 接口还原（46 字符 + 双工具）——快速版 |
| v0.3.0 | 社区 real-assembly-chain fixes（claimed/pre-step/import 修复）——被社区改回分类路由 |
| v0.4 | react 定稿：RL 接口 + 自路由（native） |
| v0.5 | 渐进披露原型（catalog/help + 阶段门控） |
| v0.6 | we-team 实验（团队协议 → 废弃；PTC 压顶实测） |
| **v0.7** | **standard 定稿：渐进披露革命 + 记忆/知识融合 + 压力感应 + 泄压引导（PTC 底座）** |

**三大预设分工**：
| 预设 | 定位 |
|---|---|
| react | RL 接口还原 + 自路由（快速执行） |
| spec | 深度 persona + 自路由（雷霆大思考） |
| **standard** | **渐进披露革命（主力创新）** |

---

## 八、验收标准（用户实测驱动）

1. **首轮注意力**：首轮推理文本元思考占比显著下降（对比全目录基线）
2. **阶段推进自然**：了解→方案→开发→验证，无需用户干预（指引有效）
3. **行动率**：黑洞任务首轮 run_code 行动（不再 0 行动压顶）
4. **压力感知**：长推理/循环时提醒出现且适度（不骚扰）
5. **记忆闭环**：跨会话唤醒（阶段 0 recall 命中往事）、开发中 store 沉淀
6. **PTC 效率**：run_code 一次多操作（步数下降）

---

## 九、未来方向（待探索）

1. **阶段细化**：四阶段 → 按任务类型动态阶段（修复类任务跳过开发前阶段？）
2. **注意力度量**：正式量化元思考占比（vs 全目录基线对比实验）
3. **SDK 按需生成**：tools_help 对 PTC 的 SDK 内查询（run_code 内查工具签名）
4. **压力阈值自适**：按模型（Flash/Pro）自适应压力阈值
5. **记忆预取**：阶段 0 自动 recall（任务关键词 → 记忆入口预注入）
6. **发布形态**：standard 的披露机制提取为独立插件（dsh-progressive-tools），任何预设可用

---

## 十、实测体验问题与修复（v0.8，用户实测驱动）

> 本节的每一条都来自真实会话体验（router-standard-v22 live 会话，任务："读 STANDARD-PLAN.md 并自体验、自总结、自修复"），
> 不是推测。复现路径本身就是线索：会话起步即被文本信号误推进、只读查看就被当成"开发"。

### 10.1 复现到的体验痛点

| # | 现象 | 根因（代码） |
|---|---|---|
| 1 | 用户消息只包含文件名 `STANDARD-PLAN.md`，会话却自动从阶段 0 跳到"拟合方案"（从未调用 todo_write） | `autoAdvance` 文本信号用 `/计划|方案|plan/i` 宽匹配 |
| 2 | 用 `str_replace_editor` 仅仅 **view** 目录（只读），阶段却自动从"拟合方案"跳到"开发" | `autoAdvance` 只看工具名，不看 `command`；view/create/str_replace/insert 一律当作开发 |
| 3 | `tools_catalog` 只列出当前 restrict 可见的 34 项，计划书承诺的"48+ 全量索引"和 `tools_help` 查询锁定工具（如 subagent）都不存在 | shim `allSchemas()` 用 `schemas(agent)`——restrict 投影后的可见面，而非已知面 |
| 4 | `dev_router_status`（shim）只有 phase/unlocked/preset，描述却写"persona/override"；主注册版 `fmtMode` 反向（0 → react、1 → spec）；main 与 shim 各写一张 override 表，`dev_router_mode(react)` 后 status 仍显示 auto | shim 缺字段 + `fmtMode` 映射写反 + override map 未跨代共享 |
| 5 | 计划书写"阶段 3 → 交付：全量开放（restrict 释放）"，实际 `applyStageRestrict` 到阶段 3 仍设 allow={阶段工具+META}，subagent/workflow/ralph 永远不可见 | 最终阶段没有释放 restrict |
| 6 | `dev_reset_experience` 重置 stage=0 却不重新 `applyStageRestrict`，工具面仍是旧阶段 | 遗漏 restrict 重放 |
| 7 | pressure-sensor 从未在真实会话里触发过：它监听 `agent` / `assistant/chunk` / `tool/call`，而 DSH 实际事件通道是 `session/event` | 事件名错误，感应器形同虚设 |
| 8 | `phase_begin` 可重复执行并重复注入 Bootstrap guide（无 idempotence） | 未检查 `guided` 标记 |
| 9 | 含无 `time` 的历史/种子事件时，`e.time >= stageAt` 为 false，推进判定丢事件 | 时间过滤未兼容缺省时间 |
| 10 | 仓库集成测试 5 项失败：仍期待旧首轮 `pwsh/str_replace_editor` 与 pre-step 注入引导，与当前 phase_begin 门控实现脱节 | 测试未跟随实现演进 |

### 10.2 修复

| 文件 | 变更 |
|---|---|
| `preset/router-standard/router-bootstrap-v34.mjs`（+ `router-bootstrap.mjs` 同步） | ① 文本信号收紧：仅 `todo_write` 或 `开始开发/进入开发/着手实现/开始实现/write the code`；② `autoAdvance` 升级为携带参数的工具调用数组，`str_replace_editor` 仅 `create/str_replace/insert` 视为开发；③ `tools_catalog/tools_help` 走 `view(agent).knownNames` + 层链原始定义——**全量索引按需查，调用面仍受 restrict**；④ 统一 `overrideMap()`（globalThis Symbol）供 main/shim 共用；⑤ `dev_router_status` 补 mode/band/persona/override/fullCatalog，`fmtMode` 改用 `bandFor`（修正反向）；⑥ 最终阶段 `applyStageRestrict` 释放 restrict（不再新增 allow）；⑦ `phase_begin` 幂等（guided=true 只返回 started）；⑧ 时间过滤兼容 `time === undefined`；⑨ `dev_reset_experience` 重置时补 `applyStageRestrict(agent, 0)` |
| `preset/router-standard/pressure-sensor.mjs` | 改为监听 `session/event`（assistant/chunk / tool/call / tool/code-dispatch）；日志路径用 `join(DSH_HOME)` 跨平台；引导文案去掉 `run_code` 专属措辞，改为通用"call the next tool — write, edit, or run the next step" |
| `router.test.mjs` / `router.integration.test.mjs` | 集成测试重写为 phase_begin 门控 + 阶段推进语义；新增回归：文件名含 "plan" 不推进、view 不推进而 mutating 推进、最终阶段不再新增 restrict、`phase_begin` 只注入一次 |
| `docs/STANDARD-PLAN.md` | 本实测问题与修复章节 |

### 10.3 验证

- `node --test router.test.mjs router.integration.test.mjs` → **32/32 PASS**（修复前 5 项失败）
- 安装目录 `router-bootstrap-v34.selftest.mjs` → **SELFTEST PASS**
- `node --check` 全部改动文件通过
- 实弹（当前会话 `dev_reload_preset_live` 后）：
  - `tools_catalog(query:"subagent")` → 列出 subagent/subagent_fork/list_agents/send_message/workflow；`tools_help(subagent)` 返回完整 schema（此前"未知工具"）
  - `dev_router_status` → `mode=react (band=react)`、`override=1`、`fullCatalog=restrict released (all tools open)`
  - pressure-sensor 真实注入了一次 `loop-pattern x7` 提醒（修复前从未触发）

### 10.4 已知边界（诚实记录）

- 当前这个热重载会话的旧 restrict disposer 可能仍是历史代设置、不在 `sharedLift` 中（EXPERIENCE-LOG 条目 003 的老问题），所以"全量放开"在已开始的会话里可能仍受旧限制；**全新会话从零挂载新一代后，阶段 3 释放即真正生效**。
- `tools_catalog` 全量索引与调用面解耦：能查（看）并不代表当前阶段能调（用）——这正是计划的意图（二级披露：索引轻、详情重、调用仍按阶段）。

---

## 十一、计划对齐增量（v1.3.0，2026-08-22）

> §10 修复了「真实体验痛点」；本节补齐与策划书正面条款的剩余差距（引导注意力税 / 常驻 / 指引 / 标记 / 阈值自适）。

### 11.1 差距 → 增量

| 策划书条款 | 差距 | 增量 |
|---|---|---|
| §2.3 机制表「PTC SDK 阶段化」 | 只裁了 SDK（39K）；100-199 段每工具引导是静态注册、不受 restrict 过滤——同款注意力税 | `filterToolGuidance`：promoted 后仅保留「当前阶段可见工具」的 `tool:*` 引导段；安全规则＝后缀属全量真实名且不可见才裁（未知段名、交付阶段不裁） |
| §3.4「泄压引导（MAXential，persona 常驻）」 | PRESSURE_GUIDE 只在一次性 bootstrap 消息（压缩后会丢） | promoted 后常驻 `router-pressure` 段（order 3） |
| §2.3「解锁指引：要解锁 X，先做 Y」 | STAGE_GUIDES[1..3] 从未使用（死代码） | `stageText` 并入 `STAGE_GUIDES[stage]`（每阶段指南常驻 system prompt，免 message 打断、压缩不丢）；阶段 0 指南加入「先 recall/verify 再动手」 |
| §2.4 注意力经济 / §3.1 记忆闭环 | 索引与 shim 各一份实现（漂移）；主实现仍用全局视图（漏 preset 层工具） | `registryFullIndex`/`knownToolNames` 共享实现；main 与 shim 同源 |
| §9.4 压力阈值自适 | 阈值写死 | pressure-sensor `FLASH_SCALE=0.6`（Flash 系 30K→18K、循环 4→2） |
| 二级披露的「索引轻」 | catalog 行无可用性信息 | `markerFor`：每行 `[当前/预放/锁定/meta/全量]`——先看能调什么，再挑工具 |

### 11.2 验证

- `node --test` 单测 20/20 + 集成 14/14 PASS（新增 guidance 裁剪、marker 语义、常驻段断言）
- 安装目录 selftest PASS（含 v1.3 新断言）；`agentPresets.standingKeyFor('router-standard-v22')` → MOUNTED OK
- 版本戳 ?v=23 → ?v=24（dev + installed 同步）

---

## 十二、实弹体验吸收（v1.4.0，2026-08-22）

> 用户实弹报告（Gargantua 构建会话，四阶段全场跑通）喂出的摩擦吸收：不改架构，把「探路灯」放进常驻文本与二级披露。

### 12.1 摩擦 → 吸收

| 实弹摩擦 | 吸收（v1.4.0） |
|---|---|
| 所有工具经 run_code 调，签名不统一（glob `pattern` / read `file_path` / todo_write `content`），来回试错 | `paramHint`：tools_catalog 每行内嵌 `(params: …)`；PROGRESSIVE_DECL 常驻「首次使用前看签名，never guess」 |
| 文件改过后 edit 被「请重新读取」拦 | STAGE_GUIDES[2]：改前重读规则（编辑器强制新鲜读） |
| `bash` 表现像 PowerShell（本机复核未复现：系统 PATH 有 Git bin、GNU 输出正常） | STAGE_GUIDES[3]：Windows 优先 pwsh；bash=Git Bash（GNU）如实说明。**v1.4.1 补事实层**：apply() 把 `bash.exe` 候选（PATH 序）写入 `bash-diag.json`——sandbox 继承本进程 env，此处顺序即工具内解析顺序；下次实弹读事实，不再猜 |
| headless 浏览器沙箱拦截 | STAGE_GUIDES[3]：对同一条命令一次性提升（既定协议），禁止绕过——不放松沙箱（预设即其命名插件的特权之和） |
| read_image 一次一张，多图对比效率低 | STAGE_GUIDES[3]：逐张读，或用 pwsh 拼 contact sheet 一次读（read_image 确认无多图能力，故为指引而非改工具） |

### 12.2 验证

- 单测 21/21 + 集成 14/14 + selftest PASS（含 paramHint/常驻指引断言）；standingKeyFor → MOUNTED OK；?v=25。

---

## 十三、二轮实弹根因修复（v1.5.0，2026-08-22）

> 六项反馈中三项找到硬根因（非指引可解）：bash=PowerShell 是组合错误、node 不在 PATH 是运行时路径、headless 600s 挂起是 profile 互斥锁。

| 反馈 | 根因（源码级） | 修复 |
|---|---|---|
| bash 像 PowerShell（pwd 表格/cmdlet 报错） | **dsh-base 在 win32 只装配 pwsh 且 disabled bash-sandbox**；preset 的 bash 行继承了 pwsh 语义 | agent.cordis.yml：tool-bash 在 win32 禁用（与 host 对齐）；STAGES 平台化（win32 移除 bash）；applyStageRestrict 按 restrictableNames 双过滤（平台缺失名不再击穿阶段门控） |
| node 不在 PATH（无法 node --check） | harness node 位于 .hanako 自定义运行时目录，不在系统 PATH | PATH 修整：`dirname(process.execPath)` 前置（node 直通所有 shell 工具） |
| headless 600s 挂死、无产物 | **Chrome profile 互斥锁**（无 `--user-data-dir` 时挂起）；且无硬超时/杀树 | 新 meta 工具 **`dev_page_check`**：新鲜 profile（实测 1.5s 出 DOM+PNG）+ 硬超时杀树（默认 20s/上限 180s）+ `--dump-dom` DOM smoke + 截图落 `.dsh-shots/`；`?shot=` 重页面按需调大预算 |
| write/edit 回显灾难（8 万+字符截断） | dsh-tool-fs 的 VALUE 带全量 before/after（UI diff 卡用）；模型 print 绑定结果即爆上下文 | 常驻指引：只取 path/operation、勿 print 全量；**包级修复（VALUE→hunk 摘要）属 host 包，明确未动**（边界） |
| 直调 phase_advance 浪费一轮 / dev_router_status 传 {} 报错 / read limit 2000 运行时才发现 | run_code 折叠规则未言明 + 零参工具契约 + 运行时 cap | 常驻文档：只有 run_code 可直调、零参传 `{}`、上线前查 tools_help；paramHint 带类型+默认上限（`limit: number≤2000`） |
| pressure 提醒噪音 | 冷却 2 步 | 冷却 3 步 |

**验证**：单测 22/22 + 集成 14/14 + selftest PASS + MOUNTED OK（?v=28）；页面配方实测（轻页 1.5s；重页 66s 硬超时杀树正常返回，不再挂死）；本机 CPU 重载测试按用户要求停止，重页全链路截图留待按需。

---

## 十四、三轮实弹修复（v1.6.0，2026-08-22）

> 三项硬修复 + 四项语义/契约澄清。P0 是 dev_page_check 的 shim 序列化——上轮的"已内置页面验证"宣传在 shim 路径上确实是断的。

| 反馈 | 修复 |
|---|---|
| **P0：dev_page_check 序列化坏**（invalid output: value must be a string） | shim `make()` 硬编码字符串输出；改为透传 `def.output`（对象 schema + 专属 render），shim 版补对象输出——工具立即可用 |
| "先推进度再干活"摩擦（写 HTML 要先玩路由） | **预放两档**：阶段 0 即见 write/edit（stage+3 语义）；**直达语义**：调用预放工具直达其档、开发意图文本直达（写一个/创建/生成/…）——直给任务零路由成本；phase_advance 明确"逐级一次不跳级" |
| 中文路径需手工百分号编码 | `normalizePageUrl`：裸路径/相对路径/中文路径自动转 file:// URL（pathToFileURL），非 http/file scheme 原样拒绝 |
| loop-pattern x31 无含义、像"你该停手了" | pressure 提醒改为"self-check signal, not an order"+ 每个触发器含义（loop-pattern=高频重复犹豫词，不是停手命令） |
| 跨语言转义踩坑（JS 模板里的 PowerShell `${env:V}`） | STAGE_GUIDES[2] 常驻提醒：run_code 程序是 JS——交叉语言字符串先防插值（单引号/拼接） |
| Chrome 异步落地误判失败 | STAGE_GUIDES[3]：dev_page_check 返回 settled result，无需轮询（$LASTEXITCODE/延迟写出坑由工具消化） |
| dev_router_status 结构不一致 / HEALTH CHECK / approval 通告 | 状态主/shim 契约统一并写进描述（文本行 + unlocked=[…]）；HEALTH CHECK 与 approval-policy 通告非本 preset（环境插件 + 宿主 approval 子系统事件） |

**验证**：单测 23/23 + 集成 14/14 + selftest PASS + MOUNTED OK（?v=29）；全程零浏览器运行。

> **v1.6.1 追加（?v=30，"自己想办法修复"，不等复现）**：dev_page_check 第二轮根因链——失败分支返回 `{ok:false,error}`（缺 schema 7 字段 + error 不在 additionalProperties:false 内）→ 任意失败路径照样 invalid output；已统一 `pageFail()` 全形状，并把 shim 注册路径做成集成回归（对象 schema + render + 7 字段全分支断言，单测 23/23 / 集成 16/16 / MOUNTED OK）。

---

*本策划书随实现演进更新——机制以代码为准，方向以用户为准。*
