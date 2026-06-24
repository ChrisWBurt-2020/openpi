/**
 * scopeFilter — Phase 3: filter file lists based on the selected diff scope.
 */

import type { GitChangedFile } from '../../lib/ipc'
import type { DiffScope } from './DiffScopeSwitcher'

/**
 * Returns files appropriate for the current diff scope:
 * - 'unstaged' → only working-tree (non-staged) files
 * - 'staged'   → only staged files
 * - 'branch'   → all files (branch diff includes everything)
 */
export function diffScopeFilter(files: GitChangedFile[], scope: DiffScope): GitChangedFile[] {
  switch (scope) {
    case 'staged':
      return files.filter((f) => f.staged)
    case 'unstaged':
      return files.filter((f) => !f.staged)
    case 'branch':
      return files
  }
}
