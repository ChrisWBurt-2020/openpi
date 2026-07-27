import logoUrl from '@icons/icon.svg'
import { ExternalLink, FolderOpen } from 'lucide-solid'
import { createEffect, createSignal, Show } from 'solid-js'
import openProjectUrl from '../assets/companion/onboarding/onboarding-open-project-master.png?url'
import reviewChangesUrl from '../assets/companion/onboarding/onboarding-review-changes-master.png?url'
import workWithPiUrl from '../assets/companion/onboarding/onboarding-work-with-pi-master.png?url'
import { HeronLoader } from './companion/HeronLoader'

interface WelcomeProps {
  appName: string
  appVersionLabel: string | null
  error: string | null
  onOpen: () => Promise<void>
}

const onboardingSteps = [
  {
    image: openProjectUrl,
    text: (
      <>
        Click <strong>Open workspace</strong> and select your project folder
      </>
    ),
  },
  {
    image: workWithPiUrl,
    text: <>Start chatting — Pi reads your project files and responds with full context</>,
  },
  {
    image: reviewChangesUrl,
    text: <>Review changes in the Git panel, then stage and commit</>,
  },
] as const

export function Welcome(props: WelcomeProps) {
  const [firstRun, setFirstRun] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  const [selectedStep, setSelectedStep] = createSignal(0)

  const openWorkspace = async () => {
    if (opening()) return
    setOpening(true)
    try {
      await props.onOpen()
    } finally {
      setOpening(false)
    }
  }

  createEffect(() => {
    void window.openpi.getFirstRun().then((isFirst) => setFirstRun(isFirst))
  })

  return (
    <div class="welcome-screen">
      <div class="welcome-logo-stage">
        <img class="welcome-logo" src={logoUrl} alt="OpenPi" />
        <span class="welcome-logo-scan" aria-hidden="true" />
      </div>
      <div class="eyebrow">{props.appName}</div>
      <h1>A desktop workbench for Pi coding agent</h1>
      <p>Local-first sessions, model controls, and recoverable agent state.</p>

      <Show when={firstRun()}>
        <div class="welcome-onboarding">
          <p class="welcome-onboarding-intro">
            <strong>Getting started:</strong> Open a workspace directory to start a Pi session. Pi
            reads your project files, responds to prompts, and edits code — all with full context of
            your repository.
          </p>
          <div class="welcome-onboarding-content">
            <div class="welcome-onboarding-steps">
              {onboardingSteps.map((step, index) => (
                <button
                  type="button"
                  classList={{
                    'welcome-step': true,
                    'welcome-step--selected': selectedStep() === index,
                  }}
                  onClick={() => setSelectedStep(index)}
                >
                  <span class="welcome-step-num">{index + 1}</span>
                  <span>{step.text}</span>
                </button>
              ))}
            </div>
            <img
              class="welcome-onboarding-art"
              src={onboardingSteps[selectedStep()].image}
              alt=""
              aria-hidden="true"
            />
          </div>
          <div class="welcome-onboarding-links">
            <a
              href="https://github.com/earendil-works/pi"
              target="_blank"
              rel="noopener noreferrer"
              class="welcome-link"
            >
              <ExternalLink size={13} /> Pi repo
            </a>
            <a
              href="https://github.com/heyhuynhgiabuu/openpi"
              target="_blank"
              rel="noopener noreferrer"
              class="welcome-link"
            >
              <ExternalLink size={13} /> OpenPi source
            </a>
          </div>
        </div>
      </Show>

      <div class="welcome-actions">
        <button
          type="button"
          class="button-primary"
          disabled={opening()}
          onClick={() => void openWorkspace()}
        >
          <FolderOpen size={15} /> {opening() ? 'Opening workspace…' : 'Open workspace'}
        </button>
        <Show when={opening()}>
          <HeronLoader phase="session" compact label="Creating verified workspace session" />
        </Show>
      </div>

      <Show when={props.error}>
        <div class="error-banner">{props.error}</div>
      </Show>
      <Show when={props.appVersionLabel}>
        {(versionLabel) => <span class="welcome-version">{versionLabel()}</span>}
      </Show>
    </div>
  )
}
