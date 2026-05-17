import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { buildWsServer, makeUpgradeRouter } from './ws'
import { RoomRegistry, type Room } from './room'
import { setRegistry } from './registry-singleton'
import { runOrchestratorTick } from '@/lib/orchestrator/loop'

const port = Number(process.env.PORT || 3000)
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev })
const handle = app.getRequestHandler()

async function onTick(room: Room) {
	// Per-room mutex: skip overlapping ticks. The voice MODE-B ReAct path
	// can run 8-12s, longer than the 3s debounce. If a second tick fires
	// while the first is still in flight, we drop it — the next debounce
	// will refire with a fresher transcript window. Queueing a stale tick
	// just doubles the broadcast load with worse data.
	if (room.orchestratorBusy) {
		console.log(`[orchestrator] tick skipped (busy)`)
		return
	}
	const work = (async () => {
		try {
			const actions = await runOrchestratorTick(room)
			// Voice MODE-B path records + broadcasts inline via its emit tool
			// and returns []. Voice MODE-A (single-shot generateObject) and
			// every legacy path returns the action batch here for us to
			// record + broadcast. Same loop handles both.
			for (const a of actions) {
				room.recordAction(a)
			}
			if (actions.length) {
				room.broadcast({ kind: 'actions', actions })
			}
		} catch (err) {
			console.error('[orchestrator] tick failed', err)
		}
	})()
	room.orchestratorBusy = work
	try {
		await work
	} finally {
		room.orchestratorBusy = null
	}
}

app.prepare().then(() => {
	// `getUpgradeHandler` must be called AFTER `prepare()` — Next throws otherwise.
	// In dev, this is what carries HMR / Turbopack browser-side websockets.
	const upgradeToNext = app.getUpgradeHandler()

	const server = createServer((req, res) => {
		const parsed = parse(req.url ?? '/', true)
		handle(req, res, parsed)
	})

	const registry = new RoomRegistry(onTick)
	// Expose the registry to Next.js HTTP route handlers (specifically
	// /api/agent) running in this same Node process. See
	// server/registry-singleton.ts for the rationale.
	setRegistry(registry)
	const wss = buildWsServer(registry)
	server.on('upgrade', makeUpgradeRouter(wss, upgradeToNext))

	server.listen(port, () => {
		console.log(`> Conversation Canvas on http://localhost:${port}`)
	})
})
