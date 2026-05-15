import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type ProposalCardShape = TLBaseShape<
	'proposal-card',
	{
		w: number
		h: number
		content: string
		proposerName: string
		proposerColor: string
		status: 'open' | 'superseded' | 'decided'
		ts: number
	}
>

export class ProposalCardUtil extends ShapeUtil<ProposalCardShape> {
	static override type = 'proposal-card' as const
	static override props = {
		w: T.number,
		h: T.number,
		content: T.string,
		proposerName: T.string,
		proposerColor: T.string,
		status: T.literalEnum('open', 'superseded', 'decided'),
		ts: T.number,
	}

	override getDefaultProps(): ProposalCardShape['props'] {
		return {
			w: 280,
			h: 140,
			content: '',
			proposerName: '?',
			proposerColor: '#71717a',
			status: 'open',
			ts: Date.now(),
		}
	}

	override getGeometry(shape: ProposalCardShape) {
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

	override component(shape: ProposalCardShape) {
		const { content, proposerName, proposerColor, status } = shape.props
		const opacity = status === 'superseded' ? 0.5 : 1
		return (
			<HTMLContainer
				style={{
					width: shape.props.w,
					height: shape.props.h,
					pointerEvents: 'all',
					opacity,
				}}
			>
				<div className="w-full h-full rounded-lg border border-zinc-300 bg-white shadow-sm p-3 flex flex-col gap-2">
					<div className="flex items-center gap-2 text-xs">
						<span
							className="px-2 py-0.5 rounded-full text-white text-[10px] font-medium"
							style={{ background: proposerColor }}
						>
							{proposerName}
						</span>
						<span className="text-zinc-500 uppercase tracking-wider text-[10px]">
							Proposal
						</span>
						{status === 'decided' && (
							<span className="text-emerald-700 text-[10px] font-semibold">
								DECIDED
							</span>
						)}
					</div>
					<div className="text-sm text-zinc-900 leading-snug">{content}</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: ProposalCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
