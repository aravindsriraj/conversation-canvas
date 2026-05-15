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
		// Curated Scriptorium palette. Cycles past 5 splits — demo budgets
		// rarely exceed a handful of buckets.
		const colors = [
			'var(--color-ink)',
			'var(--color-crimson)',
			'var(--color-olive)',
			'var(--color-ochre)',
			'var(--color-faded-ink)',
		]
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
					{/* Ink bar: analytical, like the matrix. */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-ink"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Budget Allocator
						</span>
					</div>
					<div className="px-4 pt-3 pb-3 flex flex-col gap-2.5 flex-1">
						{/*
						 * Bar: 10px high so it reads at canvas-zoom distance. Hairline
						 * border traces the entire bar so partial fills don't look
						 * untethered against the paper.
						 */}
						<div
							className="flex h-2.5 overflow-hidden"
							style={{
								border: '1px solid var(--color-hairline)',
								borderRadius: 1,
							}}
						>
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
									{/* Filled square legend marker — printed-atlas feel. */}
									<div
										className="w-2 h-2"
										style={{ background: colors[i % colors.length] }}
									/>
									<div className="flex-1 truncate font-sans text-ink">
										{s.label}
									</div>
									<div className="font-mono w-16 text-right text-ink">
										{s.amountPct}
										{currency}
									</div>
								</div>
							))}
							<div className="border-t border-hairline mt-1 pt-1.5 flex items-center text-xs text-faded-ink">
								<div className="flex-1 font-display uppercase tracking-[0.12em] text-[10px]">
									Total
								</div>
								<div className="font-mono w-16 text-right">
									{sum}
									{currency}
								</div>
							</div>
						</div>
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: BudgetAllocatorShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={4} />
	}
}
