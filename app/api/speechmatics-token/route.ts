import { NextResponse } from 'next/server'
import { mintSpeechmaticsToken } from '@/lib/speechmatics/token'

// Tokens must be freshly minted on every request — never cache the response.
export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const token = await mintSpeechmaticsToken(60)
		return NextResponse.json({ token })
	} catch (err) {
		// Log full detail server-side; return a generic message to the client
		// so we never leak upstream provider errors or stack traces.
		console.error('[speechmatics-token] mint failed:', err)
		return NextResponse.json({ error: 'token mint failed' }, { status: 500 })
	}
}
