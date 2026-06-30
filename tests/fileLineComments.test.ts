import { describe, expect, it } from 'vitest'
import {
  type FileLineComment,
  formatCompactLineRange,
  formatFileLineCommentPrompt,
  formatFileLineCommentsPrompt,
  formatLineRange,
} from '../src/lib/fileLineComments'

describe('file line comments', () => {
  const comment: FileLineComment = {
    id: 'comment-1',
    path: 'src/App.tsx',
    startLine: 10,
    endLine: 12,
    side: 'current',
    source: 'file',
    snippet: 'const a = 1\nconst b = 2\nreturn a + b',
    comment: 'Explain whether this should be extracted.',
  }

  it('formats single-line and multi-line ranges for UI labels', () => {
    expect(formatLineRange(4, 4)).toBe('line 4')
    expect(formatLineRange(4, 9)).toBe('lines 4-9')
  })

  it('formats compact ranges for composer chips', () => {
    expect(formatCompactLineRange(4, 4)).toBe('4')
    expect(formatCompactLineRange(4, 9)).toBe('4-9')
  })

  it('serializes a line comment as structured prompt context', () => {
    expect(formatFileLineCommentPrompt(comment)).toContain(
      '<file_comment path="src/App.tsx" startLine="10" endLine="12">'
    )
    expect(formatFileLineCommentPrompt(comment)).toContain('<selected_code>')
    expect(formatFileLineCommentPrompt(comment)).toContain(comment.snippet)
    expect(formatFileLineCommentPrompt(comment)).toContain(comment.comment)
  })

  it('always emits startLine and endLine (no `line="N"` shortcut)', () => {
    const single: FileLineComment = { ...comment, id: 'single', startLine: 7, endLine: 7 }
    const formatted = formatFileLineCommentPrompt(single)
    expect(formatted).toContain('startLine="7"')
    expect(formatted).toContain('endLine="7"')
    expect(formatted).not.toMatch(/\bline="7"/)
  })

  it('omits the side attribute for file comments', () => {
    expect(formatFileLineCommentPrompt(comment)).not.toContain('side=')
  })

  it('includes the side attribute for review comments on diff lines', () => {
    const reviewComment: FileLineComment = {
      ...comment,
      id: 'comment-2',
      side: 'additions',
      source: 'review',
    }
    const formatted = formatFileLineCommentPrompt(reviewComment)
    expect(formatted).toContain(
      '<file_comment path="src/App.tsx" side="additions" startLine="10" endLine="12">'
    )
  })

  it('serializes a batch only when comments exist', () => {
    expect(formatFileLineCommentsPrompt([])).toBe('')
    expect(formatFileLineCommentsPrompt([comment])).toContain(
      'Use these file-specific line comments as context for the next response'
    )
  })

  it('LLM-bound batch prompt preserves the line number for every comment', () => {
    // Regression: earlier `DOMPurify` pass stripped the custom tags, so the LLM got only the
    // comment body without LOC. The renderer-side fix in `MarkdownContent` preserves the tags,
    // and the batch prompt must always include startLine/endLine so the LLM has the location.
    const a: FileLineComment = { ...comment, id: 'a', startLine: 10, endLine: 12 }
    const b: FileLineComment = { ...comment, id: 'b', startLine: 4268, endLine: 4268 }
    const formatted = formatFileLineCommentsPrompt([a, b])
    expect(formatted).toContain('startLine="10"')
    expect(formatted).toContain('endLine="12"')
    expect(formatted).toContain('startLine="4268"')
    expect(formatted).toContain('endLine="4268"')
    expect(formatted).not.toMatch(/\bline="(10|12|4268)"/)
  })
})
