import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { attachWsServer } from './ws'
import { RoomRegistry, type Room } from './room'
import { runOrchestratorTick } from '@/lib/orchestrator/loop'

const port = Number(process.env.PORT || 3000)
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev })
const handle = app.getRequestHandler()

async function onTick(room: Room) {
	try {
		const actions = await runOrchestratorTick(room)
		for (const a of actions) {
			room.recordAction(a)
		}
		if (actions.length) {
			room.broadcast({ kind: 'actions', actions })
		}
	} catch (err) {
		console.error('[orchestrator] tick failed', err)
	}
}

app.prepare().then(() => {
	const server = createServer((req, res) => {
		const parsed = parse(req.url ?? '/', true)
		handle(req, res, parsed)
	})
	const registry = new RoomRegistry(onTick)
	attachWsServer(server, registry)
	server.listen(port, () => {
		console.log(`> Conversation Canvas on http://localhost:${port}`)
	})
})
