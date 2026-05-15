import postgres from 'postgres'
import { readFileSync } from 'node:fs'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set')
const sql = postgres(url, { max: 1 })
const ddl = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
console.log('Applying schema.sql (', ddl.length, 'bytes)…')
await sql.unsafe(ddl)
console.log('OK — schema applied')
await sql.end()
