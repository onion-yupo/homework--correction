/**
 * 从 SQLite 读取真实学生数据 → 渲染总结视频
 *
 * 用法：npx tsx src/render-with-data.ts --studentId=student-邬子煜 --semester=二下 --term=2026年3月
 */
import path from 'node:path'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { SummaryVideoProps, DailyDataItem, KnowledgePoint } from './types'

const DB_PATH = path.resolve(__dirname, '../../server/data/copilot.db')

function parseArgs(): { studentId: string; semester: string; term: string } {
  const args: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, '').split('=')
    if (k && v) args[k] = v
  }
  return {
    studentId: args.studentId || 'student-邬子煜',
    semester: args.semester || '二下',
    term: args.term || '2026年3月',
  }
}

function loadStudentData(studentId: string, semester: string, term: string): SummaryVideoProps {
  const db = new Database(DB_PATH, { readonly: true })

  const student = db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as any
  const studentName = student?.name || studentId.replace('student-', '')

  const jobsFallback = db.prepare(`
    SELECT day, accuracy, total_questions, correct_count, error_count, submitted_at
    FROM jobs
    WHERE student_id = ? AND term = ? AND semester = ?
    ORDER BY day, submitted_at DESC
  `).all(studentId, term, semester) as any[]

  // 只保留每天最后一次提交
  const dayMap = new Map<number, any>()
  for (const j of jobsFallback) {
    if (!dayMap.has(j.day)) dayMap.set(j.day, j)
  }
  const finalJobs = Array.from(dayMap.values()).sort((a, b) => a.day - b.day)

  const dailyData: DailyDataItem[] = finalJobs.map(j => {
    const rawAcc = j.accuracy || 0
    const pctAcc = rawAcc <= 1 ? rawAcc * 100 : rawAcc
    return {
      day: j.day,
      totalQuestions: j.total_questions || 0,
      correctCount: j.correct_count || 0,
      errorCount: j.error_count || 0,
      accuracy: Math.round(pctAcc * 10) / 10,
      isPerfect: pctAcc >= 99.9,
    }
  })

  const totalDays = 21
  const submittedDays = dailyData.length
  const totalQuestions = dailyData.reduce((s, d) => s + d.totalQuestions, 0)
  const totalCorrect = dailyData.reduce((s, d) => s + d.correctCount, 0)
  const avgAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
  const perfectDays = dailyData.filter(d => d.isPerfect).length

  // 知识点
  const answers = db.prepare(`
    SELECT a.knowledge_points, a.is_correct
    FROM answers a
    JOIN jobs j ON a.job_id = j.job_id
    WHERE j.student_id = ? AND j.term = ? AND j.semester = ? AND a.is_hidden = 0
      AND a.knowledge_points != '[]'
  `).all(studentId, term, semester) as any[]

  const kpMap = new Map<string, { total: number; correct: number }>()
  for (const a of answers) {
    try {
      const points: string[] = JSON.parse(a.knowledge_points)
      for (const p of points) {
        const entry = kpMap.get(p) || { total: 0, correct: 0 }
        entry.total++
        if (a.is_correct) entry.correct++
        kpMap.set(p, entry)
      }
    } catch { /* skip */ }
  }

  const knowledgePoints: KnowledgePoint[] = Array.from(kpMap.entries())
    .filter(([, v]) => v.total >= 2)
    .map(([name, v]) => ({
      name,
      accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      totalQuestions: v.total,
      correctCount: v.correct,
    }))
    .sort((a, b) => b.totalQuestions - a.totalQuestions)

  // 大拇指评分（复用后端算法）
  let score = 0
  if (avgAccuracy >= 98) score += 5
  else if (avgAccuracy >= 95) score += 4
  else if (avgAccuracy >= 90) score += 3
  else if (avgAccuracy >= 80) score += 2
  else if (avgAccuracy >= 70) score += 1

  if (submittedDays >= 6) score += 3
  else if (submittedDays >= 5) score += 2
  else if (submittedDays >= 3) score += 1

  if (perfectDays >= 3) score += 2
  else if (perfectDays >= 1) score += 1

  let thumbsUp = 1
  if (score >= 9) thumbsUp = 5
  else if (score >= 7) thumbsUp = 4
  else if (score >= 5) thumbsUp = 3
  else if (score >= 3) thumbsUp = 2

  /**
   * 从整期统计数据中提炼 3-5 条简洁亮点（纯数据驱动，不拼接周报原文）
   * 参考周报"值得称赞的细节"风格：每条一句话
   */
  const highlightItems: string[] = []

  if (perfectDays > 0) {
    const perfectDayList = dailyData.filter(d => d.isPerfect).map(d => `第${d.day}天`).join('、')
    highlightItems.push(`${perfectDayList}全部正确，表现出色！`)
  }
  if (submittedDays >= totalDays - 2) {
    highlightItems.push(`坚持完成${submittedDays}天练习，学习习惯很棒`)
  }
  const masteredKpCount = knowledgePoints.filter(k => k.accuracy >= 95).length
  if (masteredKpCount >= 5) {
    highlightItems.push(`${masteredKpCount}个知识点正确率达到95%以上，基础扎实`)
  }
  if (avgAccuracy >= 90) {
    highlightItems.push(`整期平均正确率${avgAccuracy.toFixed(0)}%，整体发挥稳定`)
  }
  const highDays = dailyData.filter(d => d.accuracy >= 95).length
  if (highDays >= 3 && !highlightItems.some(h => h.includes('全部正确'))) {
    highlightItems.push(`${highDays}天正确率超过95%，高水平发挥频次高`)
  }
  if (highlightItems.length < 3) {
    highlightItems.push(`共完成${totalQuestions}道计算题，练习量充足`)
  }

  let highlights = highlightItems.slice(0, 5).map(h => `✓ ${h}`).join('\n')

  let teacherComment = ''
  const summaryReport = db.prepare(
    'SELECT content FROM reports WHERE student_id = ? AND semester = ? AND term = ? AND report_type = ? LIMIT 1'
  ).get(studentId, semester, term, 'summary') as any

  if (summaryReport) {
    try {
      const c = JSON.parse(summaryReport.content)
      const s = c.generatedText?.match(/===SUMMARY===\n([\s\S]*?)(?====|$)/)?.[1]?.trim()
      if (s) teacherComment = s
    } catch { /* skip */ }
  }

  if (!teacherComment) {
    const lastWeekReport = db.prepare(
      "SELECT content FROM reports WHERE student_id = ? AND semester = ? AND term = ? AND report_type LIKE 'week%' ORDER BY report_type DESC LIMIT 1"
    ).get(studentId, semester, term) as any
    if (lastWeekReport) {
      try {
        const c = JSON.parse(lastWeekReport.content)
        const s = (c.generatedText || '').match(/===SUMMARY===\n([\s\S]*?)(?====|$)/)?.[1]?.trim()
        if (s) teacherComment = s
      } catch { /* skip */ }
    }
    if (!teacherComment) {
      teacherComment = `${studentName}本期表现值得肯定，继续保持良好的学习习惯！`
    }
  }

  function cleanText(text: string): string {
    return text
      .replace(/\[STAR\]/gi, '⭐')
      .replace(/\[DOT\]/gi, '✓')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  teacherComment = cleanText(teacherComment)

  db.close()

  return {
    studentName,
    semester,
    term,
    totalDays,
    submittedDays,
    totalQuestions,
    totalCorrect,
    avgAccuracy: Math.round(avgAccuracy * 10) / 10,
    perfectDays,
    thumbsUp,
    dailyData,
    knowledgePoints,
    highlights,
    teacherComment,
  }
}

async function main() {
  const { studentId, semester, term } = parseArgs()
  console.log(`📊 读取学生数据: ${studentId} | ${semester} | ${term}`)

  const props = loadStudentData(studentId, semester, term)
  console.log(`✅ 数据加载完成: ${props.studentName}`)
  console.log(`   提交 ${props.submittedDays}/${props.totalDays} 天, ${props.totalQuestions} 题, 正确率 ${props.avgAccuracy}%`)
  console.log(`   知识点 ${props.knowledgePoints.length} 个, 大拇指 ${props.thumbsUp}/5`)

  // ===== Step 1: 生成旁白台词 + TTS 语音 =====
  const { generateScripts, generateAudioFiles, computeSceneDurations, mergeNarrationTrack } = await import('./narration.js')

  console.log('\n🎙️  生成旁白...')
  let scenes = await generateScripts(props)
  for (const s of scenes) {
    console.log(`  [${s.label}] ${s.text.slice(0, 50)}...`)
  }

  console.log('\n🔊 TTS 语音合成...')
  scenes = await generateAudioFiles(scenes)

  const FPS = 30
  const sceneDurations = computeSceneDurations(scenes, FPS)
  const OUTRO_FRAMES = 3 * FPS
  const BRAND_FRAMES = 3 * FPS
  const totalFrames = sceneDurations.reduce((s, d) => s + d.frames, 0) + OUTRO_FRAMES + BRAND_FRAMES
  const totalSec = totalFrames / FPS

  console.log(`\n⏱️  场景时长分配（旁白驱动）:`)
  let offset = 0
  for (let i = 0; i < scenes.length; i++) {
    const sec = sceneDurations[i].frames / FPS
    console.log(`  ${scenes[i].label}: ${sec.toFixed(1)}s (旁白 ${scenes[i].durationSec?.toFixed(1)}s) [${offset.toFixed(1)}s-${(offset + sec).toFixed(1)}s]`)
    offset += sec
  }
  console.log(`  总时长: ${totalSec.toFixed(1)}s (${totalFrames} 帧)`)

  // 构建字幕段落：按句拆分，每句独立显示
  const subtitles: { text: string; startFrame: number; endFrame: number }[] = []
  let frameOffset = 0
  for (let i = 0; i < scenes.length; i++) {
    const sceneFrames = sceneDurations[i].frames
    const sentences = scenes[i].text
      .split(/(?<=[。！？；\n])/)
      .map(s => s.trim())
      .filter(s => s.length > 0)

    if (sentences.length === 0) {
      frameOffset += sceneFrames
      continue
    }

    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0)
    const GAP_FRAMES = 4
    const usableFrames = sceneFrames - GAP_FRAMES * (sentences.length - 1)
    let cursor = frameOffset

    for (let j = 0; j < sentences.length; j++) {
      const ratio = sentences[j].length / totalChars
      const dur = Math.max(FPS, Math.round(usableFrames * ratio))
      subtitles.push({
        text: sentences[j],
        startFrame: cursor,
        endFrame: cursor + dur,
      })
      cursor += dur + GAP_FRAMES
    }

    frameOffset += sceneFrames
  }

  const propsWithDurations = {
    ...props,
    sceneDurations: sceneDurations.map(d => d.frames),
    subtitles,
  }

  // ===== Step 2: 渲染画面 =====
  console.log('\n📦 打包 Remotion bundle...')
  const bundleLocation = await bundle({
    entryPoint: path.resolve(__dirname, './index.ts'),
    webpackOverride: (config) => config,
    publicDir: path.resolve(__dirname, '../public'),
  })

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'SummaryVideo',
    inputProps: propsWithDurations,
  })
  composition.durationInFrames = totalFrames

  const silentPath = path.resolve(__dirname, `../out/${props.studentName}_${semester}_总结_silent.mp4`)
  const finalPath = path.resolve(__dirname, `../out/${props.studentName}_${semester}_总结.mp4`)
  console.log(`\n🎬 开始渲染画面 (${totalSec.toFixed(1)}s)...`)

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: silentPath,
    inputProps: propsWithDurations,
  })
  console.log(`✅ 画面渲染完成`)

  // ===== Step 3: 合并旁白音轨 =====
  const narrationPath = path.resolve(__dirname, '../out/narration_merged.mp3')
  console.log('\n🎙️  合并旁白音轨...')
  mergeNarrationTrack(scenes, sceneDurations, FPS, narrationPath)

  // ===== Step 4: ffmpeg 合并画面 + 旁白 + BGM（如有） =====
  const bgmPath = path.resolve(__dirname, '../public/bgm.mp3')
  const hasBgm = fs.existsSync(bgmPath) && fs.statSync(bgmPath).size > 10000
  console.log(`\n🎵 合并最终视频 (画面 + 旁白${hasBgm ? ' + BGM' : ''})...`)
  try {
    if (hasBgm) {
      const fadeOutStart = totalSec - 2
      execSync([
        'ffmpeg', '-y',
        `-i "${silentPath}"`,
        `-i "${narrationPath}"`,
        `-i "${bgmPath}"`,
        `-filter_complex "[2:a]aloop=loop=-1:size=2e+09,atrim=duration=${totalSec},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2,volume=0.10[bgm];[1:a]volume=1.0[narr];[bgm][narr]amix=inputs=2:duration=longest:dropout_transition=0[aout]"`,
        '-map 0:v -map "[aout]"',
        '-c:v copy -c:a aac -b:a 192k',
        `"${finalPath}"`,
      ].join(' '), { stdio: 'inherit', shell: '/bin/zsh' })
    } else {
      execSync([
        'ffmpeg', '-y',
        `-i "${silentPath}"`,
        `-i "${narrationPath}"`,
        '-map 0:v -map 1:a',
        '-c:v copy -c:a aac -b:a 192k',
        `"${finalPath}"`,
      ].join(' '), { stdio: 'inherit', shell: '/bin/zsh' })
    }

    fs.unlinkSync(silentPath)
    fs.unlinkSync(narrationPath)
    console.log(`\n🎉 最终视频: ${finalPath}`)
  } catch (e) {
    console.error('⚠️  音频合并失败:', e)
    fs.renameSync(silentPath, finalPath)
    console.log(`\n🎉 渲染完成（无音频）: ${finalPath}`)
  }

  // ===== Step 5: 复制到 server/data/videos/ 并更新数据库 =====
  const videosDir = path.resolve(__dirname, '../../server/data/videos')
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true })

  const serverVideoName = `${props.studentName}_${semester}_总结.mp4`
  const serverVideoPath = path.join(videosDir, serverVideoName)
  fs.copyFileSync(finalPath, serverVideoPath)
  console.log(`📂 已复制到服务端: ${serverVideoPath}`)

  const dbForWrite = new Database(DB_PATH)
  const videoRelPath = `server/data/videos/${serverVideoName}`
  const reportContent = JSON.stringify({
    type: 'video',
    videoPath: videoRelPath,
    generatedAt: new Date().toISOString(),
  })

  dbForWrite.prepare(`
    INSERT INTO reports (student_id, semester, term, report_type, content)
    VALUES (?, ?, ?, 'summary', ?)
    ON CONFLICT(student_id, semester, term, report_type)
    DO UPDATE SET content = excluded.content, created_at = datetime('now')
  `).run(studentId, semester, term, reportContent)
  dbForWrite.close()
  console.log(`💾 数据库记录已更新: reports.summary → ${videoRelPath}`)
}

main().catch((e) => {
  console.error('❌ 渲染失败:', e)
  process.exit(1)
})
