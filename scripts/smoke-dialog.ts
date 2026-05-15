/**
 * WebSocket smoke test for the orchestrator: enroll two speakers, send three
 * scripted transcript segments (including a "decision + commitment in same
 * utterance" line), wait for orchestrator tick(s), and print the actions.
 *
 * Usage: pnpm tsx scripts/smoke-dialog.ts [ws://localhost:3000/ws] [roomId]
 *
 * The server must already be running (pnpm dev).
 */
import WebSocket from 'ws'

const url = process.argv[2] ?? 'ws://localhost:3000/ws'
const roomId = process.argv[3] ?? `smoke-${Date.now()}`
const WAIT_MS = 25_000

interface ActionMsg {
	kind: string
	actions?: unknown[]
}

async function main() {
	console.log(`[smoke] connecting to ${url}, room=${roomId}`)
	const ws = new WebSocket(url)
	const actions: unknown[] = []

	await new Promise<void>((resolve, reject) => {
		ws.once('open', () => resolve())
		ws.once('error', reject)
	})
	console.log('[smoke] connected')

	ws.on('message', (raw) => {
		try {
			const msg: ActionMsg = JSON.parse(raw.toString())
			if (msg.kind === 'history' && Array.isArray(msg.actions)) {
				console.log(`[smoke] history replay: ${msg.actions.length} prior actions`)
			} else if (msg.kind === 'actions' && Array.isArray(msg.actions)) {
				console.log(`[smoke] received ${msg.actions.length} new actions`)
				for (const a of msg.actions) actions.push(a)
			} else if (msg.kind === 'speakers') {
				// quiet
			}
		} catch {}
	})

	const send = (obj: unknown) => ws.send(JSON.stringify(obj))

	send({ kind: 'join', roomId })
	send({
		kind: 'enroll',
		roomId,
		payload: { speakerId: 'S0', displayName: 'Alice', color: '#6366f1' },
	})
	send({
		kind: 'enroll',
		roomId,
		payload: { speakerId: 'S1', displayName: 'Bob', color: '#f43f5e' },
	})

	// Send all three transcripts with tight spacing so the buffer's 3s
	// debounce only fires ONCE — the orchestrator sees all three together,
	// which is what the live demo actually looks like.
	const transcripts: Array<{ speaker: string; text: string }> = [
		{
			speaker: 'S0',
			text: 'I think we should target enterprise customers in Q3 focus on top 100 accounts',
		},
		{
			speaker: 'S1',
			text: "I'd actually double down on SMB conversion rates are 3x higher",
		},
		{
			speaker: 'S1',
			text: 'OK agreed lets go with 60/30/10 enterprise/SMB/retention and Alice owns enterprise outreach by next Friday',
		},
	]

	let tsBase = Date.now()
	for (const t of transcripts) {
		send({
			kind: 'transcript',
			roomId,
			payload: {
				speaker: t.speaker,
				text: t.text,
				isFinal: true,
				ts: tsBase,
			},
		})
		console.log(`[smoke] sent [${t.speaker}] ${t.text.slice(0, 60)}…`)
		tsBase += 1000
		await sleep(250)
	}

	console.log(`[smoke] waiting ${WAIT_MS / 1000}s for orchestrator…`)
	await sleep(WAIT_MS)

	console.log('\n=== ACTIONS RECEIVED ===')
	console.log(JSON.stringify(actions, null, 2))
	console.log('\n=== SUMMARY ===')
	const types = (actions as Array<{ type: string }>)
		.map((a) => a.type)
		.reduce<Record<string, number>>((m, t) => {
			m[t] = (m[t] ?? 0) + 1
			return m
		}, {})
	console.log(types)
	const hasDecision = (actions as Array<{ type: string }>).some(
		(a) => a.type === 'create_decision_card',
	)
	const hasCommitment = (actions as Array<{ type: string }>).some(
		(a) => a.type === 'create_commitment_card',
	)
	console.log(`decision: ${hasDecision} | commitment: ${hasCommitment}`)
	console.log(hasDecision && hasCommitment ? '[smoke] PASS' : '[smoke] FAIL')

	ws.close()
	process.exit(0)
}

function sleep(ms: number) {
	if (ms <= 0) return Promise.resolve()
	return new Promise((r) => setTimeout(r, ms))
}

main().catch((e) => {
	console.error('[smoke] error', e)
	process.exit(1)
})
