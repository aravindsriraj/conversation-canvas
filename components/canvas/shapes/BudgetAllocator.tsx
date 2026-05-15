import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type BudgetAllocatorShape = TLBaseShape<
	'budget-allocator',
	{
		w: number
		h: number
		total: number
		currency: string
		splits: { label: string; amountPct: number; ownerSpeakerId?: string }[]
	}
>

export class BudgetAllocatorUtil extends ShapeUtil<BudgetAllocatorShape> {
	static override type = 'budget-allocator' as const
	static override props = {
		w: T.number,
		h: T.number,
		total: T.number,
		currency: T.string,
		splits: T.arrayOf(
			T.object({
				label: T.string,
				amountPct: T.number,
				ownerSpeakerId: T.optional(T.string),
			}),
		),
	}

	override getDefaultProps(): BudgetAllocatorShape['props'] {
		return { w: 380, h: 240, total: 100, currency: '%', splits: [] }
	}

	override getGeometry(shape: BudgetAllocatorShape) {
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

	override component(shape: BudgetAllocatorShape) {
		const { w, h, currency, splits } = shape.props
		const sum = splits.reduce((a, b) => a + b.amountPct, 0)
		// Fixed palette: cycles past 5 splits, which is fine — demo budgets
		// rarely exceed a handful of buckets.
		const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9']
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div className="w-full h-full rounded-lg border border-indigo-300 bg-white shadow p-3 flex flex-col gap-2">
					<div className="text-xs uppercase tracking-wider text-indigo-700 font-semibold">
						Budget Allocator
					</div>
					<div className="flex h-4 rounded overflow-hidden">
						{splits.map((s, i) => (
							<div
								key={`${s.label}-${i}`}
								title={`${s.label} ${s.amountPct}${currency}`}
								style={{
									width: `${s.amountPct}%`,
									background: colors[i % colors.length],
								}}
							/>
						))}
					</div>
					<div className="flex flex-col gap-1.5">
						{splits.map((s, i) => (
							<div
								key={`${s.label}-row-${i}`}
								className="flex items-center gap-2 text-xs"
							>
								<div
									className="w-2 h-2 rounded-full"
									style={{ background: colors[i % colors.length] }}
								/>
								<div className="flex-1 truncate">{s.label}</div>
								<div className="font-mono w-16 text-right">
									{s.amountPct}
									{currency}
								</div>
							</div>
						))}
						<div className="border-t mt-1 pt-1 flex items-center text-xs text-zinc-500">
							<div className="flex-1">Total</div>
							<div className="font-mono w-16 text-right">
								{sum}
								{currency}
							</div>
						</div>
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: BudgetAllocatorShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
