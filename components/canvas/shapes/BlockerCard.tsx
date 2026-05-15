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
				<div
					className="relative w-full h-full bg-paper text-ink flex flex-col"
					style={{
						borderRadius: 4,
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
					}}
				>
					{/* Crimson ink-bar — proof-mark red. */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-crimson"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<AlertTriangle size={12} className="text-crimson" />
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-crimson">
							Blocker
						</span>
					</div>
					<div className="px-4 py-3 text-[14px] leading-snug font-sans text-ink">
						{content}
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: BlockerCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={4} />
	}
}
