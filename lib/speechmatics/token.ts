// Server-only module. Must never be imported from client components — it
// reads `SPEECHMATICS_API_KEY` from `process.env`, which is undefined in the
// browser. Routes that consume this helper run on the Node.js runtime.

const SPEECHMATICS_AUTH_URL = 'https://mp.speechmatics.com/v1/api_keys?type=rt'

/**
 * Mint a short-lived Speechmatics Realtime API JWT.
 *
 * Server-only. The long-lived `SPEECHMATICS_API_KEY` must never reach the
 * browser; this helper exchanges it for a temporary `key_value` JWT that the
 * client can use to open a direct WebSocket to Speechmatics.
 *
 * @param ttlSeconds Lifetime of the minted token (60..86400). Shorter is safer.
 * @returns The temporary JWT string (`key_value`).
 * @throws If `SPEECHMATICS_API_KEY` is missing or the mint request fails.
 *         Error messages are intentionally generic; the route handler logs
 *         server-side and returns a non-revealing response to the client.
 */
export async function mintSpeechmaticsToken(ttlSeconds = 60): Promise<string> {
	const apiKey = process.env.SPEECHMATICS_API_KEY
	if (!apiKey) throw new Error('SPEECHMATICS_API_KEY not set')

	const res = await fetch(SPEECHMATICS_AUTH_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ ttl: ttlSeconds }),
		cache: 'no-store',
	})

	if (!res.ok) {
		// Do NOT include response body in the thrown message — it could echo
		// upstream details we don't want surfaced. Log status only.
		throw new Error(`Speechmatics token mint failed with status ${res.status}`)
	}

	const data = (await res.json()) as { key_value?: string }
	if (!data.key_value || typeof data.key_value !== 'string') {
		throw new Error('Speechmatics token mint returned malformed payload')
	}
	return data.key_value
}
