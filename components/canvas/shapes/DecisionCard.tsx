import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type DecisionCardShape = TLBaseShape<
	'decision-card',
	{
		w: number
		h: number
		content: string
		ownerName: string
		ownerColor: string
		deadline: string
		locked: boolean
	}
>

export class DecisionCardUtil extends ShapeUtil<DecisionCardShape> {
	static override type = 'decision-card' as const
	static override props = {
		w: T.number,
		h: T.number,
		content: T.string,
		ownerName: T.string,
		ownerColor: T.string,
		deadline: T.string,
		locked: T.boolean,
	}

	override getDefaultProps(): DecisionCardShape['props'] {
		return {
			w: 320,
			h: 160,
			content: '',
			ownerName: '',
			ownerColor: '#71717a',
			deadline: '',
			locked: false,
		}
	}

	override getGeometry(shape: DecisionCardShape) {
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

	override component(shape: DecisionCardShape) {
		const { content, ownerName, ownerColor, deadline, locked, w, h } = shape.props
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div
					className={`w-full h-full rounded-lg border-2 ${locked ? 'border-emerald-500' : 'border-emerald-300'} bg-emerald-50 shadow p-3 flex flex-col gap-2`}
				>
					<div className="flex items-center gap-2 text-xs">
						<span className="text-emerald-700 uppercase tracking-wider text-[10px] font-semibold">
							{locked ? 'Decision · Locked' : 'Decision'}
						</span>
						{ownerName && (
							<span
								className="px-2 py-0.5 rounded-full text-white text-[10px]"
								style={{ background: ownerColor }}
							>
								{ownerName}
							</span>
						)}
					</div>
					<div className="text-sm text-emerald-950 leading-snug">{content}</div>
					{deadline && (
						<div className="text-xs text-emerald-700 mt-auto">by {deadline}</div>
					)}
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: DecisionCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
