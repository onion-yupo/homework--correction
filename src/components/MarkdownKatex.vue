<script lang="ts" setup>
/**
 * Markdown + KaTeX 渲染组件
 * 渲染流程：sanitize → 提取 $...$ 公式 → 占位符保护 → marked 解析 → KaTeX 还原
 */
import katex from 'katex'
import { marked } from 'marked'

marked.use({
  renderer: {
    del({ tokens }) {
      return `~~${tokens.map(t => ('raw' in t ? t.raw : '')).join('')}~~`
    },
  },
})

const props = defineProps<{
  content: string
  inline?: boolean
}>()

function fixUnclosedDollar(text: string): string {
  const count = (text.match(/\$/g) || []).length
  return count % 2 === 1 ? `${text}$` : text
}

/**
 * @returns true 如果内容看起来像数学公式而非普通文本
 */
function isValidFormula(content: string): boolean {
  if (content.length > 500) return false
  if (/#{1,3}\s/.test(content)) return false
  if (/[|]/.test(content) && content.length > 80 && !/\\begin/.test(content)) return false
  const chineseCount = (content.match(/[\u4e00-\u9fff]/g) || []).length
  const totalLen = content.replace(/\s/g, '').length || 1
  if (chineseCount / totalLen > 0.5) return false
  if (/^[\u4e00-\u9fff\s，。、；：！？]+$/.test(content)) return false
  return true
}

function safeKatex(formula: string, displayMode: boolean): string {
  try {
    const rendered = katex.renderToString(formula, { throwOnError: false, displayMode })
    if (rendered.includes('katex-error')) return escapeHtml(formula)
    return rendered
  }
  catch { return escapeHtml(formula) }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 将 OCR 产生的多行 \frac 竖式转为 KaTeX array 环境。
 * 输入: "442\n$\t864\n-\frac{147}{\quad717}\n\quad717\n-\frac{265}{\quad442}$"
 * 输出: "442\n$\begin{array}{r} 864 \\ -\;147 \\ \hline 717 \\ ... \end{array}$"
 */
function convertFracVerticalCalc(text: string): string {
  return text.replace(/\$([^$]*\\frac\{[^$]*)\$/g, (_full, inner: string) => {
    const raw = inner.replace(/\t/g, ' ').trim()
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean)
    const parts: string[] = []

    for (const line of lines) {
      const m = line.match(/^([+\-×÷]?)\\frac\{([^}]*)\}\{([^}]*)\}(.*)$/)
      if (m) {
        const [, op, numer, denom, rest] = m
        const cleanNum = numer.replace(/\\quad/g, '').trim()
        if (op) parts.push(`${op}\\;${cleanNum}`)
        else if (cleanNum) parts.push(cleanNum)
        parts.push('\\hline')
        const cleanDen = denom.replace(/\\quad/g, '').trim()
        if (cleanDen) parts.push(cleanDen)
        const extra = rest.replace(/\\quad/g, '').trim()
        if (extra) parts.push(extra)
        continue
      }
      const cleaned = line.replace(/\\quad/g, '').trim()
      if (cleaned) parts.push(cleaned)
    }

    if (parts.length < 2) return `$${inner}$`
    const joined = parts.reduce((acc, p, i) => {
      if (i === 0) return p
      if (p === '\\hline') return `${acc} \\\\ ${p}`
      if (parts[i - 1] === '\\hline') return `${acc} ${p}`
      return `${acc} \\\\ ${p}`
    }, '')
    return `$\\begin{array}{r} ${joined} \\end{array}$`
  })
}

/**
 * 清理 OCR / 大模型输出中常见的 LaTeX 格式问题
 */
function sanitizeModelOutput(text: string): string {
  let s = text

  s = s.replace(/＄/g, '$')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/～/g, '~')
  s = s.replace(/~~(\*\*[\s\S]*?\*\*)~~/g, '$1')
  s = s.replace(/~~([\s\S]+?)~~/g, '$1')
  s = s.replace(/^[-*_]{3,}$/gm, '')
  s = s.replace(/^—{2,}$/gm, '')

  /* OCR 噪声: \b 前缀清理（\b 不是有效 KaTeX 命令） */
  s = s.replace(/(\\b)+(?=\\begin)/g, '')
  s = s.replace(/\\b(?=[^a-zA-Z])/g, '')
  /* OCR 噪声: \dot 用在数字上 → 直接去掉 \dot */
  s = s.replace(/\\dot\{?(\d)\}?/g, '$1')
  s = s.replace(/\\dot(\d)/g, '$1')
  /* \boxed{} / \boxed{\quad} → \square（空 boxed 可能导致 KaTeX 报错） */
  s = s.replace(/\\boxed\{(?:\s|\\quad)*\}/g, '\\square')

  /* OCR 噪声: \cdots / \ldots → 六个点 ……（小学余数写法） */
  s = s.replace(/\\cdots\s*\\cdots/g, '……')
  s = s.replace(/\\ldots\s*\\ldots/g, '……')
  s = s.replace(/\\cdots/g, '……')
  s = s.replace(/\\ldots/g, '……')

  /* tab 字符 → 空格 */
  s = s.replace(/\t/g, ' ')

  /* OCR 残缺: oxed{X} → \underline{X}（\boxed 丢失 \b 后的残留） */
  s = s.replace(/(?<=\s|\\)oxed\{/g, '\\underline{')

  /* OCR 竖式: $...\square\\quad...$ 用 \quad 缩进 → 转为 array 环境 */
  s = s.replace(/\$([^$]*\\\\quad[^$]*)\$/g, (match, inner) => {
    if (/\\begin\{/.test(inner)) return match
    const body = inner
      .replace(/\\\\quad/g, ' \\\\ ')
      .replace(/\\quad/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return `$\\begin{array}{r}${body}\\end{array}$`
  })

  /* array 环境中 \\hline → \\ \hline（补空格确保行换符与 \hline 分离） */
  s = s.replace(/\\\\hline/g, '\\\\ \\hline')

  /* aligned 环境中 \=& → \\=&（OCR 丢失换行反斜杠） */
  s = s.replace(/(\$[^$]*\\begin\{aligned\})([\s\S]*?)(\\end\{aligned\}[^$]*\$)/g, (_m, pre, body, post) => {
    return pre + body.replace(/\\=\s*&/g, '\\\\\n=&') + post
  })

  /* 双反斜杠 \\alpha → \alpha（跳过 array 行换符后的合法命令） */
  s = s.replace(/\\\\(?!hline\b|begin\b|end\b|\\| )([a-zA-Z])/g, (_, ch) => `\\${ch}`)

  /* KaTeX 不支持 \enclose，逐个变体转换 */
  s = s.replace(/\\enclose\{longdiv\}\s*\{([^}]*)\}/g, '\\overline{)$1}')
  s = s.replace(/\\enclose\{horizontalstrike\}\s*\{\\phantom\{0\}\}/g, ')')
  s = s.replace(/\\enclose\{horizontalstrike\}\s*\{([^}]*)\}/g, '$1')

  /* 竖式清理: \overline{\smash{X}} → \overline{X}，D{\overline{X}} → D\overline{X} */
  s = s.replace(/\\overline\{\\smash\{([^}]*)\}\}/g, '\\overline{$1}')
  s = s.replace(/(\d)\{(\\overline\{[^}]*\})\}/g, '$1$2')

  /* \dfrac 内嵌 \begin{aligned} 的竖式：转为 array 环境 */
  s = s.replace(/\\dfrac\{(\\begin\{aligned\}[\s\S]*?\\end\{aligned\})\}\{([^}]*)\}/g, (_m, aligned: string, result: string) => {
    const lines = aligned
      .replace(/\\begin\{aligned\}/, '')
      .replace(/\\end\{aligned\}/, '')
      .replace(/&/g, '')
      .split('\\\\')
      .map((l: string) => l.trim())
      .filter(Boolean)
    return `\\begin{array}{r}${lines.join(' \\\\ ')} \\\\ \\hline ${result.trim()} \\end{array}`
  })

  /* 先处理 $...\frac...\frac...$ 多行竖式 → array 环境（在去 $ 之前） */
  s = convertFracVerticalCalc(s)

  /* 散落 $ 修复：仅合并连续 $$，不合并相邻 $...$\n$...$ 块 */
  s = s.replace(/\${2,}/g, '$')

  let dc = (s.match(/\$/g) || []).length
  if (dc % 2 === 1) {
    s = s.replace(/^\$\s*$/gm, '')
    dc = (s.match(/\$/g) || []).length
    if (dc % 2 === 1) {
      s = s.replace(/^\$\n/, '')
    }
  }

  return s
}

const html = computed(() => {
  if (!props.content) return ''

  let text = sanitizeModelOutput(props.content)

  /* 自动包裹裸露的 \begin...\end 块（不在 $ 内的） */
  text = text.replace(/(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g, (match, _, offset) => {
    const before = text.substring(Math.max(0, offset - 5), offset).trimEnd()
    if (before.endsWith('$')) return match
    return `$${match}$`
  })

  text = fixUnclosedDollar(text)

  const formulaMap: Record<string, { formula: string, display: boolean }> = {}
  let formulaIdx = 0

  /* 提取含 \begin...\end 的多行公式（贪心匹配最近的 $...$） */
  text = text.replace(/\$([\s\S]*?\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}[\s\S]*?)\$/g, (_, formula) => {
    const key = `%%FORMULA_${formulaIdx++}%%`
    formulaMap[key] = { formula: formula.trim(), display: false }
    return key
  })

  /* 提取 \xrightarrow 等链式公式 */
  text = text.replace(/\$((?:[^$]|\n)*?\\xrightarrow[\s\S]*?)\$/g, (full, formula) => {
    if (full.startsWith('%%')) return full
    const key = `%%FORMULA_${formulaIdx++}%%`
    formulaMap[key] = { formula: formula.trim(), display: false }
    return key
  })

  /* 独占一行的 $...$ (允许多行内容) */
  text = text.replace(/^[ \t]*\$([\s\S]+?)\$[ \t]*$/gm, (fullMatch, formula) => {
    if (formula.includes('$')) return fullMatch
    if (!isValidFormula(formula)) return `$${formula}$`
    const key = `%%FORMULA_${formulaIdx++}%%`
    formulaMap[key] = { formula: formula.trim(), display: !props.inline }
    return key
  })

  /* 行内 $...$ */
  text = text.replace(/\$([^$]+?)\$/g, (_, formula) => {
    if (!isValidFormula(formula)) return formula
    const key = `%%FORMULA_${formulaIdx++}%%`
    formulaMap[key] = { formula: formula.trim(), display: false }
    return key
  })

  const BARE_LATEX_CMDS = 'angle|triangle|overline|vec|hat|bar|parallel|perp|sim|cong|equiv|frac|sqrt|cdot|times|div|leq|geq|neq|pm|bigcirc|square|xrightarrow'

  text = text.replace(
    new RegExp(`(\\\\(?:${BARE_LATEX_CMDS})(?:\\{[^}]*\\}|[^%，。、；：！？\u4e00-\u9fff\\n])*)`, 'g'),
    (match) => {
      if (match.includes('%%FORMULA')) return match
      return `$${match.trim()}$`
    },
  )

  text = text.replace(
    /(?<!\$)(\d+(?:\.\d+)?)\s*(\^|_)\s*(\\[a-zA-Z]+(?:\{[^}]*\})?|\{[^}]*\})(?!\$)/g,
    (_, num, op, rest) => `$${num}${op}${rest}$`,
  )

  text = text.replace(/^\* /gm, '- ')
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')

  let result = props.inline
    ? marked.parseInline(text, { async: false }) as string
    : marked.parse(text, { async: false }) as string

  const CJK_RANGE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d，。、；：！？（）《》【】]/

  result = result.replace(/%%FORMULA_(\d+)%%/g, (match) => {
    const entry = formulaMap[match]
    if (!entry) return match
    try {
      let f = entry.formula

      /**
       * array 环境内 `\ `(反斜杠+空格) 是 thin space 而非换行。
       * OCR 经常把 `\\` 存成 `\ `，需要还原为 `\\` 才能正确换行。
       */
      if (/\\begin\{array\}/.test(f)) {
        f = f.replace(/\\ (?=[-+]|\\hline|\\square|\\end|\d)/g, ' \\\\ ')
      }

      /* 修复粘连的命令名 */
      f = f.replace(
        /\\([a-z]+)([a-z])/gi,
        (_, cmd, nextChar) => {
          const known = [
            'times', 'cdot', 'div', 'pm', 'mp', 'leq', 'geq', 'neq',
            'approx', 'equiv', 'sim', 'in', 'notin', 'subset', 'supset',
            'cup', 'cap', 'sqrt', 'frac', 'dfrac', 'sum', 'prod', 'int',
            'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu',
            'pi', 'sigma', 'phi', 'omega', 'infty', 'partial',
            'angle', 'triangle', 'parallel', 'perp', 'overline', 'bigcirc',
            'square', 'hline', 'quad', 'enclose', 'xrightarrow',
            'begin', 'end', 'array', 'aligned',
          ]
          if (known.includes(cmd)) return `\\${cmd} ${nextChar}`
          return `\\${cmd}${nextChar}`
        },
      )

      if (CJK_RANGE.test(f)) {
        const segments = f.split(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d，。、；：！？（）《》【】]+)/)
        let out = ''
        for (const seg of segments) {
          if (!seg) continue
          if (CJK_RANGE.test(seg)) { out += seg }
          else {
            const trimmed = seg.trim()
            if (!trimmed) continue
            out += safeKatex(trimmed, entry.display)
          }
        }
        return out
      }

      return safeKatex(f, entry.display)
    }
    catch { return escapeHtml(entry.formula) }
  })

  return result
})
</script>

<template>
  <div v-if="content" class="md-katex" v-html="html" />
</template>

<style lang="scss" scoped>
.md-katex {
  word-break: break-word;
  overflow-wrap: break-word;

  :deep(p) {
    margin: 6px 0;
    line-height: 1.8;
  }

  :deep(p:first-child) {
    margin-top: 0;
  }

  :deep(p:last-child) {
    margin-bottom: 0;
  }

  :deep(ul), :deep(ol) {
    margin: 6px 0;
    padding-left: 20px;

    li {
      margin: 4px 0;
      line-height: 1.7;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: var(--color-text);
  }

  :deep(em) {
    font-style: italic;
  }

  :deep(hr) {
    display: none;
  }

  :deep(h1), :deep(h2), :deep(h3) {
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text);
    margin: 12px 0 6px;
  }

  :deep(.katex) {
    font-size: 1em;
  }

  :deep(.katex-display) {
    display: block;
    margin: 8px 0;
    text-align: center;
    overflow: visible;

    > .katex {
      font-size: 1em;
      white-space: normal;
    }
  }

  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 13px;
  }

  :deep(th), :deep(td) {
    padding: 6px 10px;
    border: 1px solid var(--color-border);
    text-align: left;
  }

  :deep(th) {
    background: var(--color-bg);
    font-weight: 600;
  }
}
</style>
