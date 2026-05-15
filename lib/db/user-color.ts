// Deterministic color assignment for new users — stable per Clerk userId so
// reruns of `ensureUser` don't shuffle the color. Palette is the editorial
// set used elsewhere in Scriptorium (olive/ochre/crimson/ink with mid
// chroma — not pure CSS-named colors).
const PALETTE = [
	'#2E5337', // olive
	'#B82626', // crimson
	'#C6862B', // ochre
	'#1A1815', // ink
	'#3B5C8A', // dim navy
	'#7A3E5E', // mulberry
	'#4F6B4B', // moss
]

export function pickColorForClerkId(clerkId: string): string {
	let h = 0
	for (let i = 0; i < clerkId.length; i++) {
		h = (h * 31 + clerkId.charCodeAt(i)) | 0
	}
	return PALETTE[Math.abs(h) % PALETTE.length]
}
