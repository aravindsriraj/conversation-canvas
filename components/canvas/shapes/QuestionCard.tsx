import { HelpCircle } from 'lucide-react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLBaseShape } from 'tldraw'

export type QuestionCardShape = TLBaseShape<
	'question-card',
	{
		w: number
		h: number
		content: string
		askerName: string
		askerColor: string
	}
>

export class QuestionCardUtil extends ShapeUtil<QuestionCardShape> {
	static override type = 'question-card' as const
	static override props = {
		w: T.number,
		h: T.number,
		content: T.string,
		askerName: T.string,
		askerColor: T.string,
	}

	override getDefaultProps(): QuestionCardShape['props'] {
		return { w: 280, h: 100, content: '', askerName: '', askerColor: '#71717a' }
	}

	override getGeometry(shape: QuestionCardShape) {
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

	override component(shape: QuestionCardShape) {
		const { w, h, content, askerName, askerColor } = shape.props
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div className="w-full h-full rounded-lg border border-amber-300 bg-amber-50 shadow-sm p-3 flex flex-col gap-2">
					<div className="flex items-center gap-2 text-xs">
						<HelpCircle size={14} className="text-amber-700" />
						<span
							className="px-2 py-0.5 rounded-full text-white text-[10px]"
							style={{ background: askerColor }}
						>
							{askerName}
						</span>
						<span className="text-amber-700 uppercase tracking-wider text-[10px] font-semibold">
							Question
						</span>
					</div>
					<div className="text-sm text-amber-950 leading-snug">{content}</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: QuestionCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
}
