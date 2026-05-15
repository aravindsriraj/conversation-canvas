import type { Room } from '@server/room'
import type { Action } from '@/lib/actions/schema'

/**
 * Stub: real implementation lands in Task 2.6.
 * Returns an empty action list so the server tick path is fully wired
 * without producing canvas mutations yet.
 */
export async function runOrchestratorTick(_room: Room): Promise<Action[]> {
	return []
}
