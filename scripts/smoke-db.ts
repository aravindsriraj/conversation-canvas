/**
 * One-off DB smoke test. Run with:
 *   pnpm tsx scripts/smoke-db.ts
 *
 * Creates a throwaway user + canvas + action, lists them, then cleans up.
 * Not part of `pnpm test:run` — the vitest tests are pure-unit, no DB.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Minimal .env.local loader so we don't pull in dotenv as a dep for a one-off
// script. Format: KEY=value lines, # comments allowed.
function loadDotenv(filePath: string) {
	if (!existsSync(filePath)) return
	const contents = readFileSync(filePath, 'utf8')
	for (const line of contents.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq < 0) continue
		const key = trimmed.slice(0, eq).trim()
		let val = trimmed.slice(eq + 1).trim()
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1)
		}
		if (!(key in process.env)) process.env[key] = val
	}
}
loadDotenv(resolve(process.cwd(), '.env.local'))

const SUFFIX = Date.now().toString(36)
const clerkId = `smoke_user_${SUFFIX}`

async function main() {
	const { ensureUser, createCanvas, listCanvasesByOwner, getCanvasIfOwned, renameCanvas, deleteCanvas } =
		await import('../lib/db/canvases')
	const { appendAction, listActions } = await import('../lib/db/actions')
	const { sql } = await import('../lib/db/client')

	console.log('▶ ensureUser')
	const user = await ensureUser(clerkId, `Smoke ${SUFFIX}`, '#6366f1')
	console.log('  ', user.clerk_id, user.display_name)

	console.log('▶ createCanvas')
	const canvas = await createCanvas(clerkId, `Smoke canvas ${SUFFIX}`)
	console.log('  ', canvas.id, canvas.name)

	console.log('▶ listCanvasesByOwner')
	const all = await listCanvasesByOwner(clerkId)
	console.log('  count =', all.length)

	console.log('▶ getCanvasIfOwned (happy)')
	const owned = await getCanvasIfOwned(canvas.id, clerkId)
	if (!owned) throw new Error('expected owned')
	console.log('  ✓', owned.name)

	console.log('▶ getCanvasIfOwned (wrong owner)')
	const notOwned = await getCanvasIfOwned(canvas.id, 'someone_else')
	if (notOwned) throw new Error('expected null')
	console.log('  ✓ null')

	console.log('▶ appendAction × 3')
	const a1 = {
		type: 'create_proposal_card' as const,
		id: 'p1',
		proposerSpeakerId: 'S0',
		content: 'Test proposal',
		ts: Date.now(),
	}
	const s1 = await appendAction(canvas.id, a1)
	const s2 = await appendAction(canvas.id, { ...a1, id: 'p2' })
	const s3 = await appendAction(canvas.id, { ...a1, id: 'p3' })
	console.log('  seqs =', s1, s2, s3)
	if (s1 !== 1 || s2 !== 2 || s3 !== 3) throw new Error('seq monotonic broke')

	console.log('▶ listActions')
	const actions = await listActions(canvas.id)
	console.log('  count =', actions.length)
	if (actions.length !== 3) throw new Error('expected 3 actions')

	console.log('▶ renameCanvas')
	const renamed = await renameCanvas(canvas.id, clerkId, 'Renamed')
	if (!renamed || renamed.name !== 'Renamed') throw new Error('rename failed')
	console.log('  ✓', renamed.name)

	console.log('▶ deleteCanvas')
	const deleted = await deleteCanvas(canvas.id, clerkId)
	if (!deleted) throw new Error('delete failed')
	console.log('  ✓ canvas + cascaded actions removed')

	// Clean up the user too so reruns don't pile up rows.
	await sql`DELETE FROM users WHERE clerk_id = ${clerkId}`
	console.log('✅ all good')
	await sql.end()
}

main().catch((err) => {
	console.error('❌', err)
	process.exit(1)
})
