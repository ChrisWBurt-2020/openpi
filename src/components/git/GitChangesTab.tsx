import type { GitChangedFile, GitSyncAction } from '../../lib/ipc'
import type { DiffScope } from './DiffScopeSwitcher'
import { GitAgentBanner } from './GitAgentBanner'
import { GitChangesList } from './GitChangesList'
import { GitCommitArea } from './GitCommitArea'
import { diffScopeFilter } from './scopeFilter'

interface AgentChangedFiles {
  count: number
  files: GitChangedFile[]
}

interface GitChangesTabProps {
  agentChangedFiles: AgentChangedFiles | null
  showingAgentFiles: boolean
  statusLoaded: boolean
  hasUpstream: boolean
  totalChanged: number
  stageableFiles: GitChangedFile[]
  pinnedAgentFiles: GitChangedFile[]
  conflictFiles: GitChangedFile[]
  stagedFiles: GitChangedFile[]
  unstagedFiles: GitChangedFile[]
  untrackedFiles: GitChangedFile[]
  loadingDiff: string | null
  commitMessage: string
  isCommitting: boolean
  isGeneratingMessage: boolean
  commitOptionsOpen: boolean
  commitAmend: boolean
  commitSignoff: boolean
  commitError: string | null
  syncingAction: GitSyncAction | null
  syncBlocked: boolean
  onReviewAgentChanges: () => void
  onDismissAgentChanges: () => void
  onStageAll: () => void
  onUnstageAll: () => void
  onShowAllChanges: () => void
  onFileClick: (file: GitChangedFile) => void
  onStageToggle: (file: GitChangedFile, event: Event) => void
  onCommitMessageChange: (message: string) => void
  onGenerateCommitMessage: () => void
  onCommit: (push: boolean) => void
  onCommitOptionsOpenChange: (open: boolean) => void
  onCommitAmendChange: (value: boolean) => void
  onCommitSignoffChange: (value: boolean) => void
  onSync: (action: GitSyncAction) => void
  onOpenHistory?: () => void
  /* Phase 3: diff scope for file list filtering */
  diffScope: DiffScope
}

export function GitChangesTab(props: GitChangesTabProps) {
  // Filter files based on diff scope
  const filteredStageable = () => diffScopeFilter(props.stageableFiles, props.diffScope)
  const filteredStaged = () => diffScopeFilter(props.stagedFiles, props.diffScope)
  const filteredUnstaged = () => diffScopeFilter(props.unstagedFiles, props.diffScope)
  const filteredUntracked = () => diffScopeFilter(props.untrackedFiles, props.diffScope)
  const filteredConflicts = () => diffScopeFilter(props.conflictFiles, props.diffScope)

  return (
    <div class="git-panel-body">
      <GitAgentBanner
        agentChangedFiles={props.agentChangedFiles}
        showingAgentFiles={props.showingAgentFiles}
        onReview={props.onReviewAgentChanges}
        onDismiss={props.onDismissAgentChanges}
      />
      <div class="git-changes-scroll">
        <GitChangesList
          statusLoaded={props.statusLoaded}
          totalChanged={props.totalChanged}
          showingAgentFiles={props.showingAgentFiles}
          stageableFiles={filteredStageable()}
          pinnedAgentFiles={props.pinnedAgentFiles}
          conflictFiles={filteredConflicts()}
          stagedFiles={filteredStaged()}
          unstagedFiles={filteredUnstaged()}
          untrackedFiles={filteredUntracked()}
          loadingDiff={props.loadingDiff}
          onStageAll={props.onStageAll}
          onUnstageAll={props.onUnstageAll}
          onShowAllChanges={props.onShowAllChanges}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
      </div>

      <GitCommitArea
        commitMessage={props.commitMessage}
        isCommitting={props.isCommitting}
        isGeneratingMessage={props.isGeneratingMessage}
        commitOptionsOpen={props.commitOptionsOpen}
        commitAmend={props.commitAmend}
        commitSignoff={props.commitSignoff}
        commitError={props.commitError}
        syncingAction={props.syncingAction}
        syncBlocked={props.syncBlocked}
        hasUpstream={props.hasUpstream}
        totalChanged={props.totalChanged}
        hasStagedFiles={props.stagedFiles.length > 0}
        onCommitMessageChange={props.onCommitMessageChange}
        onCommit={props.onCommit}
        onGenerateCommitMessage={props.onGenerateCommitMessage}
        onCommitOptionsOpenChange={props.onCommitOptionsOpenChange}
        onCommitAmendChange={props.onCommitAmendChange}
        onCommitSignoffChange={props.onCommitSignoffChange}
        onSync={props.onSync}
        onOpenHistory={props.onOpenHistory}
      />
    </div>
  )
}
