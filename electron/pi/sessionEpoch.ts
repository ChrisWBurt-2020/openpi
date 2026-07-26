/**
 * sessionEpoch.ts — discard session events from a thread the user left.
 *
 * The sidecar runs exactly one Pi session. Creating a new thread, or opening a
 * different chat, disposes the current session and builds another. Session
 * events carry no session identity, so an event still in flight when that
 * happens is delivered against whatever session is open when it arrives: the
 * new thread inherits the old thread's tail, and anything keyed to the old
 * session's state errors.
 *
 * The sidecar stamps session traffic with an epoch counting replacements.
 * Main tracks the newest epoch it has seen and drops anything older.
 *
 * Deliberately tolerant of a missing epoch: an un-stamped message is treated
 * as current rather than dropped. Silently swallowing real events because a
 * future emitter forgot the stamp would be a far worse failure than the leak
 * this prevents.
 */

export class SessionEpochGate {
  private latest = 0

  /** Record the epoch of a session_ready. Returns false if it is superseded. */
  observeReady(epoch: number | undefined): boolean {
    if (epoch === undefined) return true
    if (epoch < this.latest) return false
    this.latest = epoch
    return true
  }

  /** True when an event belongs to the session currently in front of the user. */
  accepts(epoch: number | undefined): boolean {
    if (epoch === undefined) return true
    return epoch >= this.latest
  }

  current(): number {
    return this.latest
  }

  /** Test seam / reset on sidecar restart, where the counter starts over. */
  reset(): void {
    this.latest = 0
  }
}
