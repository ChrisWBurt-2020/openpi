import { eventsApi } from './events'
import { gitApi } from './git'
import { remoteApi } from './remote'
import { resourcesApi } from './resources'
import { runsApi } from './runs'
import { sessionApi } from './session'
import { terminalApi } from './terminal'

export const api = {
  ...sessionApi,
  ...terminalApi,
  ...gitApi,
  ...resourcesApi,
  ...remoteApi,
  ...runsApi,
  ...eventsApi,
} as const
