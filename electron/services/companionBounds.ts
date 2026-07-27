import fs from 'node:fs'
import type { Display, Rectangle } from 'electron'
import { screen } from 'electron'

export function loadCompanionBounds(file: string): Record<string, Rectangle> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? (value as Record<string, Rectangle>) : {}
  } catch {
    return {}
  }
}

export function clampCompanionBounds(
  value: Rectangle | undefined,
  width: number,
  height: number
): Rectangle {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y))
    return { x: 40, y: 40, width, height }
  const work = screen.getDisplayNearestPoint({ x: value.x, y: value.y }).workArea
  return {
    x: Math.max(work.x, Math.min(value.x, work.x + work.width - width)),
    y: Math.max(work.y, Math.min(value.y, work.y + work.height - height)),
    width,
    height,
  }
}

export function boundsFromPlacement(
  display: Display,
  placement: { x: number; y: number },
  width: number,
  height: number
): Rectangle {
  const work = display.workArea
  return clampCompanionBounds(
    {
      x: work.x + placement.x * Math.max(0, work.width - width),
      y: work.y + placement.y * Math.max(0, work.height - height),
      width,
      height,
    },
    width,
    height
  )
}

export function placementFromBounds(bounds: Rectangle): {
  displayId: string
  x: number
  y: number
  zOrder: number
} {
  const display = screen.getDisplayNearestPoint(bounds)
  const work = display.workArea
  return {
    displayId: String(display.id),
    x: Math.max(0, Math.min(1, (bounds.x - work.x) / Math.max(1, work.width - bounds.width))),
    y: Math.max(0, Math.min(1, (bounds.y - work.y) / Math.max(1, work.height - bounds.height))),
    zOrder: 0,
  }
}
