# 计算营 AI Copilot

AI 副驾系统 —— 面向小学低年级计算营的教师服务系统。AI 不替代老师，而是坐在老师旁边，帮老师处理最重、最重复的工作，让老师专注于真正需要判断和温度的地方。

## 核心流程

```
上传作业图片（网页上传 / 飞书多维表格自动化）→ 腾讯云批改 → 结构化结果渲染 → 老师复核修改 → AI 生成六模块反馈 → 老师编辑调整 → 发给家长
```

## 功能

### 作业管理（列表页）

- **左右分栏布局**：左侧上传区 + 右侧作业记录列表
- **图片上传**：拖拽/选择上传，Canvas 重绘消除 EXIF 旋转，超过 7.3MB 自动降质压缩
- **视觉识别**：上传图片后自动调用豆包视觉模型（`doubao-seed-2-0-mini-260215`）识别作业所属学期和天数（含"第X周易错点加练"→22/23/24天映射），支持手动修改
- **串行队列**：同时最多 1 个任务提交腾讯云批改，其余排队等待（PENDING），前一个完成后自动推进下一个
- **实时状态**：待处理（灰色）、处理中（蓝色动画）、已完成（绿色）、处理失败（红色）
- **记录管理**：支持删除，已完成记录可点击"查看"在新窗口打开批改详情

### 批改详情（详情页）

- **学期切换**：同一学生有多个学期数据时，姓名旁显示学期切换按钮
- **天数导航**：顶部固定显示 1-24 天按钮（1-21 为日常作业，22-24 为第一/二/三周易错点加练），有作业的天数高亮可点击；每天 tab 下显示核对/反馈状态小点
- **学期简写**：学期统一使用简写格式（如"二下"表示二年级下学期），按年级+上下自动排序；旧格式数据（如"二年级下"）首次读取时自动清洗
- **同天多次提交**：同一天有多次提交时，作业原图区域显示序号切换器（1、2、3...）
- **标注渲染**：在作业原图上叠加对错标注框，点击可定位到右侧对应答案详情
- **人工标注**：老师可框选 AI 未识别的题目标记对/错，视觉与系统标注完全一致；点击可切换对错/删除；计入总题数和正确率；标注模式下 AI 标注降低透明度
- **全部隐藏/显示**：纯视觉切换，临时隐藏所有标注方便查看原图，不影响数据统计和持久化
- **导出图片**：截取当前带标注的作业图片（包含系统标注 + 人工标注，隐藏的不导出），优先复制到剪贴板，不支持时自动下载 PNG（html2canvas 渲染）
- **核对/反馈状态**：Tab 旁有"未核对/已核对""未反馈/已反馈"按钮，状态持久化到后端；标签样式与任务看板一致：红色"待复核/待反馈"、绿色"已复核/已反馈"；标签带复选框图标，hover 显示提示，有按钮交互反馈（shadow + translateY）
- **老师复核**（批改复核 Tab）：
  - 置顶筛选栏（全部/错题/正确/已展示/已隐藏 + 数量）
  - 每道题有醒目的双按钮判定组（✓ 正确 / ✗ 错误），老师可切换，修改自动持久化
  - 每道题有隐藏/展示切换，隐藏后答案内容弱化但操作按钮清晰，联动左侧标注，状态自动持久化
  - 答案详情支持 KaTeX 公式渲染
- **AI 反馈建议**（反馈建议 Tab）：基于老师最终判定结果 + 作业原图（多模态），调用豆包大模型流式生成；进入详情页即自动预加载
- **六模块结构**（基于老师反馈模板设计，由模型个性化生成）：
  - **一、整体情况反馈**：正向总结 + 数据统计，自然段落输出
  - **二、书写评价**：基于图片观察的三维度评价（整体书写/字迹清晰度/卷面整洁度）+ 段落评语，作为周报书写评价的直接数据源
  - **三、问题分析**：按知识点归类的三层结构（加粗标题→属性行→编号解题步骤），严格匹配老师模板层级；另含计算习惯与过程规范部分
  - **四、整体改进计划**：每日核心目标 + 3分钟自查步骤 + 针对性练习建议
  - **五、给家长的小提示**：可直接发给家长的温和沟通段落
  - **六、加练题目**：基础巩固/巩固/挑战三个难度各 3-5 道，合并展示，支持单题勾选和图片导出
- **模块导出图片**：模块一至五均支持"导出图片"按钮，使用 html2canvas 截取模块内容（含去序号标题），优先复制到剪贴板，不支持时下载 PNG
- **模块二次调整**：每个模块（含加练题目）支持直接编辑 Markdown 原文，或输入补充指令后 AI 单独重新生成
- **加练拼盘**：三个难度合并为一个模块，支持单题勾选、按难度全选/取消，选中题目可导出为图片（复制到剪贴板或下载 PNG）
- **禁词机制**：prompt 严格约束禁止笼统归因（粗心/马虎等）、否定能力等表述；禁止输出大模型思考过程
- **反馈持久化**：生成的反馈内容保存到服务端，刷新页面后自动加载
- **左右分栏**：可拖拽调整比例，默认根据图片宽高比自动适配

### 任务看板（工作台首页）

老师每天打开系统的第一个页面，提供完整的任务管理和工作状态可视化。页面分为三大区域，左侧彩色竖条标识：🔵蓝色「任务总览」、🔴红色「待办任务」、🟢绿色「班课学生看板」。

#### 顶部状态面板（任务总览）
- **个性化问候 + 服务天数**：根据时间段切换上午好/下午好/晚上好 + 老师名字；右侧显示 VIP 风格金色标签「服务期 第X/24天」（超过 24 天显示「服务期已完成」），天数从期起始日期自动计算
- **昨日回顾**：自动统计昨天收到的作业提交数、完成的复核次数和反馈次数，换行展示，语气更贴近日常
- **左右分区看板**：左侧"待处理"（待复核 + 待反馈，仅统计到当前服务天数），右侧"今日成果"（新提交 + 已复核 + 已反馈 + 交作业人数/总人数）
- **整体进度条**：X份作业已提交，Y份已完成全部流程
- **实时事件流**：最近5条动态（新提交/已复核/已反馈），可点击跳转

#### 收件箱任务队列（待办任务）
- **文件夹式 Tab**：全部任务/待复核/待反馈/未提交，带红色数量角标
- **任务卡片**：显示学生名 > 复核/反馈状态 > 等待时长 > 天数 > 学期
- **时间筛选**：全部/今天/昨天/近两天/近一周
- **排序**：按编辑时间/天数排序，各 tab 独立存储偏好到后端
- **冻结功能**：每张卡片支持冻结/解冻，冻结后不计入统计、灰显放到列表末尾
- **提醒家长**：未提交学生卡片有"提醒"按钮，调用豆包 2.0 lite 生成个性化提醒文案（结合学生实际提交数据和当前服务天数），支持编辑 + 补充指令重新生成 + 一键复制
- **未提交天数基于服务天数**：缺交天数只计算到「当前服务天数」而非固定 24 天，避免把未来天数也算作缺交
- **默认收起 3 行**，超出可展开/收起

#### 底部学生矩阵（班课学生看板）
- 学生×24天状态矩阵，始终可见不受 tab 影响
- 格子四种状态：未提交(灰底) → 已提交(白底灰边) → 已复核(白底绿边) → 全部完成(浅绿底)
- 状态点：灰=未完成，绿=已完成（复核点 + 反馈点）
- 阶段报告入口：周报1/2/3 + 总结，三种状态（不可生成/可生成/已生成）
- 天数22-24显示为"第一/二/三周易错点加练"

### 学情分析

- **个人学情**：选择学生 → 正确率趋势 + 知识点掌握 + 错题列表（按天数/知识点排序）
- **阶段报告入口**：周报 1/2/3 + 总结卡片，三种状态（不可生成/可生成/已生成）
- **视觉一致**：Pill 按钮式 Level 切换 + 自定义下拉选学生，与任务看板风格统一

#### 全班概览（教研增强，6 模块）

全班概览面向教研分析，自上而下排列 6 个模块：

1. **班课数据总览**：顶部 6 格统计卡片（参与学生数、总提交天次、总题数、平均正确率、人均完成天数、满分天次）
2. **每日正确率趋势**：柱状图 + 全班平均虚线 + 难度异常天红色标注（低于平均 15%+）+ 参与人数标注
3. **高频错题**：全量加载，默认展示 TOP 10，支持展开全部。每题可展开查看做错学生名单 + 学生答案 + 作业原图缩略图
4. **知识点掌握全景**：全部知识点四层分级（薄弱/需加强/良好/完全掌握），不同颜色标识，显示涉及学生数
5. **学生排行（增强）**：正确率排行 + 满分之星⭐ / 坚持之星💪 荣誉标注 + 全班中位数线
6. **AI 教研建议**：进入页面自动生成并保存，支持补充指令注入重新生成。基于全班结构化数据生成 3-5 条教研优化建议

### 周学习报告

周学习报告面向家长，A4 分页设计，视觉风格遵循 DESIGN.md（洋葱蓝色调 + Alibaba PuHuiTi 2.0 字体 + 洋葱学园 Logo）。内容结构基于老师实际周报模板改造，分为 5 个模块：

1. **基本信息** — 5 格卡片（统计周期、练习天数、题目总数、正确数、总体正确率）+ 每周进步速览表格（天/题数/正确/错误/正确率）
2. **精彩表现** — 合并展示 4 个子模块：本周亮点（星标列表）、掌握的知识点（文本列表）、值得称赞的细节（圆点列表）、书写评价（评价图标卡片 + 老师点评）
3. **易错汇总** — 编号橙色卡片，每题展示题目 + 学习小技巧（LLM 生成）
4. **学习建议** — 三段式：鼓励话语 + 成长空间 + 练习建议（LLM 生成）
5. **老师备注** — 可选的手动填写区

#### 大拇指评价体系
三维度打分（正确率 0-5 + 坚持练习 0-3 + 满分表现 0-2）→ 总分 0-10 → 映射 1-5 个 👍。不使用进步/退步比较（每天题目难度不同）。

#### 重新生成
支持补充指令注入（与反馈建议逻辑一致），指令优先级最高。

#### PDF 导出
服务端 Puppeteer 渲染：从 `reports` 表取数据 → `buildReportHtml()` 生成完整 HTML（内嵌 CSS + Alibaba PuHuiTi 2.0 字体 + base64 Logo）→ `page.setContent()` + `page.pdf()` → 返回 PDF 文件流。不依赖前端服务、不依赖系统字体。Puppeteer 使用浏览器单例模式（60s 空闲后自动关闭），减少 PDF 导出对系统资源的冲击。

#### 设计规范
- **色调**：洋葱蓝（#1B6AFF / #2B7FFF / #E8F0FE 等梯度）
- **字体**：Alibaba PuHuiTi 2.0（本地安装 + 服务器部署，多字重支持）
- **Logo**：洋葱学园品牌标识，封面和页脚均嵌入
- **前端与 PDF 一致**：两端共享相同的视觉规范，所见即所得

### 学期总结视频

基于 Remotion 的个人学期总结视频，面向家长，以动态视频 + 老师语音旁白呈现学生整期学情。

- **6 个场景**：封面 → 数据总览 → 正确率趋势折线图 → 知识点掌握（环形图 + Top5/Bottom5）→ 大拇指评价 + 老师寄语 → 结尾
- **本期亮点**：从整期统计数据直接提炼 3-5 条简洁亮点（满分天、出勤、知识点掌握、正确率等），不再拼接周报原文
- **LLM 台词**：豆包 2.0 lite 基于每日正确率明细等真实数据生成 5 段旁白，如实描述趋势
- **TTS 语音**：火山引擎 TTS 合成老师语音，旁白时长驱动场景时长
- **逐句字幕**：底部居中，按标点拆句，按字数比例分配时间，淡入淡出
- **BGM 支持**：框架已内置，放入 `summary-video/public/bgm.mp3` 即自动混入（10% 音量）
- **渲染流水线**：SQLite → LLM → TTS → Remotion 无声画面 → FFmpeg 合并音视频

详见 `summary-video/` 目录和架构文档附录 C。

### 外部系统对接

- **飞书多维表格直连**：通过飞书自动化（Flow A）直接调用 `submit-async` API 提交批改，批改完成后回调飞书工作流（Flow B）写回结果，无需中间系统
- **数据字段**：Flow A 传递 `imageUrl`、`studentName`、`semester`、`day`、`term`（班课月份）、`teacherName`（负责老师）、`callbackUrl`；其中 `semester` 仅接受一上~六下格式，`day` 仅接受纯数字，其他值视为空
- **链接分享**：批改完成后生成可直接访问的详情页链接
- **兼容旧接口**：`submit-url`（同步）和 `submit-file`（文件上传）仍可用于其他外部系统对接

## 页面架构

### 顶部导航

```
计算营 AI Copilot  [任务看板] [作业批改] [学情分析]    2026年4月 📅4/9  欣欣老师
                                                     ↑期选择  ↑期起始日期（点击设置）
```

### 列表页（作业批改）

```
┌─────────────────────────────────────────────────────────────┐
│  计算营 AI Copilot  [任务看板] [作业批改] [学情分析]          │
├────────────────────────┬────────────────────────────────────┤
│  上传作业               │  作业记录                   共 N 条 │
│                        │                                    │
│  [拖拽/点击上传图片]    │  [缩略图] 段喆 二年级下 D13        │
│                        │          3/25 23:44    已完成 [查看] │
│  学生名字：[输入框] *   │                                    │
│  学期：[自动识别]       │  [缩略图] 段喆 二年级下 D12        │
│  第几天：[自动识别]     │          3/25 23:43    处理中       │
│                        │                                    │
│  [开始批改]             │  ...                               │
└────────────────────────┴────────────────────────────────────┘
```

### 详情页

```
┌─────────────────────────────────────────────────────────────┐
│  计算营 AI Copilot  [任务看板] [作业批改] [学情分析] [返回列表] │
├─────────────────────────────────────────────────────────────┤
│  段喆  二年级下                                              │
│  [1][2][3][4][5][6][7][8][9][10][11][12][13][14]...[21]     │
├──────────────────────┬──────────────────────────────────────┤
│  作业原图  [1][2]    │  总题数 12  正确 10  错误 2  83%     │
│  [查看大图]          ├──────────────────────────────────────┤
│  + 标注叠加          │  [批改复核]  [反馈建议]               │
│                      ├──────────────────────────────────────┤
│                      │  Tab 内容区                           │
│                      │  批改复核：答案详情 + 老师修改判定     │
│                      │  反馈建议：模块化卡片（进入即预加载）  │
│                      │    加练卡片：题目区[复制] / 答案区[复制]│
└──────────────────────┴──────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3.5 + Composition API + `<script setup>` |
| 构建工具 | Vite 6 |
| 路由 | Vue Router 4 + unplugin-vue-router（文件路由） |
| 状态管理 | Pinia |
| UI 组件 | @guanghe-pub/onion-ui |
| 公式渲染 | KaTeX 0.16 + marked（增强的公式验证、LLM 输出清洗、渲染失败降级） |
| 图片导出 | html2canvas（加练题目导出 + 带标注作业原图导出） |
| 图片压缩 | sharp（服务端，发送给 LLM 前压缩至长边 1200px / JPEG quality 70） |
| 样式 | SCSS |
| 数据库 | SQLite（better-sqlite3 同步驱动） |
| 后端框架 | Hono 4（Node.js） |
| 后端运行 | tsx |
| AI 批改 | 腾讯云试题批改 Agent（tencentcloud-sdk-nodejs-ocr） |
| AI 反馈 | 火山引擎 Ark · 豆包大模型（doubao-seed-2-0-lite，多模态图文输入，流式输出，`reasoning_effort: minimal`；图片经 sharp 压缩至长边 1200px/JPEG quality 70 后送入） |
| AI 视觉识别 | 火山引擎 Ark · 豆包视觉模型（doubao-seed-2-0-mini，Responses API） |
| 字体 | Alibaba PuHuiTi 2.0（本地安装，多字重，覆盖报告 + 视频） |
| 设计系统 | DESIGN.md（洋葱学园风格，蓝色主色调，参考 awesome-design-md） |
| PDF 生成 | Puppeteer（服务端 HTML → PDF，Alibaba PuHuiTi 字体 + base64 Logo，浏览器单例模式） |
| 视频生成 | Remotion 4（React 编程式视频）+ FFmpeg（音视频合并） |
| 语音合成 | 火山引擎 TTS（`openspeech.bytedance.com`） |
| 部署 | PM2 + Nginx（OpenResty） |

## 项目结构

```
homework-correction/
├── index.html
├── package.json
├── DESIGN.md                   # 设计系统文档（洋葱学园视觉规范）
├── vite.config.ts              # Vite 配置，dev proxy /api → localhost:3300
├── env/
│   ├── .env.development        # VITE_API_BASE=/api
│   └── .env.production         # VITE_API_BASE=/homework-api
├── src/
│   ├── main.ts                 # Vue 应用入口（含 KaTeX CSS 引入）
│   ├── pages/
│   │   ├── index.vue           # 列表页（上传 + 作业记录列表）
│   │   ├── correction.vue      # 详情页（天数导航 + 批改结果 + 反馈建议）
│   │   ├── dashboard.vue       # 任务看板（工作台首页）
│   │   ├── analytics.vue      # 学情分析（个人学情/全班概览）
│   │   └── report.vue         # 周学习报告预览 + PDF 导出
│   ├── components/
│   │   ├── ImageUploader.vue   # 图片上传（拖拽 + 选择）
│   │   ├── CorrectionOverlay.vue # 原图 + 标注叠加渲染
│   │   ├── ImageFullscreenModal.vue # （已废弃，导出图片功能内置于 correction.vue）
│   │   ├── ReviewPanel.vue     # 右侧面板（统计条 + Tab + 反馈卡片 + 加练分区复制）
│   │   ├── MarkdownKatex.vue   # Markdown + KaTeX 渲染组件
│   │   └── AnswerDetail.vue    # 单个答案详情
│   ├── composables/
│   │   └── useImageCompress.ts # 图片预处理（EXIF 消除 + 超限降质）
│   ├── stores/
│   │   ├── useCorrection.ts    # 批改详情页状态（批改 + 反馈生成）
│   │   ├── useJobList.ts       # 列表页状态（作业列表 + 上传队列）
│   │   └── useApp.ts           # 全局状态（老师身份、期、学期切换、期起始日期 + 服务天数计算）
│   └── styles/main.scss
└── server/
    ├── package.json
    ├── .env                    # 密钥配置（不提交到 Git）
    ├── .env.example
    ├── src/
    │   ├── index.ts            # Hono 服务入口
    │   ├── lib/
    │   │   ├── ocr.ts          # 腾讯云 OCR 客户端（共享）
    │   │   ├── storage.ts      # 文件存储（jobs/images/feedback）
    │   │   └── database.ts     # SQLite 连接管理、schema、migration
    │   └── routes/
    │       ├── correction.ts   # 批改提交 + 查询 + 串行队列
    │       ├── feedback.ts     # 反馈建议生成（豆包大模型，多模态图文，流式）
    │       ├── jobs.ts         # 作业列表 + 删除 + 按学生查询 + 队列推进
    │       ├── vision.ts       # 视觉识别（学期 + 天数）
│       ├── dashboard.ts    # 工作台 API（矩阵、排序偏好、冻结、提醒文案）
│       ├── analytics.ts    # 学情分析 API
│       ├── teachers.ts     # 老师/归属管理 API
│       └── report.ts       # 周报生成 + PDF 导出（LLM 流式 + Puppeteer）
    └── scripts/
        ├── sync-remote-data.ts   # 从远程服务器同步作业数据和图片
        ├── init-demo-data.ts     # 初始化 demo 数据（老师 + 学生归属）
        └── migrate-term-teacher.ts # 数据清洗：补全 term（班课月份）和 teacher_id（负责老师）
        └── parse-pdf-answers.ts  # 解析标准答案PDF写入question_templates
```

### 总结视频子项目（summary-video/）

```
summary-video/
├── src/
│   ├── index.ts                # Remotion 入口
│   ├── Root.tsx                # 注册 Composition
│   ├── SummaryVideo.tsx        # 主组件（场景编排 + 字幕）
│   ├── types.ts                # 数据类型
│   ├── render-with-data.ts     # 渲染脚本：SQLite → LLM → TTS → Remotion → FFmpeg
│   ├── narration.ts            # 旁白生成（LLM台词 + TTS语音 + 时长计算）
│   └── scenes/                 # 6 个场景组件 + 字幕层
├── public/
│   └── bgm.mp3                 # 背景音乐（可选，放入即启用）
└── out/                        # 渲染输出目录
```

## 快速开始

### 1. 安装依赖

```bash
npm install
cd server && npm install
```

### 2. 配置密钥

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`：

```
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
ARK_API_KEY=你的火山引擎ArkAPIKey
PORT=3300
PUBLIC_URL=http://43.167.191.81/homework
```

### 3. 启动开发服务

```bash
# 启动后端（端口 3300）
cd server && npx tsx src/index.ts

# 启动前端（端口 5173，自动代理 /api 到后端）
npm run dev
```

访问 http://localhost:5173/homework/ 即可使用。

## 服务器部署与更新

### 线上信息

| 项目 | 值 |
|------|----|
| 线上地址 | `http://43.167.191.81/homework/` |
| API 地址 | `http://43.167.191.81/homework-api/` |
| 服务器项目目录 | `/home/ubuntu/homework-correction` |
| 前端静态目录 | `/opt/1panel/www/sites/souti35/index/homework/` |
| Nginx 配置 | `/opt/1panel/www/sites/souti35/proxy/root.conf` |
| 后端端口 | `3300` |
| PM2 进程名 | `homework-server` |
| 代码来源 | `git@github.com:playjiji/homework-correction.git` |

### 首次部署

#### 1. 服务器准备

```bash
ssh ubuntu@43.167.191.81
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
```

如果服务器还没有 Node / PM2：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 20
npm install -g pm2
```

#### 2. 配置 GitHub SSH

服务器需要配置自己的 SSH key，并添加到 GitHub 账号，否则无法直接 `git clone` 私有仓库：

```bash
ssh-keygen -t ed25519 -C "homework-server" -f ~/.ssh/id_ed25519 -N ""
ssh-keyscan github.com >> ~/.ssh/known_hosts
cat ~/.ssh/id_ed25519.pub
```

把输出的公钥添加到 GitHub 的 `SSH and GPG keys` 后，验证：

```bash
ssh -T git@github.com
```

出现 `You've successfully authenticated` 即可。

#### 3. 拉取代码并恢复环境变量

```bash
git clone git@github.com:playjiji/homework-correction.git ~/homework-correction
cd ~/homework-correction
cp server/.env.example server/.env
```

然后编辑 `server/.env`，至少保证：

```bash
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
ARK_API_KEY=你的火山引擎Ark API Key
PORT=3300
PUBLIC_URL=http://43.167.191.81/homework
```

#### 4. 安装依赖并构建

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"

npm config set registry https://registry.npmmirror.com
cd ~/homework-correction && npm install --legacy-peer-deps
cd ~/homework-correction/server && npm install
cd ~/homework-correction && npm run build
```

#### 5. 发布前端静态文件

```bash
sudo rm -rf /opt/1panel/www/sites/souti35/index/homework
sudo cp -r ~/homework-correction/dist /opt/1panel/www/sites/souti35/index/homework
sudo chmod -R 755 /opt/1panel/www/sites/souti35/index/homework
```

#### 6. 配置并重启后端

如果 `homework-server` 还不存在：

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/homework-correction/server
pm2 start "npx tsx src/index.ts" --name homework-server
pm2 save
```

如果进程已经存在：

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
pm2 restart homework-server
```

#### 7. Nginx / OpenResty 配置

`/opt/1panel/www/sites/souti35/proxy/root.conf` 中需要包含：

```nginx
location /homework-api/ {
    proxy_pass http://127.0.0.1:3300/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding on;
}

location /homework/ {
    alias /www/sites/souti35/index/homework/;
    index index.html;
    try_files $uri $uri/ /homework/index.html;
}
```

修改后重载 OpenResty：

```bash
sudo docker exec $(sudo docker ps -q --filter name=openresty) nginx -s reload
```

### 日常更新 SOP

以后不再使用 `scp` 传整个项目，而是使用 `GitHub + 服务器 git pull`：

```bash
# 1. 本地提交并推送
cd /本地/homework-correction
git add -A
git commit -m "你的提交信息"
git push origin main

# 2. 服务器拉取最新代码
ssh ubuntu@43.167.191.81
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/homework-correction
git pull

# 3. 如依赖有变化，重新安装
npm config set registry https://registry.npmmirror.com
npm install --legacy-peer-deps
cd server && npm install && cd ..

# 4. 重新构建并发布前端
rm -rf dist
npm run build
sudo rm -rf /opt/1panel/www/sites/souti35/index/homework
sudo cp -r dist /opt/1panel/www/sites/souti35/index/homework
sudo chmod -R 755 /opt/1panel/www/sites/souti35/index/homework

# 5. 重启后端 + 重载 Nginx
pm2 restart homework-server
sudo docker exec $(sudo docker ps -q --filter name=openresty) nginx -s reload

# 6. 验证
curl http://127.0.0.1:3300/api/health
curl -I http://127.0.0.1/homework/
curl http://127.0.0.1/homework-api/health
```

### 当前验证过的线上状态

本次已验证以下链路正常：

- `http://43.167.191.81/homework/` 返回 `200 OK`
- `http://43.167.191.81/homework-api/health` 返回健康检查 JSON
- `pm2 list` 中 `homework-server` 状态为 `online`

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/correction/submit` | POST | 上传图片 + 学生信息，串行队列控制 |
| `/api/correction/query?jobId=xxx` | GET | 查询批改结果（轮询） |
| `/api/correction/submit-url` | POST | 图片 URL 提交（同步，供外部系统） |
| `/api/correction/submit-async` | POST | 异步批改：立即返回 jobId，后台完成后回调 callbackUrl（供飞书自动化）。支持 `term`（班课月份）和 `teacherName`（负责老师）参数 |
| `/api/correction/submit-file` | POST | 文件上传提交（同步） |
| `/api/correction/result/:jobId` | GET | 获取已存储的批改结果 |
| `/api/correction/image/:jobId` | GET | 获取已存储的作业图片 |
| `/api/feedback/generate` | POST | 生成反馈建议（流式） |
| `/api/feedback/regenerate-module` | POST | 单模块重新生成（流式，传模块标题+补充指令） |
| `/api/feedback/save` | POST | 保存反馈内容 |
| `/api/feedback/load/:jobId` | GET | 加载已保存的反馈 |
| `/api/jobs` | GET | 作业列表（自动刷新 PROCESSING 状态 + 队列推进） |
| `/api/jobs/:jobId/delete` | POST | 删除作业记录 |
| `/api/jobs/:jobId/review-state` | POST | 保存老师复核状态（对错修改 + 隐藏答案） |
| `/api/jobs/:jobId/manual-annotations` | POST | 保存人工标注数据 |
| `/api/jobs/:jobId/flags` | POST | 更新核对/反馈状态标记 |
| `/api/jobs/by-student?studentName=xxx` | GET | 按学生查询（按学期分组返回） |
| `/api/vision/analyze` | POST | 视觉识别学期 + 天数 |
| `/api/dashboard/matrix` | GET | 学生×天数状态矩阵（按老师×期） |
| `/api/dashboard/overview` | GET | 今日概览统计 |
| `/api/dashboard/sort-prefs` | GET/POST | 获取/保存排序和时间筛选偏好 |
| `/api/dashboard/freeze` | POST | 冻结/解冻任务 |
| `/api/dashboard/remind` | POST | 生成提醒家长文案（流式，豆包2.0 lite，传入 `currentDay` 服务天数） |
| `/api/dashboard/term-start` | GET/PUT | 获取/设置当前期的起始日期，用于计算服务天数 |
| `/api/teachers` | GET | 获取所有老师列表 |
| `/api/teachers/:id/enrollments` | GET | 获取某老师负责的所有 level 和学生 |
| `/api/analytics/student-trend` | GET | 个人正确率趋势 |
| `/api/analytics/student-errors` | GET | 个人错题列表 |
| `/api/analytics/student-knowledge` | GET | 个人知识点掌握情况 |
| `/api/analytics/class-overview` | GET | 全班概览统计（含满分天次） |
| `/api/analytics/class-knowledge-top` | GET | 全班知识点（支持 limit=all，含涉及学生数） |
| `/api/analytics/class-error-questions` | GET | 全班高频错题（按题目聚合，含做错学生列表） |
| `/api/analytics/class-advice` | GET | 加载已保存的全班教研建议 |
| `/api/analytics/class-advice/save` | POST | 保存全班教研建议 |
| `/api/analytics/class-teaching-advice` | POST | AI 教研建议流式生成（豆包 2.0 lite，支持补充指令） |
| `/api/report/generate-weekly` | POST | 聚合数据 + LLM 流式生成周报（支持补充指令） |
| `/api/report/weekly` | GET | 获取已保存的周报 |
| `/api/report/status` | GET | 批量查询报告生成状态 |
| `/api/report/export-pdf` | GET | 服务端 Puppeteer 生成 PDF 下载 |
| `/health` | GET | 健康检查 |

## 踩坑记录

### 1. EXIF 旋转导致标注坐标偏移

手机拍摄的照片带有 EXIF orientation 信息。浏览器 `<img>` 会自动应用 EXIF 旋转显示正确方向，但腾讯云 API 也会在内部旋转图片后返回坐标。如果直接上传原始文件，前端显示的图片方向和 API 返回的坐标系可能不一致，导致标注框位置完全跑偏。

**解决方案**：所有图片上传前统一通过 `createImageBitmap` + Canvas 重绘。重绘后的 JPEG 不再包含 EXIF 旋转信息，确保前端预览和 API 处理的是同一张"方向已校正"的图片。

### 2. 图片压缩与 API base64 限制

腾讯云试题批改 API 要求 base64 编码后不超过 10MB。base64 编码会使体积膨胀约 1.37 倍，因此原始文件上限约 7.3MB。仅在超限时才降低 JPEG 质量，尽量保留原始分辨率以保证手写识别精度。

### 3. 大模型输出的数学公式渲染

豆包大模型返回的内容包含 `$...$` 格式的 LaTeX 公式。直接用 marked 解析会破坏公式内容。

**解决方案**：先用正则提取所有 `$...$` 公式替换为占位符，再用 marked 解析 Markdown，最后将占位符还原为 KaTeX 渲染结果。同时处理了流式场景下未闭合 `$` 的补全、裸露 LaTeX 命令的自动包裹、公式内中文的拆分渲染等边界情况。

### 4. 反馈建议 loading 状态闪烁

大模型流式输出有一个初始延迟（思考阶段），期间没有内容返回。如果在发起请求时就将状态设为 `streaming`，用户会看到一段空白期。

**解决方案**：保持 `loading` 状态直到收到第一个非空内容 chunk，才切换为 `streaming`。这样 loading spinner 会一直显示到真正有内容输出为止。

### 5. OpenClaw Docker 容器访问宿主机服务

OpenClaw 运行在 Docker 容器中，需要调用宿主机上的批改 API。容器内 `127.0.0.1` 指向容器自身，不是宿主机。

**解决方案**：将 API 地址从 `http://127.0.0.1:3300` 改为 `http://172.17.0.1:3300`（Docker 默认网桥的宿主机 IP）。

### 6. OpenClaw Hook 超时

OpenClaw 的 hook handler 有隐式超时限制（约 10 秒），而批改任务通常需要 15-30 秒。Hook 被提前终止导致批改结果丢失。

**解决方案**：将 hook 改为 fire-and-forget 模式 —— handler 立即返回，后台异步执行图片下载、API 调用和多维表格回写。

### 7. 腾讯云批改 API 并发限制

腾讯云试题批改 Agent 有 3 个并发限制。多个任务同时提交可能触发限流。

**解决方案**：实现串行队列。前端提交时，后端检查是否有 PROCESSING 任务：
- 没有 → 直接提交腾讯云，状态设为 `PROCESSING`
- 有 → 仅保存图片和元数据，状态设为 `PENDING`（生成本地 ID）

`/api/jobs` 轮询时自动刷新 PROCESSING 任务状态，完成后取最早的 PENDING 任务提交（旧本地 ID 替换为腾讯云 jobId）。

### 8. 前端上传的图片刷新后丢失

通过前端上传的图片使用 `blob:` URL 预览，页面刷新后 blob URL 失效，图片无法显示。

**解决方案**：在 `POST /api/correction/submit` 中同步调用 `saveImage` 将图片持久化到服务端。`loadFromServer` 时使用 `${API}/correction/image/${id}` 加载服务端存储的图片。

### 9. Vite 开发代理端口不匹配

后端端口从 `3100` 改为 `3300` 后，`vite.config.ts` 中的 proxy target 未同步更新，导致本地开发时 API 请求全部 502。

**解决方案**：确保 `vite.config.ts` 的 `server.proxy['/api'].target` 与 `server/.env` 的 `PORT` 一致。

### 10. 火山引擎 Ark 两套 API 参数格式不同

火山引擎有两套 API：Chat Completions API（`/api/v3/chat/completions`）和 Responses API（`/api/v3/responses`）。关闭深度思考的参数格式不同：
- Chat Completions：`"reasoning_effort": "minimal"`（顶层字段）
- Responses：`"reasoning": { "effort": "minimal" }`（嵌套对象）

反馈生成用 Chat Completions API，视觉识别用 Responses API，两者不能混用参数格式。

### 11. Nginx server_name 与 curl 127.0.0.1 验证不匹配

服务器部署后用 `curl http://127.0.0.1/homework/` 验证返回 404，但外网 `curl http://43.167.191.81/homework/` 返回 200。

**原因**：Nginx（OpenResty）的 server block 配置了 `server_name 43.167.191.81`，用 `127.0.0.1` 访问时 Host 头不匹配，请求落到了 Nginx 的默认 server（root 为 `/usr/share/nginx/html`），自然找不到 `/homework/` 下的文件。

**解决方案**：服务器上验证时使用实际域名/IP 访问，或在 curl 中指定 Host 头：`curl -H "Host: 43.167.191.81" http://127.0.0.1/homework/`。

### 12. 飞书多维表格直连替代 OpenClaw 中间系统

原链路：多维表格 → 群消息 → OpenClaw → 批改系统 → OpenClaw → 多维表格，经过 6 个节点，任一环节故障都会导致链路中断。

**解决方案**：利用飞书自动化的"发送 HTTP 请求"功能和飞书工作流的"接收 Webhook"功能，实现多维表格与批改系统的直连：
- Flow A（自动化）：新增记录 → HTTP POST 到 `submit-async` → 修改记录写入 jobId
- Flow B（工作流）：接收批改完成回调 → 按 jobId 查找记录 → 修改批改状态和链接

注意：飞书自动化的 HTTP 请求不支持内网 URL，必须使用公网地址。Flow A 用自动化（可修改触发记录），Flow B 用工作流（支持 Webhook 触发 + 查找记录）。

### 13. 学期名称标准化与数据清洗

早期数据中学期字段使用完整格式（如"二年级下"），后续统一为简写格式（如"二下"）。如果不做数据清洗，同一学期会在前端显示为两个不同的分组。

**解决方案**：
- 新增 `normalizeSemester()` 函数，用正则 `/^([一二三四五六])年级(上|下)$/` 将完整格式转为简写
- 所有提交接口入口处统一调用 `normalizeSemester` 标准化输入
- `listJobs()` 读取数据时自动检测旧格式并回写清洗后的值到 JSON 文件
- 视觉识别 prompt 和返回值也同步使用简写格式

### 14. 易错点加练天数映射

计算营每周有一次"易错点加练"，不属于 1-21 天的常规作业。视觉识别模型需要将"第X周易错点加练"映射为特殊天数编号（22/23/24），否则会被错误识别为某个常规天数。

**解决方案**：在视觉识别 prompt 中增加显式映射规则，同时前端天数选项从 21 扩展到 24。

### 15. 人工标注事件冒泡导致操作失效

在 CorrectionOverlay 组件中，手动标注完成后弹出的对错选择弹窗（choice-popup）的按钮点击会触发父容器的 `mousedown` 事件，导致弹窗被关闭、绘制坐标被重置，标注无法正常创建。

**解决方案**：
- 在弹窗 `div` 上添加 `@mousedown.stop`，在按钮上添加 `@click.stop` 阻止事件冒泡
- `onMouseDown` 增加守卫条件 `if (showChoicePopup.value) return`，防止弹窗激活时开始新绘制
- emit 时传递坐标数组的拷贝（`[...drawnPositions]`），避免原数组被提前清空

### 16. PDF 导出导致前端数据消失

导出 PDF 时，Puppeteer 每次都会启动新的 Chrome 进程。在低配服务器上，频繁启动/关闭浏览器会导致 CPU 和内存瞬间飙升，使后端 API 暂时无响应，前端数据请求失败后页面变空。

**解决方案**：三层防御——
- **Puppeteer 浏览器单例**：首次导出启动 Chrome，后续复用，60s 无请求自动关闭
- **SQLite busy_timeout**：设置 5s 超时等待数据库锁释放，避免 Puppeteer 操作期间的并发查询立即失败
- **前端 fetchRetry**：关键数据加载（dashboard/matrix、teachers、enrollments）自动重试 3 次（延迟递增）

### 17. 服务器时间字符串导致前端时区偏移 8 小时

SQLite 的 `datetime('now')` 返回 UTC 时间但不带 `Z` 后缀（如 `2026-04-08 06:54:51`）。浏览器的 `new Date()` 对不含时区标记的字符串行为不确定——在部分浏览器中被当作本地时间解析，导致显示时间偏差 8 小时。

**解决方案**：统一使用 `parseServerTime()` 工具函数，将服务器时间字符串规范化为 `2026-04-08T06:54:51Z` 格式后再创建 Date 对象，确保始终按 UTC 解析。

### 18. jobs 表缺少 teacher_id 和 term 数据不准确

作业数据按期（班课月份）和老师分组管理，但 jobs 表原本没有 `teacher_id` 字段，`term` 字段默认值写死为 `'2026年3月'`，飞书工作流也没有传递这两个字段。

**解决方案**：
- jobs 表新增 `teacher_id TEXT` 字段，通过增量 migration 兼容旧数据
- `submit-async` 接口新增 `term` 和 `teacherName` 可选参数，飞书 Flow A 从多维表格的「班课月份」和「负责老师」字段传入
- `ensureTeacher()` 函数按姓名自动查找或创建 teacher 记录
- 编写 `migrate-term-teacher.ts` 清洗脚本，按 jobId 分界线（`1434123067537629184`）将历史数据分为 3 月/4 月，teacher_id 统一设为欣欣老师
- 同步清洗 225 个 JSON 文件和 SQLite 数据

### 19. 反馈生成超时（HeadersTimeoutError）

豆包大模型生成反馈时，发送了 4MB 原图的 base64 做多模态输入，模型处理时间经常超过 Node.js fetch 默认的 300 秒 headers 超时，触发 `HeadersTimeoutError`。

**解决方案**：
- 新增 `loadImageBase64Compressed()` 函数，用 sharp 将图片压缩到长边 1200px、JPEG quality 70（约从 4MB 降到几百 KB）后再发给豆包
- fetch 调用加 `AbortSignal.timeout(600_000)` 兜底（10 分钟）
- 反馈生成只需模型看清书写情况，不需要像素级精度，压缩不影响质量

### 20. 非标准作业（加练题等）的学期和天数字段校验

家长有时会提交加练题等非标准作业图片，多维表格中的「作业-学期」和「作业-第几天」字段可能为「无法识别」或其他无效值。

**解决方案**：在 `submit-async` 和 `submit-url` 接口中增加严格校验——`semester` 仅接受 `/^[一二三四五六](上|下)$/` 格式（一上~六下），`day` 仅接受纯数字，其他任何值均视为空值存储，老师可在详情页手动补填。

### 21. 任务看板天数矩阵动态列数不正确

学生看板矩阵的列数（maxDay）原先从数据库中 `MAX(day)` 动态计算，当最大天数不足 24 时（如 4 月期刚开始只到 Day 14），矩阵只展示已有天数的列，导致布局不一致且老师无法一览全貌。

**解决方案**：将 `maxDay` 固定为 `24`，保证矩阵始终展示完整的 24 天列，未来还未提交的天数显示为灰色占位。

### 22. 学期排序不正确（三上排在二下前面）

学生看板中的学期分组排列顺序不符合逻辑预期，如「三上」出现在「二下」之前。原因是数据库返回的学期列表按字典序排列，而非按年级 + 上下的自然顺序。

**解决方案**：新增 `semesterWeight()` 函数，将学期映射为数值权重（「一上」→1、「一下」→2、「二上」→3 …… 「六下」→12），排序时按权重升序。在 `dashboard.ts` 和 `teachers.ts` 的学期列表返回处统一应用。

### 23. 期起始日期与服务天数计算

任务看板的「未提交」统计和提醒文案需要知道「今天是这期的第几天」，否则会把未来天数也算作缺交。但系统原先没有「期起始日期」的概念，每期何时开始只有老师知道。

**解决方案**：
- 后端新增 `GET/PUT /api/dashboard/term-start` 接口，基于 `teacher_preferences` 表存取每期的起始日期
- 前端 `useApp.ts` 新增 `termStartDate` 状态和 `dayToDate()` 计算函数
- 顶部导航的期选择器旁增加日期设置入口（`<input type="date">`），设置后持久化到后端
- Dashboard 问候语旁显示 VIP 金色标签「服务期 第X/24天」
- 「未提交」学生的缺交天数只统计到当前服务天数
- 提醒文案生成时传入 `currentDay` 让 LLM 感知当前进度

### 24. 周报生成 reasoning_effort 调优

周报生成（`/api/report/generate-weekly`）的 `reasoning_effort` 从 `'minimal'` 改为 `'low'` 后，模型输出质量明显改善。但使用 `'minimal'` 时输出结构不稳定、内容过于简略，不适合面向家长的周报场景。

**解决方案**：周报生成固定使用 `reasoning_effort: 'low'`（轻量思考），反馈建议继续使用 `'minimal'`（无思考），全班教研建议也使用 `'minimal'`。不同场景按输出质量需求选择不同级别。

### 25. 周报生成思考内容泄漏到前端

开启 `reasoning_effort: 'low'` 后，豆包大模型的 SSE 流式响应中会交错返回 `delta.reasoning_content`（思考过程）和 `delta.content`（正式内容）。前端收到第一个非空 chunk 就切换到 streaming 状态并渲染，导致：1) 思考内容被当作正式内容显示；2) loading 状态过早结束，页面出现空白的报告骨架。

**解决方案**：
- **后端过滤**：在 `report.ts` 的 SSE 流式循环中，如果 delta 只有 `reasoning_content` 而无 `content`，跳过该 chunk 不转发给前端
- **前端守卫**：在 `report.vue` 中，只有当累计收到的正式内容（`cleanBuf.trim().length > 0`）后才将 `loading` 设为 false；报告骨架渲染条件改为 `v-if="reportData && !loading"`

### 26. 测试数据清理

开发和测试阶段产生了「段喆」「王欣」「王欣1」「王欣2」「果果」「王一涵」等测试 enrollment 记录，混入正式数据会影响看板统计。

**解决方案**：直接通过 SQLite 删除对应 enrollment 记录（`DELETE FROM enrollments WHERE student_id IN (...)`），不影响 jobs 和 answers 原始数据。后续如需更系统化的清理，可增加 enrollment 管理界面。

### 27. PDF 导出缺少系统依赖

服务端 Puppeteer 启动 Chrome 时报错 `libatk-1.0.so.0: cannot open shared object file`，因为 Ubuntu 云服务器默认没有安装图形相关库。

**解决方案**：安装 Puppeteer 所需的全部系统依赖：
```bash
sudo apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libnspr4 libnss3 \
  libxss1 libxtst6 fonts-liberation xdg-utils
```

### 28. PDF 导出 Emoji 字体缺失

PDF 中的 👍 等 Emoji 字符显示为空白方块或丢失，因为服务器未安装 Emoji 字体。

**解决方案**：安装 Noto Color Emoji 字体：
```bash
sudo apt-get install -y fonts-noto-color-emoji
```

### 29. OCR LaTeX 公式渲染异常（`\cdots`、`\enclose`、`\\hline`）

OCR / 大模型输出的 LaTeX 存在多种 KaTeX 不兼容问题：

| 问题 | 原因 | 修复 |
|------|------|------|
| `⋅s⋅s` 乱码 | `\cdots\cdots` 在 KaTeX 中渲染异常 | 替换为 `\ldots` |
| 竖式公式显示为原始 LaTeX 文本 | `\enclose{horizontalstrike}` 不被 KaTeX 支持，整个公式 fallback | 剥离 `\enclose{horizontalstrike}{X}` → `X` |
| array 环境 `\hline` 报错 | `\\hline` 被双反斜杠清洗规则缩减为 `\hline`，丢失行换符 `\\` | 预处理 `\\hline` → `\\ \hline`；双反斜杠 regex 增加负向前瞻 |
| `$` 配对错乱导致 `\bigcirc`、`\square`、`\div` 等显示为原始文本 | `$[\s\n]*$` 清洗规则将 `=$\n$40` 的闭合 `$` 和下一块开启 `$` 合并，破坏多 `$...$` 块配对 | 移除该规则，仅保留 `\${2,}` 连续双 `$` 合并 |
| `\b\b\begin{aligned}` 渲染失败 | OCR 产出多个 `\b` 前缀，原规则只清除一个，残留 `\b` 导致 KaTeX 报错 | 改用 `(\\b)+` 贪婪匹配 + 前瞻，一次清除所有 `\b`；`\b` 后跟非字母时也移除 |
| `\boxed{}` 空内容导致整块公式回退为原始文本 | OCR 用 `\boxed{}` 表示填空框，空内容可能触发 KaTeX 错误 | `\boxed{}`/`\boxed{\quad}` → `\square` |
| 竖式除号缺少括弧 `)`，布局不像除法 | `\enclose{horizontalstrike}{\phantom{0}}` 被直接剥离，丢失除号语义 | 特化为 `)` 代替直接剥离，使 `5⟌29` 格式可辨识 |

**修复位置**：`src/components/MarkdownKatex.vue` → `sanitizeModelOutput()`

### 30. 本地构建未同步到服务器

`npm run build` 在本地 Mac 执行，`dist/` 不会通过 `git push` 同步。服务器 `git pull` 后 `dist/` 仍是旧版本，导致前端修复不生效。

**解决方案**：部署前先用 rsync 上传本地构建产物：
```bash
rsync -avz --delete dist/ ubuntu@server:~/homework-correction/dist/
ssh ubuntu@server 'sudo rsync -a --delete ~/homework-correction/dist/ /opt/1panel/www/sites/souti35/index/homework/'
```
