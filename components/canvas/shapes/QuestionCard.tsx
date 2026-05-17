import { HelpCircle } from 'lucide-react'
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	type TLIndicatorPath,
	type TLShape,
} from 'tldraw'

// v5 module augmentation pattern — registers our custom shape's props on
// the global TLShape map so `editor.createShape({ type: 'question-card', ... })`
// type-checks without us re-declaring TLBaseShape everywhere.
declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		'question-card': {
			w: number
			h: number
			content: string
			askerName: string
			askerColor: string
		}
	}
}

export type QuestionCardShape = TLShape<'question-card'>

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
				<div
					className="relative w-full h-full bg-paper text-ink flex flex-col"
					style={{
						borderRadius: 4,
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
					}}
				>
					{/*
					 * Ochre at 60% — desaturated so the question reads as "open thread"
					 * rather than "active blocker". The crimson on Blocker stays loud.
					 */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1"
						style={{
							background: 'var(--color-ochre)',
							opacity: 0.6,
							borderTopLeftRadius: 4,
							borderBottomLeftRadius: 4,
						}}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<HelpCircle size={12} className="text-ochre" />
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Question
						</span>
						{askerName && (
							<span className="ml-auto inline-flex items-center gap-1.5 text-[10px]">
								<span
									className="w-1.5 h-1.5 rounded-full"
									style={{ background: askerColor }}
								/>
								<span className="font-sans tracking-tight text-ink">
									{askerName}
								</span>
							</span>
						)}
					</div>
					<div className="px-4 py-3 text-[14px] leading-snug font-sans text-ink">
						{content}
					</div>
				</div>
			</HTMLContainer>
		)
	}

	// v5 canvas-overlay indicator. Returns a Path2D that tldraw composites
	// onto the overlay layer (much faster than rendering JSX per shape).
	// We opt out of legacy SVG indicators since all our shape selection
	// outlines are simple rounded rects.
	override getIndicatorPath(shape: QuestionCardShape): TLIndicatorPath {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 4)
		return { path }
	}
}
