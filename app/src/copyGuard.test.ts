import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const BANNED = [
  /IndexedDB/i, /WebCrypto/i, /non-extractable/i, /\bAES\b/i, /browser-managed/i,
  /\bhardware\b/i, /pseudonymous/i, /subject ID/i, /external ID/i, /return URL/i,
  /client token/i, /single-owner/i, /dedicated FinchNode application/i, /\brelay\b/i,
  /\bvault\b/i, /\bsealed\b/i, /\bgeneration\b/i, /\bsnapshot\b/i, /sync state/i,
  /service worker/i, /\bPWA\b/i, /\bFHIR\b/i, /\bRRULE\b/i, /\bfloating\b/i,
  /PRIVACY\.md/i, /repository/i, /\bmetadata\b/i, /\bOrigin\b/i, /allowlist/i,
  /canonical/i, /signature verification/i, /\bBYOK\b/i, /\bAPI\b/i,
  /\bworker\b/i, /\bblob\b/i, /\.ics\b/i,
]
const BANNED_CLASSES = /\b(page-kicker|phase-eyebrow|health-kicker|reminder-kicker|assistant-feature-kicker|eyebrow|kicker|tagline|collection-count|story-count|section-label|section-overline|ob-proof-row|ob-hero-label)\b/
const BANNED_GLYPHS = /[→↗‹›—]/
const ADJECTIVES = /\b(gentle|gently|calm|quietly|companion|without judgment)\b/i
const DECORATIVE_COPY = /\b(Read, ask, notice|Your time, your rhythm|Bring the question you keep circling|Your key, your conversation, your choice|A clearer map of your changing body|Your rhythm will appear here|Three readings unlock the line|For this part of your cycle|Chosen for your focus)\b/i
const UI_DIRS = ['screens', 'components', 'privacy']
const UI_COPY_FILES = ['records/providers/http.ts', 'records/connect.ts', 'platform/notifications.ts']
const UI_ERROR_FILES = ['lib/assistant.ts', 'lib/backup.ts', 'records/providers/relay.ts', 'records/relaySettings.ts']
// Educational content and reminder bodies are also displayed by these screens.
// Keep the existing jargon and sentence-length scope; apply decoration rules to
// these shared strings as well, so imported copy cannot bypass the new check.
const SHARED_DISPLAY_FILES = ['engine/reminders.ts', 'App.tsx']
const STRUCTURAL_ATTRIBUTES = new Set(['className', 'id', 'htmlFor', 'style', 'key', 'ref', 'href', 'src', 'type', 'role', 'name', 'value', 'defaultValue', 'accept', 'autoComplete', 'aria-labelledby', 'aria-describedby'])
const INLINE_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'small', 'a', 'code'])
type Copy = { text: string; line: number; consent: boolean }

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

const uiFiles = () => [...UI_DIRS.flatMap(dir => [...walk(resolve(__dirname, dir))]), ...UI_COPY_FILES.map(file => resolve(__dirname, file))]
const rel = (file: string) => file.split('/src/')[1]

const GLYPH_ENTITIES: Record<string, string> = { rarr: '→', nearr: '↗', lsaquo: '‹', rsaquo: '›', mdash: '—' }
const normalize = (text: string) => text
  .replace(/&(?:amp|nbsp);/g, ' ').replace(/&(?:apos|#39);/g, "'").replace(/&quot;/g, '"')
  .replace(/&(rarr|nearr|lsaquo|rsaquo|mdash);/g, (_, name: string) => GLYPH_ENTITIES[name])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, value: string) => {
    const code = value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value)
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity
  }).replace(/\s+/g, ' ').trim()

/** Parse actual literals and JSX, never comments, imports or code identifiers. */
function userFacingText(source: string, filename = 'copy.tsx', errorsOnly = false): Copy[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const copies: Copy[] = []
  function add(text: string, node: ts.Node) {
    text = normalize(text)
    // Paths and the plan's URL examples are configuration, not prose.
    if ((!/[A-Za-z]/.test(text) && !BANNED_GLYPHS.test(text)) || /^(?:https?:\/\/|\.{1,2}\/|\/)[^\s]+$/.test(text)) return
    let consent = false
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) && parent.openingElement.attributes.properties.some(attr =>
        ts.isJsxAttribute(attr) && attr.name.getText(file) === 'className' &&
        attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text.split(/\s+/).includes('records-consent'),
      )) consent = true
    }
    copies.push({ text, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, consent })
  }
  function expressionText(node: ts.Expression): string {
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span =>
      expressionText(span.expression) + span.literal.text,
    ).join('')
    return 'value'
  }
  function inlineText(node: ts.JsxChild): string {
    if (ts.isJsxText(node)) return node.text.replace(/\s+/g, ' ')
    if (ts.isJsxExpression(node)) return node.expression ? expressionText(node.expression) : ''
    if (ts.isJsxElement(node)) return node.children.map(inlineText).join('')
    return ''
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return
    if (ts.isJsxAttribute(node)) {
      if (!STRUCTURAL_ATTRIBUTES.has(node.name.getText(file)) && node.initializer) visit(node.initializer)
      return
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      // Keep inline markup and dynamic values within the surrounding sentence.
      // Block children remain separate so headings do not run into paragraphs.
      let text = ''
      let start: ts.Node = node
      const flush = () => { add(text, start); text = '' }
      for (const child of node.children) {
        const inline = ts.isJsxText(child) || ts.isJsxExpression(child) ||
          (ts.isJsxElement(child) && INLINE_TAGS.has(child.openingElement.tagName.getText(file)))
        if (inline) {
          if (!text) start = child
          text += inlineText(child)
        } else flush()
      }
      flush()
    }
    if (ts.isStringLiteralLike(node)) {
      if (!(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !ts.isElementAccessExpression(node.parent)) add(node.text, node)
    } else if (ts.isTemplateExpression(node)) add(expressionText(node), node)
    ts.forEachChild(node, visit)
  }
  // Shared adapters also contain request payloads and lock names, not UI copy.
  // Inspect their Error messages without changing that technical vocabulary.
  function visitErrors(node: ts.Node) {
    if (ts.isNewExpression(node) && node.expression.getText(file) === 'Error') node.arguments?.forEach(visit)
    else ts.forEachChild(node, visitErrors)
  }
  if (errorsOnly) visitErrors(file)
  else visit(file)
  return copies
}

const jargonOffenders = (copies: Copy[]) => copies.filter(({ text }) => BANNED.some(re => re.test(text)))
const longSentences = (copies: Copy[]) => copies.flatMap(copy => copy.text.split(/[.!?]/).flatMap(sentence => {
  const text = sentence.trim()
  const words = text.split(/\s+/).filter(word => /[A-Za-z0-9]/.test(word)).length
  return words > (copy.consent ? 24 : 20) ? [{ ...copy, text, words }] : []
}))

describe('UI copy guard', () => {
  const files = uiFiles()
  const markupFiles = [...files, ...SHARED_DISPLAY_FILES.map(file => resolve(__dirname, file))]
  const copy = [
    ...files.map(file => ({ file: file.split('/src/')[1], copies: userFacingText(readFileSync(file, 'utf8'), file) })),
    ...UI_ERROR_FILES.map(file => ({ file, copies: userFacingText(readFileSync(resolve(__dirname, file), 'utf8'), file, true) })),
  ]

  it('keeps implementation vocabulary out of user-facing text', () => {
    const offenders = copy.flatMap(({ file, copies }) => jargonOffenders(copies).map(({ line, text }) => `${file}:${line}: ${text}`))
    expect([...new Set(offenders)]).toEqual([])
  })

  it('keeps sentences within 20 words, or 24 for records consent', () => {
    const offenders = copy.flatMap(({ file, copies }) => longSentences(copies).map(({ line, text, words }) => `${file}:${line}: ${words} words: ${text}`))
    expect([...new Set(offenders)]).toEqual([])
  })

  it('has no eyebrow, kicker, tagline or section-label classes in UI markup', () => {
    const offenders = markupFiles.filter(file => BANNED_CLASSES.test(readFileSync(file, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  it('has no decorative glyphs or adjectives in user-facing text', () => {
    const shared = [...walk(resolve(__dirname, 'content')), ...SHARED_DISPLAY_FILES.map(file => resolve(__dirname, file))]
      .map(file => ({ file: rel(file), copies: userFacingText(readFileSync(file, 'utf8'), file) }))
    const offenders = [...copy, ...shared].flatMap(({ file, copies }) => copies
      .filter(({ text }) => BANNED_GLYPHS.test(text) || ADJECTIVES.test(text) || DECORATIVE_COPY.test(text))
      .map(({ line, text }) => `${file}:${line}: ${text}`))
    expect([...new Set(offenders)]).toEqual([])
  })

  it('uses uppercase only for weekday letters', () => {
    const css = readdirSync(resolve(__dirname, 'styles')).filter(name => name.endsWith('.css'))
      .map(name => readFileSync(resolve(__dirname, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')
    const blocks = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).filter(block =>
      /text-transform:\s*uppercase/.test(block) ||
      /letter-spacing:\s*(?:[1-9]\d*(?:\.\d+)?|0*\.\d*[1-9]\d*)(?:em|px|rem)/.test(block))
    const disallowed = blocks.filter(block => !block.split('{')[0].trim().split(',')
      .every(selector => /^(?:\.cal-weekdays span|\.date-strip \.dow)$/.test(selector.trim())))
      .map(block => block.split('{')[0].trim())
    expect(disallowed).toEqual([])
    expect(css).not.toMatch(/--tracking-label/)
    const inlineOffenders = markupFiles.filter(file => /textTransform:\s*['"]uppercase['"]|letterSpacing:\s*['"](?:0*\.\d*[1-9]\d*|[1-9]\d*)(?:em|px|rem)['"]/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(inlineOffenders).toEqual([])
  })

  it('checks glyph-only JSX, attributes and literal branches', () => {
    const source = '<button aria-label="Go →">↗<span>{ready ? "›" : "—"}</span></button>'
    const texts = userFacingText(source).map(copy => copy.text)
    for (const text of ['Go →', '↗', '›', '—']) expect(texts.some(copy => copy.includes(text))).toBe(true)
    expect(userFacingText('<button>&rarr; &#x2197; &#8250; &mdash;</button>').map(copy => copy.text)).toContain('→ ↗ › —')
    expect(userFacingText('// → is a comment')).toEqual([])
  })

  it('checks single-word labels, attributes, templates and inline JSX without reading comments or identifiers', () => {
    const source = [
      "import { vault } from './vault'",
      '// IndexedDB is a code comment.',
      "const metadata = 'Saved keys'; const typed: 'sealed' = 'ready'",
      'const view = <p className="vault">Your <strong>API</strong> key <span>stays sealed.</span></p>',
      'const label = <input aria-label="FHIR" placeholder="Your relay" />',
      'const status = `Your ${metadata} uses WebCrypto`',
    ].join('\n')
    const texts = jargonOffenders(userFacingText(source)).map(copy => copy.text)
    expect(texts).toContain('Your API key stays sealed.')
    expect(texts).toContain('FHIR')
    expect(texts).toContain('Your relay')
    expect(texts).toContain('Your value uses WebCrypto')
    expect(texts.some(text => /IndexedDB|\.\/vault|^sealed$/.test(text))).toBe(false)
  })

  it('counts across line breaks and inline markup, with a consent-only exception', () => {
    const sentence = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
    expect(longSentences(userFacingText(`<p>${sentence}.</p>`))).toEqual([])
    expect(longSentences(userFacingText(`<p>${sentence}\n<strong>extra</strong> word.</p>`))).not.toEqual([])
    expect(longSentences(userFacingText(`<label className="records-consent selected"><span>${sentence} plus three more words.</span></label>`))).toEqual([])
    expect(longSentences(userFacingText(`<label className="records-consent"><span>${sentence} plus five more words here.</span></label>`))).not.toEqual([])
  })
})
