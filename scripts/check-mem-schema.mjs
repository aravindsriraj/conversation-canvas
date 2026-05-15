import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const memCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'canvas_memories' ORDER BY ordinal_position`
console.log('canvas_memories columns:')
for (const c of memCols) console.log(`  ${c.column_name} (${c.data_type})`)
const srcCol = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'canvas_actions' AND column_name = 'source'`
console.log(`\ncanvas_actions.source exists: ${srcCol.length === 1}`)
const counts = await sql`SELECT source, COUNT(*) FROM canvas_actions GROUP BY source`
console.log('canvas_actions by source:', counts.map(r => `${r.source}=${r.count}`).join(' '))
await sql.end()
