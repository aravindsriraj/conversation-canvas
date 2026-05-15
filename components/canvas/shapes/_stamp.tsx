/**
 * Shared rubber-stamp seal for cards that have entered "settled" state
 * (Decision locked, Proposal decided, etc.).
 *
 * CSS-only — double-border via outer `border` + inset paper hairline `boxShadow`
 * gives the hand-pressed impression without an SVG/PNG asset.
 *
 * Pointer-events are disabled so the stamp never intercepts tldraw selection.
 */
export function Stamp({
	label,
	tone,
	rotate = -8,
}: {
	label: string
	tone: 'olive' | 'crimson' | 'ochre'
	rotate?: number
}) {
	const colorVar = `var(--color-${tone})`
	return (
		<div
			className="absolute top-2 right-3 pointer-events-none select-none"
			style={{ transform: `rotate(${rotate}deg)` }}
		>
			<div
				className="font-display tracking-[0.2em] text-[10px] uppercase px-2 py-1"
				style={{
					color: colorVar,
					border: `2px solid ${colorVar}`,
					borderRadius: 2,
					background: 'rgba(247,243,236,0.78)',
					// Inset paper hairline = the hollow inside the stamp outline.
					boxShadow: 'inset 0 0 0 1px var(--color-paper)',
				}}
			>
				{label}
			</div>
		</div>
	)
}
