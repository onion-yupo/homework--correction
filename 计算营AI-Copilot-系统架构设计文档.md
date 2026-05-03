# 计算营 AI Copilot — 系统架构设计文档

> 创建时间：2026-04-01
> 文档性质：系统架构设计文档，面向开发者，覆盖数据模型、前后端架构、API 设计、导入方案和开发计划
> 前置文档：`计算营AI学习助手-产品功能文档.md`（记录当前已实现的产品功能）

---

## 一、背景与目标

### 1.1 当前状态

计算营 AI Copilot 已实现**单次作业**的完整服务闭环：

- 家长提交作业图片 → 腾讯云 AI 批改 → 老师复核（确认/修改判定、人工标注）→ AI 生成反馈建议（整体评价、作业分析、家长话术、加练题目）→ 老师编辑调整后发给家长

技术栈：Vue 3 + Vite + Pinia（前端）、Hono + Node.js（后端）、腾讯云 OCR + 火山引擎豆包（AI）、文件系统 JSON 存储。

### 1.2 核心问题

当前系统的数据以 **job（单次作业提交）** 为粒度，散落在文件系统的 JSON 文件中。这导致：

1. **没有学生档案**：无法回答"这个学生 24 天的正确率趋势是什么""哪个知识点反复出错"
2. **没有班级视图**：老师无法一眼看到"今天还有谁没交、哪些还没复核"
3. **无法跨天聚合**：周报、全班汇总、学情复盘、主讲教研数据全部没有数据基础
4. **没有工作台入口**：老师打开系统只能看到一个 job 列表，没有"我今天该干什么"的引导

### 1.3 本次架构升级目标

在保持现有批改详情页（仪表盘 A）能力不变的前提下：

1. **建立结构化数据底座**（SQLite），支持多维度交叉查询
2. **新增工作台首页**（仪表盘 B），提供任务追踪矩阵
3. **新增学情分析页面**，支持个人/全班/level 维度的数据可视化
4. **设计并实现历史数据批量导入方案**，导入 80 位学生 × 24 天的作业数据
5. **改造现有页面**，加入全局导航、面包屑、上下学生切换等体验优化

---

## 二、完整架构总览

### 2.1 辅导老师工作台全景

```
承接期（入营前）          行课期·每日              行课期·每周           结束期（结营）
┌──────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────┐
│ 学情收集      │   │ 作业收集          │   │ 个人周报      │   │ 个人学情复盘  │
│ 定级测试      │   │ AI 批改           │   │ 周错题汇总    │   │ 全班学情复盘  │
│ 分班建档      │   │ 老师复核          │   │ 综合测试汇总  │   │ 续费引导      │
│              │   │ 反馈生成          │   │ 主讲教研数据  │   │              │
│              │   │ 交付给家长        │   │              │   │              │
│              │   │ 未交提醒          │   │              │   │              │
│              │   │ 当日全班汇总      │   │              │   │              │
└──────────────┘   └──────────────────┘   └──────────────┘   └──────────────┘
      规划中              ★ 核心主战场             本次 scope           规划中

                    ┌──────────────────────────────────────────────────┐
                    │                   底座能力                        │
                    │  数据底座（SQLite）· 老师/学生/班级管理 · 任务追踪   │
                    │               ★ 本次重点建设                      │
                    └──────────────────────────────────────────────────┘
```

### 2.2 本次 scope


| 模块            | 优先级 | 说明            | 状态 |
| ------------- | --- | ------------- | --- |
| 数据底座（SQLite）  | P0  | 所有后续功能的基础     | ✅ 已完成 |
| 工作台首页（任务追踪矩阵） | P0  | 老师日常最高频使用的页面  | ✅ 已完成 |
| 历史数据批量导入      | P1  | 让底座有真实数据      | ✅ 已完成（飞书自动化持续导入） |
| 批改详情页改造       | P1  | 面包屑、上下学生切换    | 部分完成 |
| 学情分析页面        | P2  | 个人/全班维度的数据可视化 | ✅ 已完成 |
| 全局导航 + 老师身份   | P1  | 系统级体验升级       | ✅ 已完成 |
| 周报生成 + PDF 导出  | P2  | 含大拇指评价体系      | ✅ 已完成 |
| 学期总结视频生成       | P2  | Remotion + TTS + LLM 旁白 | ✅ 已完成 |


---

## 三、业务实体与关系模型

### 3.1 核心业务概念

```
Teacher（辅导老师）
  │
  │  一个老师负责多个 level
  │  一个 level 下有多个老师
  │  老师和学生通过 enrollment 关联
  │
  ├── Enrollment（归属关系）
  │     Teacher × Semester × Student
  │     这是"班"的最小单元
  │
Semester / Level（学期 = 班 = level）
  │  如 "二上""二下"，从"一上"到"六上"共 12 个
  │  一个 level 可能有 120 个学生，分给多个老师
  │
Student（学生）
  │  一个学生可以参加多个学期
  │  如 段喆 参加了 "二上" 和 "二下"
  │
  └── Job（单次作业提交）
        │  属于某个学生的某个学期的某一天
        │  一天可能有多次提交（多个 jobId）
        │
        └── Answer（单题判定）
              最小数据粒度
              所有聚合统计从这里算
```

### 3.2 实体关系图

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ Teacher  │────▶│  Enrollment  │◀────│ Student  │
│          │  1:N│              │N:1  │          │
│ id       │     │ teacherId    │     │ id       │
│ name     │     │ studentId    │     │ name     │
│          │     │ semester     │     │          │
└──────────┘     └──────────────┘     └──────────┘
                                            │
                                            │ 1:N
                                            ▼
                                      ┌──────────┐
                                      │   Job    │
                                      │          │
                                      │ jobId    │
                                      │ studentId│
                                      │ teacherId│
                                      │ semester │
                                      │ day      │
                                      │ term     │
                                      │ accuracy │
                                      │ ...      │
                                      └──────────┘
                                            │
                                            │ 1:N
                                            ▼
                                      ┌──────────┐
                                      │  Answer  │
                                      │          │
                                      │ id       │
                                      │ jobId    │
                                      │ isCorrect│
                                      │ knowledge│
                                      │ ...      │
                                      └──────────┘
```

### 3.3 关键业务规则

1. **学期(semester) = level = 班的标识**：在计算营业务中，"二下"既表示学期，也表示学生的学习级别，也是班级的分组依据
2. **老师 × 学期 = 一个班**：如 "A老师-二下" = A老师在二下这个 level 负责的 40 个学生
3. **一个老师跨多个 level**：如 A老师同时负责 "二上"40人 + "二下"40人 + "三上"40人 = 120 人
4. **一个 level 下多个老师**：如 "二下" 有 120 个学生，分给 A/B/C 三个老师各 40 人
5. **学生可以参加多个学期**：如段喆参加了"二上"和"二下"，两段数据独立，可能归属不同老师
6. **一天可能多次提交**：同一学生同一天可能有多个 jobId（如重新提交）

---

## 四、数据底座设计

### 4.1 设计原则

- **事实数据作为底座输入**：只有客观的、可验证的、不因模型/prompt 变化而变化的数据进入底座
- **衍生数据存档但不参与聚合**：大模型生成的反馈文本可以存档回溯，但不作为统计计算的输入
- **老师复核后的判定为最终判定**：如果老师修改了 AI 的对错判定，以老师的为准

### 4.2 数据分层

```
┌──────────────────────────────────────────────────────┐
│  展示层                                               │
│  周报、学情复盘、教研报告、全班汇总                       │
│  → 大模型基于结构化数据生成，每次可重新生成               │
├──────────────────────────────────────────────────────┤
│  衍生数据层                                            │
│  每日反馈文本、加练题目、老师备注                         │
│  → 存档回溯、作为模型上下文，但不参与聚合计算              │
├──────────────────────────────────────────────────────┤
│  数据底座（SQLite）                                     │
│  结构化事实数据，所有聚合、统计、趋势分析的唯一数据源       │
│  · 每题判定（对/错/隐藏/来源）                           │
│  · 每题知识点 + 错因描述                                │
│  · 每次作业正确率                                       │
│  · Student × Semester × Day × Job 的关系              │
│  · Teacher × Semester × Student 的归属关系             │
└──────────────────────────────────────────────────────┘
```

### 4.3 标准题目与答案映射

#### 背景验证

通过对比标准答案 PDF 和腾讯 API 返回的批改结果（本地 + 线上共 36 份二上二下数据），验证了以下事实：

**一致的部分**：

- 同一天同一张卷子，不同学生的正确答案**集合**是一致的（答案内容相同）
- 口算等简单题型的顺序通常一致

**不一致的部分（需要容错）**：


| 问题类型     | 发生频率 | 具体表现                                                        | 影响                  |
| -------- | ---- | ----------------------------------------------------------- | ------------------- |
| 题目顺序不一致  | 中等   | 竖式计算部分，不同学生的扫描顺序可能不同（取决于学生书写位置）                             | answer_index 不能直接对齐 |
| 多识别出题目   | 偶发   | 验算过程被识别为独立题目（如 831-749=82 的验算 82+749=831 被当成第二道题）           | 后续所有 index 偏移       |
| 少识别题目    | 偶发   | 图片质量差或拍摄不完整导致大量题目缺失（如 23 题只识别出 11 题）                        | 无法对齐                |
| 正确答案格式差异 | 常见   | 同一道题的 RightAnswer 格式不同：`82` vs `82，验算：82+749=831` vs `$82$` | 简单字符串匹配失败           |


**结论：不能单纯靠 answer_index 序号对齐，需要用 correct_answer 做内容匹配。**

#### 标准答案数据来源

已有完整的标准题目和答案 PDF：

```
~/Downloads/二年级/
  ├── 二上/
  │   ├── PDF/          ← 题目 PDF（21天）
  │   │   ├── 计算专项训练—二年级上·第1天.pdf
  │   │   └── ...
  │   └── 答案/         ← 答案 PDF（21天）
  │       ├── 计算专项训练—二年级上·第1天【答案】.pdf
  │       └── ...
  └── 二下/
      ├── PDF/          ← 题目 PDF（21天）
      └── 答案/         ← 答案 PDF（21天）
```

共 42 份答案 PDF（二上 21 + 二下 21），覆盖 Day 1-21。Day 22-24（易错点加练）待确认是否有对应 PDF。

#### 映射策略（鲁棒版）

**核心思路：用 correct_answer（归一化后）作为匹配锚点，而不是位置序号。**

```
阶段一：构建标准答案库
  1. 解析 42 份答案 PDF → 提取每天每道题的标准答案
  2. 写入 question_templates 表
  3. 对每天的标准答案做归一化处理

阶段二：答案匹配（对每个学生的每道题）
  1. 归一化 correct_answer：
     - 去掉 $ 符号
     - 去掉多余空格
     - 截取逗号/中文逗号前的部分（处理"82，验算：82+749=831"→"82"）
     - 去掉换行和竖式格式
  
  2. 匹配规则（按优先级）：
     a. 精确匹配：归一化后 == 标准答案
     b. 包含匹配：归一化后包含标准答案（或标准答案包含归一化后的值）
     c. 未匹配：template_id = NULL
  
  3. 处理重复答案（如同一天多道题答案都是"1000"）：
     - 按顺序贪心匹配 + 位置就近原则
     - 已匹配的标准答案标记为已用，不重复匹配
     - 如果仍有歧义，结合 question_title 中的题目信息辅助判断
  
  4. 处理多识别/少识别：
     - 多识别的题目（如验算被当成独立题）：匹配不到 template → template_id = NULL，不参与题目级别聚合，但仍计入个人正确率
     - 少识别的题目：该学生该天的部分 template 没有对应 answer，在全班统计时该题该学生标记为"未识别"而非"错误"

阶段三：匹配质量报告
  输出每天的匹配统计：
  - 匹配率（成功匹配的 answer 数 / 总 answer 数）
  - 未匹配的 answer 列表（供人工检查）
  - 每个 template 被匹配到的学生数（检测是否有 template 从未被匹配）
```

### 4.4 SQLite Schema

```sql
-- 辅导老师
CREATE TABLE teachers (
  id              TEXT PRIMARY KEY,        -- 如 "teacher-a"
  name            TEXT NOT NULL,           -- 如 "丁老师"
  feishu_open_id  TEXT UNIQUE,             -- 飞书 OAuth open_id，用于登录白名单校验
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 学生
CREATE TABLE students (
  id          TEXT PRIMARY KEY,        -- 如 "student-duanzhe"
  name        TEXT NOT NULL UNIQUE,    -- 如 "段喆"（当前用姓名做唯一标识）
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 归属关系（老师 × 学期 × 学生）
CREATE TABLE enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  TEXT NOT NULL REFERENCES teachers(id),
  student_id  TEXT NOT NULL REFERENCES students(id),
  semester    TEXT NOT NULL,           -- 如 "二上""二下"
  term        TEXT NOT NULL DEFAULT '2026年3月',  -- 期（区分不同开课批次）
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(teacher_id, student_id, term, semester)
);

-- 单次作业提交
CREATE TABLE jobs (
  job_id      TEXT PRIMARY KEY,        -- 腾讯云返回的 jobId
  student_id  TEXT NOT NULL REFERENCES students(id),
  semester    TEXT NOT NULL,           -- 如 "二下"
  day         INTEGER NOT NULL,        -- 1-24
  submitted_at TEXT NOT NULL,          -- 提交时间（ISO 8601）

  -- 聚合统计（从 answers 计算后缓存）
  total_questions   INTEGER NOT NULL DEFAULT 0,
  correct_count     INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  accuracy          REAL NOT NULL DEFAULT 0,  -- 0-1 之间的小数

  -- 工作流状态
  review_status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'reviewed'
  feedback_status   TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent'

  -- 衍生数据引用（不参与聚合，仅存档）
  feedback_content  TEXT,              -- 最终版反馈 Markdown
  teacher_notes     TEXT,              -- 老师备注

  -- 管理字段
  frozen            INTEGER NOT NULL DEFAULT 0,  -- 冻结标记，冻结后不计入统计
  term              TEXT NOT NULL DEFAULT '2026年3月',  -- 期（区分不同开课批次）
  teacher_id        TEXT REFERENCES teachers(id),       -- 负责老师（通过 submit-async 的 teacherName 解析）

  -- 元数据
  image_path        TEXT,              -- 作业图片路径
  raw_json_path     TEXT,              -- 原始 job JSON 文件路径（向后兼容）
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT               -- 最后更新时间
);

-- 标准题目（每个 level 每天的标准答题卡）
-- 从标准答案 PDF 解析写入，作为跨学生题目对齐的基准
CREATE TABLE question_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  semester        TEXT NOT NULL,        -- "二上" / "二下"
  day             INTEGER NOT NULL,     -- 1-21（Day 22-24 待确认）
  question_index  INTEGER NOT NULL,     -- 题目序号（0-based，对应 answer_index 的数字部分）

  -- 题目信息
  parent_title    TEXT,                 -- 大题标题，如 "口算。""比大小。"
  sub_title       TEXT,                 -- 子题标题，如 "700+800=""比较722和725的大小"
  correct_answer  TEXT NOT NULL,        -- 标准答案（归一化后，去掉 $ 符号）
  knowledge_points TEXT,               -- 知识点 JSON 数组（从 API 返回中取众数）
  total_questions INTEGER,             -- 该天总题数

  UNIQUE(semester, day, question_index)
);

-- 单题判定（数据底座最细粒度）
CREATE TABLE answers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            TEXT NOT NULL REFERENCES jobs(job_id),
  answer_index      TEXT NOT NULL,     -- 答案在 job 内的索引标识，如 "a-0""a-5"
  template_id       INTEGER REFERENCES question_templates(id),  -- 关联标准题目

  -- 事实数据
  is_correct        INTEGER NOT NULL,  -- 最终判定：1=正确 0=错误（老师复核后的）
  is_hidden         INTEGER NOT NULL DEFAULT 0,  -- 是否被老师隐藏
  source            TEXT NOT NULL DEFAULT 'ai',   -- 'ai' | 'teacher_override' | 'manual_annotation'

  -- 题目内容
  student_answer    TEXT,              -- 学生手写答案（OCR 识别）
  correct_answer    TEXT,              -- 正确答案（API 返回的，可能有格式差异）
  question_title    TEXT,              -- 所属大题标题

  -- 知识标签
  knowledge_points  TEXT,              -- JSON 数组，如 '["整百整千数加法运算"]'
  answer_analysis   TEXT,              -- 腾讯 API 返回的错因分析（自然语言）

  -- 定位信息
  positions         TEXT,              -- JSON 数组，标注坐标 [x1,y1,x2,y2,x3,y3,x4,y4]

  UNIQUE(job_id, answer_index)
);

-- 周报存档（生成后持久化，避免重复调用 LLM）
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  TEXT NOT NULL,
  semester    TEXT NOT NULL,
  term        TEXT NOT NULL,
  report_type TEXT NOT NULL,            -- 'week1' | 'week2' | 'week3' | 'summary'
  content     TEXT,                     -- JSON：结构化数据 + LLM 生成文本
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, semester, term, report_type)
);

-- 老师偏好设置（排序、时间筛选等，per-teacher 持久化）
CREATE TABLE teacher_preferences (
  teacher_id  TEXT NOT NULL,
  pref_key    TEXT NOT NULL,           -- 如 "sort_tab_待复核""timeFilter_tab_全部任务"
  pref_value  TEXT,
  updated_at  TEXT,
  UNIQUE(teacher_id, pref_key)
);

-- ============ 索引 ============

-- 按学生查某学期的所有 job
CREATE INDEX idx_jobs_student_semester ON jobs(student_id, semester);

-- 按学期+天数查所有 job（全班某天汇总）
CREATE INDEX idx_jobs_semester_day ON jobs(semester, day);

-- 按 job 查所有答案
CREATE INDEX idx_answers_job ON answers(job_id);

-- 按 template 聚合（跨学生同一道题的错误率）
CREATE INDEX idx_answers_template ON answers(template_id);

-- 按知识点聚合错题（需要用 JSON 函数或应用层处理）
CREATE INDEX idx_answers_correct ON answers(is_correct);

-- 标准题目按学期+天数查询
CREATE INDEX idx_templates_semester_day ON question_templates(semester, day);

-- ============ 新增：学生入营基线档案 ============

-- 家长填写的入营问卷，存储学生基线信息
CREATE TABLE student_profiles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     TEXT NOT NULL REFERENCES students(id),
  term           TEXT NOT NULL,            -- 期，如 "2026年3月"
  parent_name    TEXT,                     -- 家长姓名（选填）
  self_level     TEXT,                     -- 自评水平：优秀/良好/一般/较弱
  weak_points    TEXT,                     -- 薄弱知识点（自由文本）
  parent_concern TEXT,                     -- 家长最希望重点关注的方面（自由文本）
  extra_notes    TEXT,                     -- 其他备注
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, term)
);
```

### 4.4 数据写入时机


| 触发时机          | 写入内容                                        | 说明                                        |
| ------------- | ------------------------------------------- | ----------------------------------------- |
| 腾讯 API 返回批改结果 | `jobs` 表 + `answers` 表                      | 初始写入，`is_correct` 取 AI 判定，`source = 'ai'` |
| 老师修改对错判定      | 更新 `answers.is_correct`，更新 `jobs` 聚合统计      | `source` 改为 `'teacher_override'`          |
| 老师添加人工标注      | 新增 `answers` 记录                             | `source = 'manual_annotation'`            |
| 老师隐藏/显示答案     | 更新 `answers.is_hidden`                      | 隐藏的答案不计入面向家长的统计                           |
| 老师标记核对/反馈状态   | 更新 `jobs.review_status` / `feedback_status` | 驱动任务追踪状态                                  |
| 反馈保存          | 更新 `jobs.feedback_content`                  | 存档用，不参与聚合                                 |


### 4.5 多维度查询示例

以下查询示例说明底座如何支持不同业务场景：

**个人周报（段喆的二下第 1 周）**：

```sql
SELECT j.day, j.accuracy, j.total_questions, j.correct_count, j.error_count
FROM jobs j
JOIN students s ON j.student_id = s.id
WHERE s.name = '段喆' AND j.semester = '二下' AND j.day BETWEEN 1 AND 6
ORDER BY j.day;
```

**个人错题列表（段喆二下全部错题）**：

```sql
SELECT a.question_title, a.student_answer, a.correct_answer,
       a.knowledge_points, a.answer_analysis, j.day
FROM answers a
JOIN jobs j ON a.job_id = j.job_id
JOIN students s ON j.student_id = s.id
WHERE s.name = '段喆' AND j.semester = '二下' AND a.is_correct = 0
ORDER BY j.day, a.answer_index;
```

**全班某天汇总（二下 Day 5 所有学生）**：

```sql
SELECT s.name, j.accuracy, j.total_questions, j.correct_count, j.error_count
FROM jobs j
JOIN students s ON j.student_id = s.id
WHERE j.semester = '二下' AND j.day = 5
ORDER BY j.accuracy DESC;
```

**某老师当天的任务追踪（A老师二下的所有学生 Day 5 状态）**：

```sql
SELECT s.name,
       j.job_id,
       j.review_status,
       j.feedback_status,
       j.accuracy
FROM enrollments e
JOIN students s ON e.student_id = s.id
LEFT JOIN jobs j ON j.student_id = s.id AND j.semester = e.semester AND j.day = 5
WHERE e.teacher_id = 'teacher-a' AND e.semester = '二下';
```

**知识点高频错题 TOP N（二下全 level）**：

```sql
SELECT a.knowledge_points, COUNT(*) as error_count
FROM answers a
JOIN jobs j ON a.job_id = j.job_id
WHERE j.semester = '二下' AND a.is_correct = 0
GROUP BY a.knowledge_points
ORDER BY error_count DESC
LIMIT 10;
```

**某学生正确率趋势（段喆二下 1-24 天）**：

```sql
SELECT j.day, j.accuracy
FROM jobs j
JOIN students s ON j.student_id = s.id
WHERE s.name = '段喆' AND j.semester = '二下'
ORDER BY j.day;
```

**全班某天某题的错误率（二下 Day 13 每道题的全班表现）**：

```sql
SELECT qt.question_index, qt.sub_title, qt.correct_answer,
       COUNT(*) as total_students,
       SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) as error_count,
       ROUND(1.0 * SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate
FROM answers a
JOIN question_templates qt ON a.template_id = qt.id
JOIN jobs j ON a.job_id = j.job_id
WHERE j.semester = '二下' AND j.day = 13
GROUP BY qt.question_index
ORDER BY error_rate DESC;
```

**全 level 高频错题 TOP 10（二下整期，具体到某道题）**：

```sql
SELECT qt.semester, qt.day, qt.question_index, qt.sub_title, qt.correct_answer,
       qt.knowledge_points,
       COUNT(*) as total_attempts,
       SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) as error_count,
       ROUND(1.0 * SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate
FROM answers a
JOIN question_templates qt ON a.template_id = qt.id
JOIN jobs j ON a.job_id = j.job_id
WHERE j.semester = '二下'
GROUP BY qt.id
HAVING error_count > 0
ORDER BY error_rate DESC
LIMIT 10;
```

### 4.6 与现有文件存储的兼容策略

SQLite 是**增量引入**，不替换现有文件存储：

- 现有的 `server/data/jobs/{jobId}.json` 继续保留，批改详情页仍从 JSON 读取完整数据（包括 markInfos 的递归结构、坐标信息等）
- SQLite 存储的是**提取后的结构化字段**，用于聚合查询和列表展示
- `jobs` 表中保留 `raw_json_path` 字段，可以从 SQLite 记录回溯到原始 JSON
- 写入时双写：先存 JSON（现有逻辑不变），再提取字段写入 SQLite

这样做的好处：

1. 现有功能零影响，不需要重构批改详情页的数据读取逻辑
2. 渐进式迁移，风险最小
3. 批改详情页需要的复杂嵌套结构（markInfos）不适合放在关系型数据库里

---

## 五、前端架构

### 5.1 路由规划

```
/                              → 工作台首页（任务追踪矩阵）
/correction/:jobId             → 批改详情页（现有，加面包屑 + 上下切换）
/analytics                     → 学情分析（个人/全班维度切换）
/analytics/student/:studentId  → 个人学情详情
```

### 5.2 全局导航

```
┌──────────────────────────────────────────────────────────────┐
│  计算营 AI Copilot     [工作台] [学情分析]      丁老师 ▼       │
└──────────────────────────────────────────────────────────────┘
```

- 顶部固定导航栏，包含系统名称、页面切换、当前老师身份
- **老师身份**：不做登录系统，采用本地选择方案：
  - 首次进入弹出选择框，选择"我是哪位老师"
  - 选择后存入 `localStorage`，后续自动使用
  - 导航栏右侧显示当前老师名字，点击可切换
- 老师身份决定了工作台看到的数据范围（通过 enrollment 过滤）

### 5.3 工作台首页（任务追踪矩阵）

这是老师每天打开系统的**第一个页面**。

#### 页面整体布局

页面自上而下分为三大区域，每个区域左侧有彩色竖条标识（竖条内含竖排白色标题）：

- 🔵 蓝色竖条 **任务总览**：顶部状态面板（问候/待办/成果/事件流）
- 🔴 红色竖条 **待办任务**：Inbox 收件箱（Tab + 卡片网格 + 排序筛选 + 冻结/提醒）
- 🟢 绿色竖条 **班课学生看板**：学生×天数状态矩阵 + 阶段报告入口

#### 顶部状态面板（三层结构）

- **第一层：个性化问候语 + 昨日回顾**
  - 根据时间段切换问候语（上午好 / 下午好 / 晚上好）
  - 昨日工作回顾：收到 X 份作业提交，完成 X 次复核和 X 次反馈
- **第二层：实时待办与今日成果**
  - 左侧"待处理"：待复核数 + 待反馈数
  - 右侧"今日成果"：新提交份数 + 已复核次数 + 已反馈次数 + 交作业人数 / 总人数
  - 下方整体进度条：X 份作业已提交，Y 份已完成全部流程
- **第三层：实时事件流**
  - 最近 5 条动态，每条带彩色圆点标识状态：蓝点 = 新提交，橙点 = 已复核，绿点 = 已反馈
  - 每条动态可点击跳转到对应作业详情

#### Inbox 收件箱区域

- **左侧：文件夹抽屉式 Tab**
  - Tab 列表：全部任务 / 待复核 / 待反馈 / 未提交
  - 每个 Tab 带红色数量角标
- **右侧：卡片网格**
  - 每张卡片显示：学生名 → 复核/反馈状态（红色 = 待处理 / 绿色 = 已完成）→ 等待时长 → 天数 → 学期
- **工具栏**：
  - 时间筛选：全部 / 今天 / 昨天 / 近两天 / 近一周
  - 排序：编辑时间 / 天数
  - 各 Tab 独立存储偏好（通过 `teacher_preferences` 表持久化）
- **展开/收起**：默认收起 3 行，超出部分可展开/收起
- **冻结功能**：每张卡片右上角有冻结按钮，冻结后该任务不计入统计，灰显放到列表末尾，支持解冻

#### 未提交学生卡片

- 按人聚合显示，每人一张卡片，显示缺交天数
- 右上角有**"提醒"按钮**，点击后弹窗调用豆包 2.0 lite 流式生成提醒家长文案
- 文案结合学生实际数据（已提交天数和正确率、缺交的具体天数）
- 支持编辑文案 + 补充指令重新生成 + 一键复制

#### 底部矩阵

学生 × 天数矩阵，始终可见不受 Tab 筛选影响。

- **格子四种状态**：
  - 未提交：灰底
  - 已提交未处理：白底灰边 + 灰灰点
  - 已复核待反馈：白底绿边 + 绿灰点
  - 全部完成：浅绿底绿边 + 绿绿点
- **右侧阶段报告入口**：周报 1 / 2 / 3 + 总结
  - 三种状态：不可生成（灰色实线 + 锁）/ 可生成未生成（蓝色虚线）/ 已生成（蓝色实线 + 浅蓝填充）
  - 周报条件：周报 1（Day 1-7 至少 1 次提交）、周报 2（Day 8-14）、周报 3（Day 15-21）、总结（至少 12 天有提交记录）
- **特殊天数映射**：Day 22-24 映射为"第一 / 二 / 三周易错点加练"

#### 交互

- 点击卡片 → 跳转到 `/correction/:jobId`（该学生该天的批改详情页）
- 点击矩阵格子 → 跳转到对应作业详情
- 点击学生姓名 → 跳转到 `/analytics/student/:studentId`（个人学情）
- Level 切换 → 整个页面数据刷新为对应 level 的学生列表和状态

### 5.4 批改详情页改造

在现有批改详情页基础上新增：

#### 面包屑导航

```
工作台 > 二下 > 段喆 > Day 5
```

- 点击"工作台" → 回到工作台首页
- 点击"二下" → 回到工作台并切到二下 level
- 点击"段喆" → 跳转到段喆的学情分析页
- "Day 5" 为当前位置，不可点击

#### 上一个/下一个学生切换

```
┌─────────────────────────────────────────────┐
│  ← 上一个(王小明)    Day 5    下一个(李婷婷) → │
└─────────────────────────────────────────────┘
```

- 在同一天的学生列表中（按工作台矩阵的排序），切换到上/下一个学生
- 可选：只在"待复核"的学生中切换，跳过已完成的
- 切换后整个详情页刷新为新学生的数据

#### 学情侧边栏（可选，P2）

批改详情页右侧或作为浮层，展示该学生的累积学情摘要：

- 近 7 天正确率趋势迷你折线图
- 累积高频错误知识点
- 让老师在复核时有更多上下文

### 5.5 学情分析页面

#### 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│  计算营 AI Copilot     [工作台] [学情分析]      丁老师 ▼       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  维度切换：[个人学情] [全班概览]                                │
│                                                              │
│  ═══════════════════════════════════════════════════════      │
│  个人学情视图                                                 │
│  ═══════════════════════════════════════════════════════      │
│                                                              │
│  学生选择：[段喆 ▼]    学期：[二下 ▼]                          │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  正确率趋势                                       │       │
│  │  100%|          ●                                │       │
│  │   90%|    ●  ●     ●  ●                          │       │
│  │   80%| ●                 ●                       │       │
│  │   70%|                                           │       │
│  │      └─D1──D2──D3──D4──D5──D6──                  │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  ┌─────────────────────┐ ┌──────────────────────────┐       │
│  │  知识点掌握情况       │ │  高频错因 TOP 5           │       │
│  │                     │ │                          │       │
│  │  整百数加法  ████ 95%│ │  1. 进退位计算 (5次)      │       │
│  │  两位数乘法  ███░ 80%│ │  2. 数字辨认混淆 (3次)    │       │
│  │  分数运算    ██░░ 60%│ │  3. 审题遗漏条件 (2次)    │       │
│  │  ...               │ │  ...                     │       │
│  └─────────────────────┘ └──────────────────────────┘       │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  错题列表                                         │       │
│  │  [按天数] [按知识点]                  共 15 道错题  │       │
│  │                                                  │       │
│  │  Day 3 · 整百数加法运算                            │       │
│  │  学生答案：2800+1000=3900                         │       │
│  │  正确答案：2800+1000=3800                         │       │
│  │  错因：计算2800加1000时进位错误                     │       │
│  │  ─────────────────────────────────                │       │
│  │  Day 5 · 两位数乘法                               │       │
│  │  ...                                             │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 个人学情视图

- **正确率趋势折线图**：X 轴 Day 1-24，Y 轴正确率 0-100%
- **知识点掌握情况**：按知识点聚合正确率，横向条形图
- **高频错因 TOP 5**：按 `answer_analysis` 出现频次排序（后续可加错因分类）
- **错题列表**：支持按天数或按知识点两种排序方式，展示题目内容、学生答案、正确答案、错因

#### 全班概览视图

- **学期选择**：如 "二下"
- **全班正确率分布**：柱状图，X 轴为正确率区间（0-60%、60-80%、80-100%），Y 轴为学生数
- **全班正确率趋势**：折线图，显示班级平均正确率 Day 1-24 趋势
- **高频错题知识点 TOP N**：全班维度的知识点错误率排行
- **学生排行**：按累计正确率/进步幅度排序

### 5.6 周学习报告页面

#### 入口

从学情分析页 → 阶段报告卡片 → 点击已生成/可生成的周报 → 跳转到 `/report` 页面。

#### 页面结构

报告采用 A4 分页设计，内容自上而下分为 5 个章节：

1. **基本信息** — 练习天数、题目总数、总体正确率、满分记录、正确数/错误数、大拇指
2. **知识点掌握** — 三格概览（完全掌握/掌握良好/需要加强）+ 彩色渐变进度条列表
3. **错题回顾** — 逐题纠正 + 学习技巧（LLM 生成，最多 10 道代表性错题）
4. **下周建议** — 3-4 条具体可执行的家长配合建议（LLM 生成）
5. **老师寄语** — 练习概况总结 + 大拇指 emoji 评价

#### 封面

紧凑型渐变封面（紫色系），显示 REPORT 标识、学期·周次、学生姓名。

#### 数据流

1. 前端 `onMounted` → 先尝试 `GET /api/report/weekly` 加载已保存的报告
2. 如果不存在 → `POST /api/report/generate-weekly` 流式生成
3. 后端聚合 `jobs` + `answers` → 计算结构化数据（dailyData/errors/knowledge/thumbsUp）→ 先发 `__DATA__` JSON → 调用豆包 2.0 lite 流式生成文本
4. 生成完成后自动保存到 `reports` 表

#### 每日数据速览

直接取 `reportData.dailyData` 结构化数据渲染表格（天/题数/正确/错误/正确率），不依赖 LLM 生成。正确率用四色标签：100% 绿色、≥90% 蓝色、≥80% 橙色、<80% 红色。

#### 知识点掌握图形化

直接取 `reportData.knowledge` 结构化数据，按正确率排序。每个知识点一行：名称 + 渐变进度条（绿→蓝→橙→红）+ 百分比 + 做对/总数。顶部三格卡片显示分层统计。

#### 大拇指评价算法（1-5 个 👍）

三维度打分 → 总分 0-10 → 映射 1-5 个大拇指：

| 维度     | 分值  | 梯度                                              |
| ------ | --- | ----------------------------------------------- |
| 正确率    | 0-5 | ≥98%→5, ≥95%→4, ≥90%→3, ≥80%→2, ≥70%→1, <70%→0 |
| 坚持练习   | 0-3 | ≥6天→3, ≥5天→2, ≥3天→1, <3天→0                     |
| 满分表现   | 0-2 | ≥3天满分→2, ≥1天满分→1, 0天→0                          |

不使用"前后半周对比"等进步/退步维度，因为每天题目难度不同不具备直接对比性。

#### 重新生成与补充指令

"重新生成"按钮展开补充指令面板（textarea），指令注入到 LLM prompt 末尾并标注为"老师的补充指令（优先级最高）"，与反馈建议、提醒文案逻辑一致。

#### PDF 导出

服务端 `GET /api/report/export-pdf`：
1. 从 `reports` 表读取已保存的报告数据
2. 服务端 `buildReportHtml()` 生成完整独立 HTML（内嵌 CSS + Google Fonts Noto Sans SC）
3. Puppeteer `page.setContent(html)` → 等待字体加载 → `page.pdf()` 生成 A4 PDF
4. 返回 PDF 文件流供前端下载

不依赖前端服务、不依赖系统字体，本地和服务器均可用。

### 5.7 前端状态管理

新增或改造以下 Pinia store：

```
src/
  ├── pages/
  │   ├── dashboard.vue        // 新增：任务看板（工作台首页）
  │   ├── analytics.vue       // 新增：学情分析（个人/全班）
  │   └── report.vue          // 新增：周学习报告预览 + PDF 导出
  └── stores/
      ├── useApp.ts            // 新增：全局状态（老师身份、期 term、学期 semester）
      ├── useDashboard.ts      // 新增：工作台数据（当前 level、学生列表、状态矩阵）
      ├── useAnalytics.ts      // 新增：学情分析数据（趋势、知识点、错题）
      ├── useCorrection.ts     // 现有：批改详情页状态（改造：加入面包屑上下文）
      └── useJobList.ts        // 现有：作业列表（可能被工作台取代）
```

---

## 六、后端架构

### 6.1 新增 API 接口

#### 认证（飞书 OAuth）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/auth/login` | GET | 302 重定向到飞书 OAuth 授权页 |
| `/api/auth/callback` | GET | code 换 access_token → 白名单校验 → 写 JWT Cookie |
| `/api/auth/me` | GET | 返回当前登录老师信息（需 JWT Cookie） |
| `/api/auth/logout` | POST | 清除 Cookie |

#### 家长收作业表单（公开，token 鉴权）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/submit/config/:token` | GET | 解析 token，返回学生姓名和配置 |
| `/api/submit/:token` | POST | 接收图片，接入批改队列 |
| `/api/dashboard/submit-links` | GET | 老师获取自己负责学生的专属链接（需登录） |

#### 入营问卷（公开，token 鉴权）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/enroll/config/:token` | GET | 解析 token，返回老师和期信息 |
| `/api/enroll` | POST | 提交问卷，建立学生档案 |
| `/api/dashboard/enroll-link` | GET | 老师生成当期入营链接（需登录） |
| `/api/students/:id/profile` | GET | 查看某学生的档案（需登录） |

#### 老师与班级管理


| 接口                                     | 方法   | 说明                   |
| -------------------------------------- | ---- | -------------------- |
| `/api/teachers`                        | GET  | 获取所有老师列表             |
| `/api/teachers/:teacherId/enrollments` | GET  | 获取某老师负责的所有 level 和学生 |
| `/api/teachers`                        | POST | 创建老师（初始化用）           |
| `/api/enrollments`                     | POST | 创建归属关系（初始化用）         |


#### 工作台数据


| 接口                          | 方法   | 说明                                                       |
| --------------------------- | ---- | -------------------------------------------------------- |
| `/api/dashboard/overview`   | GET  | 今日概览统计（顶部状态面板）。参数：`teacherId`, `term`, `semester`, `day` |
| `/api/dashboard/matrix`     | GET  | 学生×天数状态矩阵（底部矩阵）。参数：`teacherId`, `term`                   |
| `/api/dashboard/sort-prefs` | GET  | 获取老师排序 + 时间筛选偏好                                          |
| `/api/dashboard/sort-prefs` | POST | 保存排序 / 时间筛选偏好                                            |
| `/api/dashboard/freeze`     | POST | 冻结 / 解冻任务                                                |
| `/api/dashboard/remind`     | POST | 生成提醒家长交作业文案（流式，调用豆包 2.0 lite，传入 `currentDay` 服务天数）  |
| `/api/dashboard/term-start` | GET/PUT | 获取/设置当前期的起始日期（存入 teacher_preferences），用于计算服务天数      |


#### 学情分析


| 接口                                   | 方法  | 说明                                                           |
| ------------------------------------ | --- | ------------------------------------------------------------ |
| `/api/analytics/student-trend`       | GET | 个人正确率趋势。参数：`studentId`, `semester`                           |
| `/api/analytics/student-errors`      | GET | 个人错题列表。参数：`studentId`, `semester`，可选 `day`, `knowledgePoint` |
| `/api/analytics/student-knowledge`   | GET | 个人知识点掌握情况。参数：`studentId`, `semester`                         |
| `/api/analytics/class-overview`      | GET | 全班概览。参数：`semester`, `day`(可选)                                |
| `/api/analytics/class-knowledge-top` | GET | 全班知识点错误率 TOP N。参数：`semester`, `limit`                        |


#### 周报生成与 PDF 导出


| 接口                            | 方法   | 说明                                                                     |
| ----------------------------- | ---- | ---------------------------------------------------------------------- |
| `/api/report/generate-weekly` | POST | 聚合周数据 + 大拇指算法 + 豆包 2.0 lite 流式生成周报文案（`reasoning_effort: 'low'`）。支持 `instruction` 补充指令。先发 `__DATA__` 结构化 JSON，再流式输出文本（过滤 reasoning_content） |
| `/api/report/weekly`          | GET  | 获取已保存的周报（从 `reports` 表读取），避免重复生成                                       |
| `/api/report/status`          | GET  | 批量查询某学生所有报告的生成状态                                                       |
| `/api/report/export-pdf`      | GET  | 服务端 Puppeteer 渲染 HTML → PDF 下载。HTML 内嵌 Google Fonts 中文字体，不依赖前端服务       |


#### 数据导入


| 接口                   | 方法   | 说明                               |
| -------------------- | ---- | -------------------------------- |
| `/api/import/batch`  | POST | 批量提交导入任务。参数：任务列表（学生名、学期、天数、图片路径） |
| `/api/import/status` | GET  | 导入进度查询                           |


### 6.2 现有 API 改造


| 接口                                    | 改造内容                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| 批改完成时（correction 路由）                  | 新增：提取结构化数据写入 SQLite（answers 表 + jobs 表）                |
| `/api/jobs/:jobId/flags`              | 新增：同步更新 SQLite 中 jobs 表的状态                             |
| `/api/jobs/:jobId/review-state`       | 新增：同步更新 SQLite 中 answers 表的 is_correct / is_hidden     |
| `/api/jobs/:jobId/manual-annotations` | 新增：同步写入 SQLite answers 表（source = 'manual_annotation'） |
| `/api/feedback/save`                  | 新增：同步更新 SQLite jobs 表的 feedback_content                |


### 6.3 后端数据层架构

```
server/
  ├── src/
  │   ├── lib/
  │   │   ├── storage.ts          // 现有：文件系统存储（保持不变）
  │   │   ├── database.ts         // 新增：SQLite 连接管理、初始化、migration
  │   │   ├── db-sync.ts          // 新增：从 job JSON 提取数据写入 SQLite 的同步逻辑
  │   │   └── ocr.ts              // 现有：腾讯云 OCR 客户端（保持不变）
  │   ├── lib/
  │   │   ├── auth.ts             // 新增：JWT 签发/验证、飞书 OAuth token 工具
  │   │   ├── submit-token.ts     // 新增：收作业 HMAC-SHA256 token 生成/验证
  │   ├── middleware/
  │   │   └── requireAuth.ts      // 新增：JWT Cookie 认证中间件
  │   ├── routes/
  │   │   ├── auth.ts             // 新增：飞书 OAuth 登录（/api/auth/*）
  │   │   ├── submit.ts           // 新增：家长收作业表单（/api/submit/*，公开）
  │   │   ├── enroll.ts           // 新增：入营问卷（/api/enroll/*，公开）
  │   │   ├── correction.ts       // 现有 + 改造：批改完成后双写 SQLite
  │   │   ├── jobs.ts             // 现有 + 改造：状态变更时同步 SQLite
  │   │   ├── feedback.ts         // 现有 + 改造：保存时同步 SQLite
  │   │   ├── vision.ts           // 现有（保持不变）
  │   │   ├── dashboard.ts        // 现有 + 新增：submit-links/enroll-link 接口
  │   │   ├── analytics.ts        // 现有：学情分析 API
  │   │   ├── teachers.ts         // 现有：老师管理 API
  │   │   ├── report.ts           // 现有：周报生成 + PDF 导出
  │   │   └── import.ts           // 现有：批量导入接口
  │   └── index.ts                // 入口（注册新路由，应用认证中间件）
  └── scripts/
      ├── init-teacher-feishu.ts  // 新增：初始化 15 个老师的 feishu_open_id
      ├── batch-import.ts         // 批量导入历史作业数据
      ├── sync-remote-data.ts     // 远程数据同步脚本
      └── parse-pdf-answers.ts    // PDF 标准答案解析脚本
```

### 6.4 SQLite 技术选型

- 使用 `better-sqlite3`（同步 API，性能最好，适合 Node.js 服务端）
- 数据库文件：`server/data/copilot.db`
- 启动时自动执行 migration（建表 + 索引）
- 不引入 ORM，直接写 SQL（数据模型简单，SQL 更直观）

---

## 七、历史数据批量导入方案

### 7.1 数据规模

- 80 位学生，主要分布在"二上"和"二下"两个 level
- 每位学生 24 天，共约 **1,920 张图片**
- 每张图片约 20-30 秒批改时间（腾讯 API），QPS 限制为 3

### 7.2 图片文件组织

要求按以下结构组织图片文件夹：

```
import-data/
  ├── 段喆/
  │   ├── 二上/
  │   │   ├── 1.jpg      ← Day 1
  │   │   ├── 2.jpg      ← Day 2
  │   │   └── ...
  │   └── 二下/
  │       ├── 1.jpg
  │       └── ...
  ├── 王小明/
  │   └── 二下/
  │       ├── 1.jpg
  │       └── ...
  └── ...
```

文件名规则：`{day}.jpg`（或 .png），day 为 1-24 的数字。

如果实际文件组织方式不同，导入脚本可以适配。

### 7.3 导入流程

```
阶段一：解析标准答案 PDF → 写入 question_templates
  1. 读取 42 份答案 PDF（二上21 + 二下21）
  2. 解析每份 PDF，提取题目结构：
     - 大题标题（如 "1. 改正下面的算式。""2. 口算。"）
     - 每道子题的标准答案
     - 按卷面顺序编号 question_index（0-based）
  3. 格式归一化：去掉 $ 符号、多余空格
  4. 写入 question_templates 表
  5. 输出解析报告：每天的题目数量、题目列表

阶段二：批量导入学生作业图片 → 写入 jobs + answers
  1. 扫描文件夹，构建导入任务列表
  2. 检查 SQLite，跳过已导入的（按 studentName + semester + day 去重）
  3. 并发控制（最多 3 个并行）：
     a. 读取图片文件
     b. 调用 POST /api/correction/submit（复用现有接口）
     c. 轮询 GET /api/correction/query 等待完成
     d. 完成后，从 job JSON 提取数据写入 SQLite（jobs + answers）
  4. 进度实时输出：
     [  45/1920] 段喆 二上 Day3 ✓ (23s) 40题
     [  46/1920] 王小明 二下 Day1 ✓ (18s) 40题
     [  47/1920] 李婷婷 二下 Day2 ✗ 重试中...
  5. 失败任务记录到 import-errors.json，支持重跑

阶段三：答案映射 → 回填 answers.template_id
  1. 对每条 answer 记录：
     a. 取 job 的 (semester, day)
     b. 取 answer 的 answer_index 数字部分作为 question_index
     c. 查 question_templates 表匹配
     d. 写入 template_id
  2. 验证：检查是否有未匹配的 answer（题目数量不一致的情况）
  3. 输出映射报告：匹配率、异常项
```

### 7.4 导入脚本设计

独立脚本 `server/scripts/batch-import.ts`：

```typescript
/**
 * 批量导入历史作业数据
 *
 * 用法：
 *   npx tsx server/scripts/batch-import.ts --dir ./import-data --concurrency 3
 *
 * 参数：
 *   --dir         图片文件夹根目录
 *   --concurrency 并发数（默认 3，不超过腾讯 API QPS）
 *   --retry       失败重试次数（默认 2）
 *   --resume      断点续传，跳过已导入的
 */
```

### 7.5 导入后的数据初始化

历史数据导入后，由于没有老师复核环节，需要做标记：

- `jobs.review_status` = `'auto'`（区别于老师手动标记的 `'reviewed'`）
- `answers.source` = `'ai'`（全部为 AI 判定，未经老师确认）
- 统计数据（正确率等）基于 AI 判定，在学情分析中可以注明"AI 判定，未经老师复核"

### 7.6 最小可展示数据集

如果时间紧张，**20 个学生 × 24 天 = 480 张**（约 1 小时导入）即可满足展示需要：

- 10 个学生 "二上" + 10 个学生 "二下"
- 任务追踪矩阵有 20 行 × 24 列
- 全班统计有足够区分度
- 跨 level 数据聚合可以展示

---

## 八、开发计划

### 8.1 时间线（8 个工作日）

```
Day 1-2：数据底座
  ├── SQLite 初始化、migration、连接管理
  ├── 从现有 job JSON 提取数据写入 SQLite 的同步逻辑
  ├── 现有 API 改造（双写 SQLite）
  └── teachers / enrollments 初始化数据

Day 3：批量导入
  ├── 导入脚本开发
  ├── 测试导入 5 个学生验证链路
  └── 晚上启动完整导入（80 学生，预计 3-5 小时）

Day 4-5：工作台首页
  ├── 全局导航 + 老师身份选择
  ├── dashboard API（overview + matrix）
  ├── 工作台前端页面（概览卡片 + 状态矩阵 + 筛选）
  └── 格子点击跳转批改详情页

Day 6：批改详情页改造
  ├── 面包屑导航
  ├── 上一个/下一个学生切换
  └── 从工作台跳转的上下文传递

Day 7-8：学情分析
  ├── analytics API（趋势、知识点、错题、全班概览）
  ├── 个人学情页面（折线图、知识点、错题列表）
  ├── 全班概览页面（分布图、TOP N）
  └── 整体联调、UI 打磨

Buffer：如有余力
  ├── 周报生成（数据底座 + 大模型）
  ├── 学情侧边栏（批改详情页中展示累积学情）
  └── 导出能力（学情报告 PDF/图片）
```

### 8.2 验收标准


| 功能    | 验收标准                                |
| ----- | ----------------------------------- |
| 数据底座  | 80 个学生的数据全部导入 SQLite，可以用 SQL 查询任意维度 |
| 工作台首页 | 老师选择身份后，看到自己负责的学生 × 24 天状态矩阵，数据准确   |
| 批改详情页 | 从工作台点击格子直达，面包屑可返回，可切换上下学生           |
| 学情分析  | 选择学生后看到正确率趋势、知识点掌握、错题列表，数据准确        |
| 全班概览  | 选择 level 后看到正确率分布、知识点 TOP N         |


---

## 九、Demo 数据规划

为了让系统展示效果最佳，导入时按以下方式组织 demo 数据：

### 9.1 老师配置


| 老师  | 负责的 Level       |
| --- | --------------- |
| 丁老师 | 二上（40人）、二下（40人） |


如果实际有多个老师，可以再加。最简方案先用一个老师演示完整功能。

### 9.2 学生分布


| Level | 学生数  | 说明        |
| ----- | ---- | --------- |
| 二上    | ~40人 | 完整 24 天数据 |
| 二下    | ~40人 | 完整 24 天数据 |


### 9.3 数据特点（自然形成，无需人为构造）

由于是真实学生的真实作业，数据天然具备：

- 不同学生之间有正确率差异
- 同一学生不同天之间有波动
- 不同知识点的掌握程度有差异
- 有高频错误知识点可以聚合

这些真实数据的"不完美"恰恰是系统价值的最好证明。

---

## 附录 A：现有技术栈参考


| 层级        | 技术                                                     |
| --------- | ------------------------------------------------------ |
| 前端        | Vue 3.5 + Vite 6 + Pinia + Vue Router 4 + SCSS         |
| 公式渲染      | KaTeX 0.16 + marked（`MarkdownKatex` 组件含 OCR LaTeX 清洗层 `sanitizeModelOutput`） |
| 图片导出      | html2canvas                                            |
| 后端        | Hono 4（Node.js）+ tsx                                   |
| AI 批改     | 腾讯云 tencentcloud-sdk-nodejs-ocr                        |
| AI 反馈     | 火山引擎 Ark · 豆包大模型（doubao-seed-2-0-lite）                 |
| 数据存储      | 服务器文件系统（jobs JSON + images + feedback）+ **SQLite（新增）** |
| SQLite 驱动 | better-sqlite3                                         |
| PDF 生成    | Puppeteer（服务端 HTML → PDF，内嵌 Google Fonts 中文字体）          |
| 部署        | PM2 + Nginx（OpenResty）                                 |


## 附录 B：从 Job JSON 提取 Answer 的逻辑

腾讯 API 返回的 `markInfos` 是递归嵌套结构，需要递归遍历提取所有 `AnswerInfo`：

```typescript
/**
 * 从 markInfos 递归提取所有答案，生成扁平的 Answer 列表
 * 同时合并老师复核结果（reviewCorrections, hiddenAnswerIds, manualAnnotations）
 */
function extractAnswers(
  markInfos: MarkInfo[],
  reviewCorrections: Record<string, boolean>,
  hiddenAnswerIds: string[],
  manualAnnotations: ManualAnnotation[]
): Answer[] {
  const answers: Answer[] = []
  let answerIndex = 0

  function walk(infos: MarkInfo[], parentTitle: string) {
    for (const info of infos) {
      const title = info.MarkItemTitle || parentTitle

      // 处理当前层级的答案
      for (const ans of info.AnswerInfos || []) {
        const indexKey = `a-${answerIndex}`
        const isOverridden = indexKey in reviewCorrections
        answers.push({
          answer_index: indexKey,
          is_correct: isOverridden ? reviewCorrections[indexKey] : ans.IsCorrect,
          is_hidden: hiddenAnswerIds.includes(indexKey),
          source: isOverridden ? 'teacher_override' : 'ai',
          student_answer: ans.HandwriteInfo,
          correct_answer: ans.RightAnswer,
          question_title: title,
          knowledge_points: JSON.stringify(ans.KnowledgePoints || []),
          answer_analysis: ans.AnswerAnalysis,
          positions: JSON.stringify(ans.HandwriteInfoPositions || []),
        })
        answerIndex++
      }

      // 递归处理子题
      if (info.MarkInfos?.length) {
        walk(info.MarkInfos, title)
      }
    }
  }

  walk(markInfos, '')

  // 追加人工标注
  for (const ma of manualAnnotations || []) {
    answers.push({
      answer_index: ma.id,
      is_correct: ma.isCorrect,
      is_hidden: false,
      source: 'manual_annotation',
      student_answer: null,
      correct_answer: null,
      question_title: '人工标注',
      knowledge_points: '[]',
      answer_analysis: null,
      positions: JSON.stringify(ma.positions || []),
    })
  }

  return answers
}
```

注意：`answer_index` 的编号逻辑（`a-0`, `a-1`, ...）必须与前端 `useCorrection.ts` 中的遍历顺序完全一致，否则 `reviewCorrections` 和 `hiddenAnswerIds` 的映射会错位。

---

## 附录 C：学期总结视频生成（summary-video）

### C.1 概述

学期总结视频是面向家长的个人学情总结，以动态视频 + 老师语音旁白的形式呈现。使用 Remotion（React 编程式视频框架）渲染画面，火山引擎 TTS 合成语音，豆包大模型生成台词脚本，FFmpeg 做最终音视频合并。

### C.2 项目结构

总结视频作为独立子项目，位于仓库根目录 `summary-video/`：

```
summary-video/
├── package.json                # 依赖：remotion, react, better-sqlite3
├── tsconfig.json
├── .gitignore                  # 排除 node_modules/, out/
├── src/
│   ├── index.ts                # Remotion 入口
│   ├── Root.tsx                # 注册 Composition
│   ├── SummaryVideo.tsx        # 主视频组件（场景编排 + 字幕层）
│   ├── types.ts                # 数据类型定义（SummaryVideoProps）
│   ├── render-with-data.ts     # 渲染脚本：SQLite → LLM → TTS → Remotion → FFmpeg
│   ├── narration.ts            # 旁白生成模块（LLM台词 + TTS语音 + 时长计算）
│   └── scenes/
│       ├── CoverScene.tsx      # 封面（学生名 + 学期 + 期数）
│       ├── StatsScene.tsx      # 数据总览（完成天数/题量/正确率/满分天数）
│       ├── ChartScene.tsx      # 每日正确率折线图（SVG 逐帧绘制）
│       ├── KnowledgeScene.tsx  # 知识点掌握（环形图 + Top5/Bottom5）
│       ├── CommentScene.tsx    # 老师寄语（大拇指 + 亮点 + 评语）
│       ├── OutroScene.tsx      # 结尾
│       └── SubtitleOverlay.tsx # 字幕覆盖层（逐句显示，底部居中）
└── public/
    └── bgm.mp3                 # 背景音乐（可选，放置后自动启用）
```

### C.3 渲染流水线

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  1. SQLite  │───▶│  2. LLM     │───▶│  3. TTS     │───▶│  4. Remotion│───▶│  5. FFmpeg  │
│  读取学生数据 │    │  生成台词脚本 │    │  合成语音    │    │  渲染画面    │    │  合并音视频  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
     ↓                   ↓                   ↓                   ↓                   ↓
  SummaryVideoProps   5段旁白文本         5个mp3文件        _silent.mp4         最终.mp4
                                       + 各段时长           (无声)           (画面+旁白+BGM)
```

**Step 1 — 数据加载**：从 `homework-correction/server/data/copilot.db` 读取学生的 jobs、answers、reports 数据，计算 dailyData、knowledgePoints、thumbsUp、highlights 等。

**Step 2 — LLM 台词生成**：将学生数据（含每日正确率明细）发送给豆包 2.0 lite，生成 5 段场景旁白。Prompt 要求基于真实数据如实描述趋势，语气温和鼓励。

**Step 3 — TTS 语音合成**：每段台词调用火山引擎 TTS API（`openspeech.bytedance.com/api/v1/tts`）合成 mp3。用 ffprobe 获取精确时长。

**Step 4 — 画面渲染**：以 TTS 时长驱动场景时长（旁白秒数 + 1s 余量），Remotion 渲染无声画面。字幕按句拆分，按字数比例分配时间。

**Step 5 — 音频合并**：FFmpeg 将无声画面与旁白音轨合并。如果 `public/bgm.mp3` 存在（大于 10KB），自动混入背景音乐（音量 10%，首尾淡入淡出）。

### C.4 字幕系统

- 每个场景的台词按 `。！？；` 拆分为独立句子
- 按字数比例在场景时间范围内分配每句的起止帧
- 句间有 4 帧（约 0.13s）间隔
- 画面底部居中显示，半透明黑底，6 帧淡入淡出

### C.5 BGM 支持

BGM 框架已内置，但默认不启用。只需将 mp3 文件放到 `summary-video/public/bgm.mp3` 即可自动混入：

- 音量：10%（不影响旁白清晰度）
- 循环播放（自动裁剪到视频长度）
- 首 1 秒淡入，末 2 秒淡出

### C.6 使用方式

```bash
cd summary-video
npm install
npx tsx src/render-with-data.ts --studentId=student-邬子煜 --semester=二下 --term=2026年3月
```

输出文件位于 `summary-video/out/邬子煜_二下_总结.mp4`。

### C.7 依赖

| 依赖 | 用途 |
|------|------|
| remotion / @remotion/cli / @remotion/bundler | React 编程式视频框架 |
| react / react-dom | Remotion 渲染依赖 |
| better-sqlite3 | 读取主项目 SQLite 数据库 |
| ffmpeg（系统级） | 音视频合并、TTS 音频时长检测 |
| 火山引擎 TTS API | 语音合成 |
| 豆包 2.0 lite | 台词脚本生成 |