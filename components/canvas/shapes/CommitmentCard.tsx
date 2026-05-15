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
				<div className="w-full h-full rounded-lg border border-sky-300 bg-sky-50 shadow-sm p-3 flex flex-col gap-2">
					<div className="flex items-center gap-2 text-xs">
						<span
							className="px-2 py-0.5 rounded-full text-white text-[10px] font-medium"
							style={{ background: ownerColor }}
						>
							{ownerName}
						</span>
						<span className="text-sky-700 uppercase tracking-wider text-[10px] font-semibold">
							Commitment
						</span>
					</div>
					<div className="text-sm text-sky-950 leading-snug">{action}</div>
					{deadline && (
						<div className="text-xs text-sky-700 mt-auto">by {deadline}</div>
					)}
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: CommitmentCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
