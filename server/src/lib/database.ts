/**
 * SQLite 数据底座 — 连接管理 + Migration
 *
 * 使用 better-sqlite3（同步 API），数据库文件存放在 server/data/copilot.db
 * 启动时自动执行 migration（建表 + 索引），幂等安全
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../../data/copilot.db')

let db: Database.Database | null = null

/**
 * 获取数据库实例（单例）
 */
export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma('cache_size = -8000')
    db.pragma('mmap_size = 268435456')
    db.pragma('temp_store = MEMORY')
    // 执行 migration
    runMigrations(db)
    console.log(`[database] SQLite 已连接: ${DB_PATH}`)
  }
  return db
}

/**
 * 关闭数据库连接（进程退出时调用）
 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    console.log('[database] SQLite 已关闭')
  }
}

/**
 * 执行数据库 migration（幂等，使用 IF NOT EXISTS）
 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    -- ============================================================
    -- 营 / 期（多营、多批次底座）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS camps (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      subject     TEXT NOT NULL DEFAULT 'math',
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id          TEXT PRIMARY KEY,
      camp_id     TEXT NOT NULL REFERENCES camps(id),
      name        TEXT NOT NULL,
      term        TEXT NOT NULL,
      start_date  TEXT,
      total_days  INTEGER NOT NULL DEFAULT 24,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(camp_id, term)
    );

    -- ============================================================
    -- 辅导老师
    -- ============================================================
    CREATE TABLE IF NOT EXISTS teachers (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'tutor',
      feishu_open_id  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 学生
    -- ============================================================
    CREATE TABLE IF NOT EXISTS students (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 归属关系（老师 × 期 × 学期 × 学生）
    -- term: 期，如 "2026年3月"
    -- semester: 学期/level，如 "二下"
    -- ============================================================
    CREATE TABLE IF NOT EXISTS enrollments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id  TEXT NOT NULL REFERENCES teachers(id),
      student_id  TEXT NOT NULL REFERENCES students(id),
      camp_id     TEXT REFERENCES camps(id),
      cohort_id   TEXT REFERENCES cohorts(id),
      term        TEXT NOT NULL DEFAULT '2026年3月',
      semester    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(teacher_id, student_id, term, semester)
    );

    -- ============================================================
    -- 标准题目（每个 level 每天的标准答题卡）
    -- 从标准答案 PDF 解析写入，作为跨学生题目对齐的基准
    -- ============================================================
    CREATE TABLE IF NOT EXISTS question_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      semester        TEXT NOT NULL,
      day             INTEGER NOT NULL,
      question_index  INTEGER NOT NULL,
      parent_title    TEXT,
      sub_title       TEXT,
      correct_answer  TEXT NOT NULL,
      knowledge_points TEXT,
      total_questions INTEGER,
      UNIQUE(semester, day, question_index)
    );

    -- ============================================================
    -- 单次作业提交
    -- ============================================================
    CREATE TABLE IF NOT EXISTS jobs (
      job_id            TEXT PRIMARY KEY,
      student_id        TEXT NOT NULL REFERENCES students(id),
      teacher_id        TEXT REFERENCES teachers(id),
      camp_id           TEXT REFERENCES camps(id),
      cohort_id         TEXT REFERENCES cohorts(id),
      term              TEXT NOT NULL DEFAULT '2026年3月',
      semester          TEXT NOT NULL,
      day               INTEGER NOT NULL,
      submitted_at      TEXT NOT NULL,
      total_questions   INTEGER NOT NULL DEFAULT 0,
      correct_count     INTEGER NOT NULL DEFAULT 0,
      error_count       INTEGER NOT NULL DEFAULT 0,
      accuracy          REAL NOT NULL DEFAULT 0,
      review_status     TEXT NOT NULL DEFAULT 'pending',
      feedback_status   TEXT NOT NULL DEFAULT 'pending',
      feedback_content  TEXT,
      teacher_notes     TEXT,
      image_path        TEXT,
      raw_json_path     TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 单题判定（数据底座最细粒度）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS answers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id            TEXT NOT NULL REFERENCES jobs(job_id),
      answer_index      TEXT NOT NULL,
      template_id       INTEGER REFERENCES question_templates(id),
      is_correct        INTEGER NOT NULL,
      is_hidden         INTEGER NOT NULL DEFAULT 0,
      source            TEXT NOT NULL DEFAULT 'ai',
      student_answer    TEXT,
      correct_answer    TEXT,
      question_title    TEXT,
      knowledge_points  TEXT,
      answer_analysis   TEXT,
      positions         TEXT,
      UNIQUE(job_id, answer_index)
    );

    -- ============================================================
    -- 索引
    -- ============================================================
    CREATE INDEX IF NOT EXISTS idx_jobs_student_semester
      ON jobs(student_id, term, semester);

    CREATE INDEX IF NOT EXISTS idx_jobs_semester_day
      ON jobs(term, semester, day);

    CREATE INDEX IF NOT EXISTS idx_answers_job
      ON answers(job_id);

    CREATE INDEX IF NOT EXISTS idx_answers_template
      ON answers(template_id);

    CREATE INDEX IF NOT EXISTS idx_answers_correct
      ON answers(is_correct);

    CREATE INDEX IF NOT EXISTS idx_templates_semester_day
      ON question_templates(semester, day);

    CREATE INDEX IF NOT EXISTS idx_enrollments_teacher
      ON enrollments(teacher_id, term, semester);

    CREATE INDEX IF NOT EXISTS idx_enrollments_student
      ON enrollments(student_id, term, semester);

    -- 覆盖 LATEST_JOB_FILTER 相关子查询
    CREATE INDEX IF NOT EXISTS idx_jobs_latest
      ON jobs(student_id, term, semester, day, submitted_at DESC);

    -- 覆盖 answers JOIN jobs 的高频查询
    CREATE INDEX IF NOT EXISTS idx_answers_job_correct
      ON answers(job_id, is_correct, is_hidden);

    -- ============================================================
    -- 周报 / 总结等报告存档
    -- ============================================================
    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id  TEXT NOT NULL,
      camp_id     TEXT,
      cohort_id   TEXT,
      semester    TEXT NOT NULL,
      term        TEXT NOT NULL,
      report_type TEXT NOT NULL,
      content     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(student_id, semester, term, report_type)
    );

    -- ============================================================
    -- 老师偏好设置（排序规则等）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS teacher_preferences (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id  TEXT NOT NULL,
      pref_key    TEXT NOT NULL,
      pref_value  TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(teacher_id, pref_key)
    );
  `)

  // 增量迁移：给旧表加 term 字段（如果还没有的话）
  const jobCols = db.prepare("PRAGMA table_info(jobs)").all() as any[]
  if (!jobCols.find((c: any) => c.name === 'term')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN term TEXT NOT NULL DEFAULT '2026年3月'`)
    console.log('[database] 迁移: jobs 表已加 term 字段')
  }
  if (!jobCols.find((c: any) => c.name === 'updated_at')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`)
    db.exec(`UPDATE jobs SET updated_at = submitted_at`)
    console.log('[database] 迁移: jobs 表已加 updated_at 字段')
  }
  if (!jobCols.find((c: any) => c.name === 'frozen')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0`)
    console.log('[database] 迁移: jobs 表已加 frozen 字段')
  }
  if (!jobCols.find((c: any) => c.name === 'teacher_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN teacher_id TEXT REFERENCES teachers(id)`)
    console.log('[database] 迁移: jobs 表已加 teacher_id 字段')
  }

  const enrollCols = db.prepare("PRAGMA table_info(enrollments)").all() as any[]
  if (!enrollCols.find((c: any) => c.name === 'term')) {
    db.exec(`ALTER TABLE enrollments ADD COLUMN term TEXT NOT NULL DEFAULT '2026年3月'`)
    console.log('[database] 迁移: enrollments 表已加 term 字段')
  }

  // feishu_open_id: 用于飞书 OAuth 白名单校验
  const teacherCols = db.prepare("PRAGMA table_info(teachers)").all() as any[]
  if (!teacherCols.find((c: any) => c.name === 'role')) {
    db.exec(`ALTER TABLE teachers ADD COLUMN role TEXT NOT NULL DEFAULT 'tutor'`)
    console.log('[database] 迁移: teachers 表已加 role 字段')
  }
  if (!teacherCols.find((c: any) => c.name === 'feishu_open_id')) {
    db.exec(`ALTER TABLE teachers ADD COLUMN feishu_open_id TEXT`)
    console.log('[database] 迁移: teachers 表已加 feishu_open_id 字段')
  }

  // 默认营/期：兼容现有计算营数据
  db.exec(`
    INSERT OR IGNORE INTO camps (id, name, subject, status)
    VALUES ('camp-calculation', '计算营', 'math', 'active');

    INSERT OR IGNORE INTO cohorts (id, camp_id, name, term, total_days, status)
    VALUES ('cohort-calculation-2026-03', 'camp-calculation', '2026年3月期', '2026年3月', 24, 'active');

    INSERT OR IGNORE INTO camps (id, name, subject, status)
    VALUES ('camp-word-problem', '应用题营', 'math-word-problem', 'active');

    INSERT OR IGNORE INTO cohorts (id, camp_id, name, term, total_days, status)
    VALUES ('cohort-word-problem-2026-04', 'camp-word-problem', '2026年4月期', '2026年4月', 21, 'active');
  `)

  const enrollColsAfter = db.prepare("PRAGMA table_info(enrollments)").all() as any[]
  if (!enrollColsAfter.find((c: any) => c.name === 'camp_id')) {
    db.exec(`ALTER TABLE enrollments ADD COLUMN camp_id TEXT REFERENCES camps(id)`)
    console.log('[database] 迁移: enrollments 表已加 camp_id 字段')
  }
  if (!enrollColsAfter.find((c: any) => c.name === 'cohort_id')) {
    db.exec(`ALTER TABLE enrollments ADD COLUMN cohort_id TEXT REFERENCES cohorts(id)`)
    console.log('[database] 迁移: enrollments 表已加 cohort_id 字段')
  }

  const jobColsAfter = db.prepare("PRAGMA table_info(jobs)").all() as any[]
  if (!jobColsAfter.find((c: any) => c.name === 'camp_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN camp_id TEXT REFERENCES camps(id)`)
    console.log('[database] 迁移: jobs 表已加 camp_id 字段')
  }
  if (!jobColsAfter.find((c: any) => c.name === 'cohort_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN cohort_id TEXT REFERENCES cohorts(id)`)
    console.log('[database] 迁移: jobs 表已加 cohort_id 字段')
  }

  const reportCols = db.prepare("PRAGMA table_info(reports)").all() as any[]
  if (!reportCols.find((c: any) => c.name === 'camp_id')) {
    db.exec(`ALTER TABLE reports ADD COLUMN camp_id TEXT REFERENCES camps(id)`)
    console.log('[database] 迁移: reports 表已加 camp_id 字段')
  }
  if (!reportCols.find((c: any) => c.name === 'cohort_id')) {
    db.exec(`ALTER TABLE reports ADD COLUMN cohort_id TEXT REFERENCES cohorts(id)`)
    console.log('[database] 迁移: reports 表已加 cohort_id 字段')
  }

  // student_profiles: 入营问卷存储学生基线信息
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id     TEXT NOT NULL REFERENCES students(id),
      camp_id        TEXT REFERENCES camps(id),
      cohort_id      TEXT REFERENCES cohorts(id),
      term           TEXT NOT NULL,
      parent_name    TEXT,
      parent_phone_hash TEXT,
      self_level     TEXT,
      weak_points    TEXT,
      parent_concern TEXT,
      extra_notes    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(student_id, term)
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_student_term
      ON student_profiles(student_id, term);
  `)

  const profileCols = db.prepare("PRAGMA table_info(student_profiles)").all() as any[]
  if (!profileCols.find((c: any) => c.name === 'camp_id')) {
    db.exec(`ALTER TABLE student_profiles ADD COLUMN camp_id TEXT REFERENCES camps(id)`)
    console.log('[database] 迁移: student_profiles 表已加 camp_id 字段')
  }
  if (!profileCols.find((c: any) => c.name === 'cohort_id')) {
    db.exec(`ALTER TABLE student_profiles ADD COLUMN cohort_id TEXT REFERENCES cohorts(id)`)
    console.log('[database] 迁移: student_profiles 表已加 cohort_id 字段')
  }
  if (!profileCols.find((c: any) => c.name === 'parent_phone_hash')) {
    db.exec(`ALTER TABLE student_profiles ADD COLUMN parent_phone_hash TEXT`)
    console.log('[database] 迁移: student_profiles 表已加 parent_phone_hash 字段')
  }

  // 回填现有数据到默认计算营 / 默认 2026年3月期
  db.exec(`
    UPDATE enrollments
    SET camp_id = COALESCE(camp_id, 'camp-calculation'),
        cohort_id = COALESCE(cohort_id, 'cohort-calculation-2026-03')
    WHERE term = '2026年3月';

    UPDATE jobs
    SET camp_id = COALESCE(camp_id, 'camp-calculation'),
        cohort_id = COALESCE(cohort_id, 'cohort-calculation-2026-03')
    WHERE term = '2026年3月';

    UPDATE reports
    SET camp_id = COALESCE(camp_id, 'camp-calculation'),
        cohort_id = COALESCE(cohort_id, 'cohort-calculation-2026-03')
    WHERE term = '2026年3月';

    UPDATE student_profiles
    SET camp_id = COALESCE(camp_id, 'camp-calculation'),
        cohort_id = COALESCE(cohort_id, 'cohort-calculation-2026-03')
    WHERE term = '2026年3月';

    -- 应用题营 demo：先复用欣欣老师的少量学生与作业数据，便于验证营切换。
    INSERT OR IGNORE INTO enrollments (teacher_id, student_id, camp_id, cohort_id, term, semester)
    SELECT teacher_id, student_id, 'camp-word-problem', 'cohort-word-problem-2026-04', '2026年4月', semester
    FROM enrollments
    WHERE camp_id = 'camp-calculation'
      AND teacher_id = 'teacher-xinxin'
      AND student_id IN ('student-lihua', 'student-wangfang', 'student-zhaolei');

    INSERT OR IGNORE INTO student_profiles (
      student_id, camp_id, cohort_id, term, parent_name, self_level, weak_points, parent_concern, extra_notes
    )
    SELECT student_id, 'camp-word-problem', 'cohort-word-problem-2026-04', '2026年4月',
           parent_name, self_level, weak_points, parent_concern, '应用题营 demo，暂复用计算营学生档案'
    FROM student_profiles
    WHERE camp_id = 'camp-calculation'
      AND student_id IN ('student-lihua', 'student-wangfang', 'student-zhaolei');

    INSERT OR IGNORE INTO jobs (
      job_id, student_id, teacher_id, camp_id, cohort_id, term, semester, day, submitted_at,
      total_questions, correct_count, error_count, accuracy, review_status, feedback_status,
      feedback_content, teacher_notes, image_path, raw_json_path, created_at, updated_at, frozen
    )
    SELECT 'app_' || job_id, student_id, teacher_id, 'camp-word-problem', 'cohort-word-problem-2026-04',
           '2026年4月', semester, day, submitted_at, total_questions, correct_count, error_count,
           accuracy, review_status, feedback_status, feedback_content, teacher_notes, image_path,
           raw_json_path, created_at, updated_at, frozen
    FROM jobs
    WHERE camp_id = 'camp-calculation'
      AND teacher_id = 'teacher-xinxin'
      AND student_id IN ('student-lihua', 'student-wangfang', 'student-zhaolei')
      AND day <= 3;

    INSERT OR IGNORE INTO answers (
      job_id, answer_index, template_id, is_correct, is_hidden, source, student_answer,
      correct_answer, question_title, knowledge_points, answer_analysis, positions
    )
    SELECT 'app_' || a.job_id, a.answer_index, a.template_id, a.is_correct, a.is_hidden, a.source,
           a.student_answer, a.correct_answer, a.question_title, a.knowledge_points,
           a.answer_analysis, a.positions
    FROM answers a
    JOIN jobs j ON j.job_id = a.job_id
    WHERE j.camp_id = 'camp-calculation'
      AND j.teacher_id = 'teacher-xinxin'
      AND j.student_id IN ('student-lihua', 'student-wangfang', 'student-zhaolei')
      AND j.day <= 3;

    CREATE INDEX IF NOT EXISTS idx_cohorts_camp
      ON cohorts(camp_id, term);
    CREATE INDEX IF NOT EXISTS idx_enrollments_scope
      ON enrollments(camp_id, cohort_id, teacher_id, semester);
    CREATE INDEX IF NOT EXISTS idx_jobs_scope
      ON jobs(camp_id, cohort_id, teacher_id, semester, day);
    CREATE INDEX IF NOT EXISTS idx_reports_scope
      ON reports(camp_id, cohort_id, student_id, semester, report_type);
  `)

  console.log('[database] Migration 完成')
}
