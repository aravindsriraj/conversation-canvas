import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type PriorityMatrixShape = TLBaseShape<
	'priority-matrix',
	{
		w: number
		h: number
		items: { id: string; label: string; impact: number; effort: number }[]
	}
>

export class PriorityMatrixUtil extends ShapeUtil<PriorityMatrixShape> {
	static override type = 'priority-matrix' as const
	static override props = {
		w: T.number,
		h: T.number,
		items: T.arrayOf(
			T.object({
				id: T.string,
				label: T.string,
				impact: T.number,
				effort: T.number,
			}),
		),
	}

	override getDefaultProps(): PriorityMatrixShape['props'] {
		return { w: 420, h: 380, items: [] }
	}

	override getGeometry(shape: PriorityMatrixShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override canResize() {
		return true
	}

	override hideRotateHandle() {
		return true
	}

	override component(shape: PriorityMatrixShape) {
		const { w, h, items } = shape.props
		// The dot grid lives in the inner plot, but x/y below are computed in
		// container-local pixels (so we add `padding` back in). Coordinates are
		// then clamped softly via the layout — items with impact/effort outside
		// [0,1] simply render near the edges, which is acceptable for L3 demo.
		const padding = 40
		const plotW = w - padding * 2
		const plotH = h - padding * 2
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div
					className="relative w-full h-full bg-paper text-ink flex flex-col"
					style={{
						borderRadius: 4,
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
					}}
				>
					{/* Ink bar: analytical, not editorial. */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-ink"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Priority Matrix
						</span>
					</div>
					<div className="relative flex-1 mx-3 mb-3 mt-1">
						{/* Quadrant grid — hairline rules on warm paper. */}
						<div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
							<div className="border-r border-b border-hairline" />
							<div className="border-b border-hairline" />
							<div className="border-r border-hairline" />
							<div />
						</div>
						{/* Quadrant labels — small caps, faded ink. */}
						<div className="absolute top-1 left-1 text-[9px] uppercase tracking-[0.12em] text-faded-ink font-sans">
							Low impact · Low effort
						</div>
						<div className="absolute top-1 right-1 text-[9px] uppercase tracking-[0.12em] text-faded-ink font-sans">
							High impact · Low effort
						</div>
						<div className="absolute bottom-1 left-1 text-[9px] uppercase tracking-[0.12em] text-faded-ink font-sans">
							Low impact · High effort
						</div>
						<div className="absolute bottom-1 right-1 text-[9px] uppercase tracking-[0.12em] text-faded-ink font-sans">
							High impact · High effort
						</div>
						{/*
						 * Items: plotted with impact on X (higher = right) and effort on
						 * Y (higher effort = lower on the plot, so we invert). Crimson
						 * fill pops on warm paper like a proof-mark in a galley.
						 */}
						{items.map((it) => {
							const x = it.impact * plotW - 5
							const y = (1 - it.effort) * plotH - 5
							return (
								<div
									key={it.id}
									className="absolute w-2.5 h-2.5 rounded-full bg-crimson"
									style={{
										left: x,
										top: y,
										boxShadow: '0 0 0 2px var(--color-paper)',
									}}
									title={it.label}
								>
									<span
										className="absolute top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-sans text-ink whitespace-nowrap"
										style={{ pointerEvents: 'none' }}
									>
										{it.label}
									</span>
								</div>
							)
						})}
					</div>
					{/* Axis labels — display face, small caps. */}
					<div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-[0.18em] text-faded-ink font-display">
						Impact →
					</div>
					<div
						className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.18em] text-faded-ink font-display"
						style={{ transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'left center' }}
					>
						Effort →
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: PriorityMatrixShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={4} />
	}
}
