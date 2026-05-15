import { AlertTriangle } from 'lucide-react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type BlockerCardShape = TLBaseShape<
	'blocker-card',
	{ w: number; h: number; content: string }
>

export class BlockerCardUtil extends ShapeUtil<BlockerCardShape> {
	static override type = 'blocker-card' as const
	static override props = {
		w: T.number,
		h: T.number,
		content: T.string,
	}

	override getDefaultProps(): BlockerCardShape['props'] {
		return { w: 280, h: 100, content: '' }
	}

	override getGeometry(shape: BlockerCardShape) {
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

	override component(shape: BlockerCardShape) {
		const { w, h, content } = shape.props
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div className="w-full h-full rounded-lg border border-orange-400 bg-orange-50 shadow-sm p-3 flex flex-col gap-2">
					<div className="flex items-center gap-2 text-xs text-orange-800 font-semibold">
						<AlertTriangle size={14} />
						<span className="uppercase tracking-wider text-[10px]">Blocker</span>
					</div>
					<div className="text-sm text-orange-950 leading-snug">{content}</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: BlockerCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
