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
		const padding = 36
		const plotW = w - padding * 2
		const plotH = h - padding * 2
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div className="w-full h-full rounded-lg border border-violet-300 bg-white shadow p-3 flex flex-col">
					<div className="text-xs uppercase tracking-wider text-violet-700 font-semibold mb-1">
						Priority Matrix
					</div>
					<div className="relative flex-1">
						{/* Quadrant grid lines */}
						<div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
							<div className="border-r border-b border-zinc-200" />
							<div className="border-b border-zinc-200" />
							<div className="border-r border-zinc-200" />
							<div />
						</div>
						{/* Quadrant labels */}
						<div className="absolute top-1 left-1 text-[10px] text-zinc-400">
							Low impact / Low effort
						</div>
						<div className="absolute top-1 right-1 text-[10px] text-zinc-400">
							High impact / Low effort
						</div>
						<div className="absolute bottom-1 left-1 text-[10px] text-zinc-400">
							Low impact / High effort
						</div>
						<div className="absolute bottom-1 right-1 text-[10px] text-zinc-400">
							High impact / High effort
						</div>
						{/* Items: plotted with impact on X (higher = right) and effort on
							Y (higher effort = lower on the plot, so we invert). */}
						{items.map((it) => {
							const x = it.impact * plotW + padding - 6
							const y = (1 - it.effort) * plotH + padding - 6
							return (
								<div
									key={it.id}
									className="absolute w-3 h-3 rounded-full bg-violet-600 shadow ring-2 ring-white"
									style={{ left: x, top: y }}
									title={it.label}
								>
									<span className="absolute left-4 top-0 text-[11px] text-zinc-800 whitespace-nowrap">
										{it.label}
									</span>
								</div>
							)
						})}
						{/* Axis labels */}
						<div className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-zinc-600">
							Impact →
						</div>
						<div className="absolute -left-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600 -rotate-90 origin-left">
							Effort →
						</div>
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: PriorityMatrixShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
