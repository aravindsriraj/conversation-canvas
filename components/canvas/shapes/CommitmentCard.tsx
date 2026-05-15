import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type CommitmentCardShape = TLBaseShape<
	'commitment-card',
	{
		w: number
		h: number
		action: string
		ownerName: string
		ownerColor: string
		deadline: string
	}
>

export class CommitmentCardUtil extends ShapeUtil<CommitmentCardShape> {
	static override type = 'commitment-card' as const
	static override props = {
		w: T.number,
		h: T.number,
		action: T.string,
		ownerName: T.string,
		ownerColor: T.string,
		deadline: T.string,
	}

	override getDefaultProps(): CommitmentCardShape['props'] {
		return {
			w: 280,
			h: 120,
			action: '',
			ownerName: '',
			ownerColor: '#71717a',
			deadline: '',
		}
	}

	override getGeometry(shape: CommitmentCardShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override canResize() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	override component(shape: CommitmentCardShape) {
		const { w, h, action, ownerName, ownerColor, deadline } = shape.props
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
					{/* Ochre ink-bar — illuminated-manuscript gold. */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-ochre"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Commitment
						</span>
						{ownerName && (
							<span className="ml-auto inline-flex items-center gap-1.5 text-[10px]">
								<span
									className="w-1.5 h-1.5 rounded-full"
									style={{ background: ownerColor }}
								/>
								<span className="font-sans tracking-tight text-ink">
									{ownerName}
								</span>
							</span>
						)}
					</div>
					<div className="px-4 py-3 text-[14px] leading-snug font-sans text-ink">
						{action}
					</div>
					{deadline && (
						<div className="px-4 pb-3 mt-auto text-[11px] font-mono text-faded-ink">
							by {deadline}
						</div>
					)}
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: CommitmentCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={4} />
	}
}
