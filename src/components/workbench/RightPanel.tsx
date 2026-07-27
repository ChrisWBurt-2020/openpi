/**
 * RightPanel — source control + file tree tabs.
 */
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { CompanionViews } from '../../lib/companionView'
import type { GitChangedFile, GitFileDiff, GitSyncAction } from '../../lib/ipc'
import type { Message } from '../../types/session'
import { CompanionPanel } from '../companion/CompanionPanel'
import { FileTree } from '../git/FileTree'
import { GitPanel } from '../git/GitPanel'
import { SignalsPanel } from './SignalsPanel'

interface Props {
  visible: boolean
  cwd: string
  width: number
  onResize: (delta: number) => void
  changeCount: number | null
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
  onFileClick: (relPath: string) => void
  onFileDeleted: (relPath: string, isDir: boolean) => void
  onFileRenamed: (oldPath: string, newPath: string) => void
  onSyncLabelChange?: (label: string) => void
  onSyncActionChange?: (action: GitSyncAction | null) => void
  onSyncMessageChange?: (message: string | null) => void
  onOpenHistory?: () => void
  messages: Message[]
  sessionPath: string | null
  companions?: CompanionViews
}

export function RightPanel(props: Props) {
  const [sidebarTab, setSidebarTab] = createSignal<'changes' | 'files' | 'signals' | 'companion'>(
    'files'
  )
  onMount(() => {
    const open = () => setSidebarTab('companion')
    window.addEventListener('openpi:companion-open', open)
    onCleanup(() => window.removeEventListener('openpi:companion-open', open))
  })

  return (
    <div class="rp-container" style={{ width: `${props.width}px` }}>
      <Show when={props.visible}>
        <div class="rp-sidebar-tabs">
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'changes' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('changes')}
          >
            <Show when={props.changeCount && props.changeCount > 0} fallback="Changes">
              <span class="rp-badge">{props.changeCount}</span>
              {' Changes'}
            </Show>
          </button>
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'files' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('files')}
          >
            Files
          </button>
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'signals' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('signals')}
          >
            Signals
          </button>
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'companion' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('companion')}
          >
            Heron
          </button>
        </div>

        <div class="rp-sidebar-content">
          <Show when={sidebarTab() === 'changes'}>
            <GitPanel
              cwd={props.cwd}
              activeTab="changes"
              hideHeader
              side="right"
              style={{ height: '100%', width: '100%', border: '0' }}
              onDiffOpen={props.onDiffOpen}
              onCommitFileClick={props.onCommitFileClick}
              onSyncLabelChange={props.onSyncLabelChange}
              onSyncActionChange={props.onSyncActionChange}
              onSyncMessageChange={props.onSyncMessageChange}
              onOpenHistory={props.onOpenHistory}
            />
          </Show>

          <Show when={sidebarTab() === 'files'}>
            <FileTree
              cwd={props.cwd}
              onFileClick={(path) => props.onFileClick(path)}
              onFileDeleted={props.onFileDeleted}
              onFileRenamed={props.onFileRenamed}
            />
          </Show>
          <Show when={sidebarTab() === 'signals'}>
            <SignalsPanel
              workspacePath={props.cwd}
              sessionPath={props.sessionPath}
              messages={props.messages}
              onFileClick={props.onFileClick}
            />
          </Show>
          <Show when={sidebarTab() === 'companion'}>
            <CompanionPanel view={Object.values(props.companions ?? {}).find((view) => view.projectPath === props.cwd)} />
          </Show>
        </div>
      </Show>
    </div>
  )
}
