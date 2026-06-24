import { describe, expect, it } from 'vitest'
import {
  splitRawPatch,
  extractFileHeader,
  countHunkLines,
  hunkHeading,
} from '../src/components/git/hunkUtils'

// A realistic multi-hunk unified diff for testing
const MULTI_HUNK_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,7 @@
 import { x } from 'y'
+import { z } from 'w'
 
 function foo() {
-  return x
+  return x + z
 }
@@ -10,3 +12,5 @@
 function bar() {
   return 1
 }
+function baz() {
+  return 2
+}`

const SINGLE_HUNK_DIFF = `diff --git a/src/bar.ts b/src/bar.ts
index abc123..def456 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,3 +1,4 @@
 function bar() {
-  return 1
+  return 2
 }`

const NEW_FILE_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function newFunc() {
+  return 42
+}`

describe('extractFileHeader', () => {
  it('extracts lines before the first @@ header', () => {
    const header = extractFileHeader(MULTI_HUNK_DIFF)
    expect(header).toContain('diff --git')
    expect(header).toContain('--- a/src/foo.ts')
    expect(header).toContain('+++ b/src/foo.ts')
    expect(header).not.toContain('@@')
  })

  it('handles new file diffs', () => {
    const header = extractFileHeader(NEW_FILE_DIFF)
    expect(header).toContain('new file mode')
    expect(header).toContain('--- /dev/null')
    expect(header).not.toContain('@@')
  })
})

describe('splitRawPatch', () => {
  it('returns empty array for empty input', () => {
    expect(splitRawPatch('')).toEqual([])
  })

  it('returns single patch for diff with no @@ hunks', () => {
    const noHunk = 'diff --git a/x b/x\nindex 123..456\n'
    const result = splitRawPatch(noHunk)
    expect(result).toHaveLength(1)
  })

  it('splits multi-hunk diff into separate patches', () => {
    const hunks = splitRawPatch(MULTI_HUNK_DIFF)
    expect(hunks).toHaveLength(2)
  })

  it('each hunk patch includes the file header', () => {
    const hunks = splitRawPatch(MULTI_HUNK_DIFF)
    for (const hunk of hunks) {
      expect(hunk).toContain('diff --git')
      expect(hunk).toContain('--- a/src/foo.ts')
      expect(hunk).toContain('+++ b/src/foo.ts')
    }
  })

  it('each hunk patch has exactly one @@ header', () => {
    const hunks = splitRawPatch(MULTI_HUNK_DIFF)
    for (const hunk of hunks) {
      const atAtCount = (hunk.match(/@@ /g) ?? []).length
      expect(atAtCount).toBe(1)
    }
  })

  it('handles single-hunk diff', () => {
    const hunks = splitRawPatch(SINGLE_HUNK_DIFF)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toContain('@@ -1,3 +1,4 @@')
  })

  it('handles new file diffs', () => {
    const hunks = splitRawPatch(NEW_FILE_DIFF)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toContain('new file mode')
    expect(hunks[0]).toContain('@@ -0,0 +1,3 @@')
  })

  it('normalizes CRLF line endings', () => {
    const crlfDiff = MULTI_HUNK_DIFF.replace(/\n/g, '\r\n')
    const hunks = splitRawPatch(crlfDiff)
    expect(hunks).toHaveLength(2)
    // No \r should remain in the output
    for (const hunk of hunks) {
      expect(hunk).not.toContain('\r')
    }
  })
})

describe('countHunkLines', () => {
  it('counts additions and deletions correctly', () => {
    const patch = `@@ -1,3 +1,4 @@
 function bar() {
-  return 1
+  return 2
+  // new comment
 }`
    const result = countHunkLines(patch)
    expect(result.adds).toBe(2)
    expect(result.dels).toBe(1)
  })

  it('ignores +++ and --- header lines', () => {
    const patch = `--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old line
+new line`
    const result = countHunkLines(patch)
    expect(result.adds).toBe(1)
    expect(result.dels).toBe(1)
  })

  it('returns zeros for context-only patch', () => {
    const patch = `@@ -1,3 +1,3 @@
 context line 1
 context line 2
 context line 3`
    const result = countHunkLines(patch)
    expect(result.adds).toBe(0)
    expect(result.dels).toBe(0)
  })
})

describe('hunkHeading', () => {
  it('extracts the @@ header line', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -10,5 +10,7 @@
 context
+added`
    expect(hunkHeading(patch)).toBe('@@ -10,5 +10,7 @@')
  })

  it("returns 'Hunk' when no @@ line found", () => {
    expect(hunkHeading('no hunk here')).toBe('Hunk')
  })

  it('truncates long @@ headers to 60 chars', () => {
    const longHeader =
      '@@ -1,5 +1,7 @@ function someVeryLongFunctionNameThatExceedsTheLimit(args: string) {'
    const result = hunkHeading(longHeader)
    expect(result.length).toBeLessThanOrEqual(60)
  })
})
