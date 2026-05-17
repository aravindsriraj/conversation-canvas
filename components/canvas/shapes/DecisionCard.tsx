import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	type TLIndicatorPath,
	type TLShape,
} from 'tldraw'
import { Stamp } from './_stamp'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		'decision-card': {
			w: number
			h: number
			content: string
			ownerName: string
			ownerColor: string
			deadline: string
			locked: boolean
		}
	}
}

export type DecisionCardShape = TLShape<'decision-card'>

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
		const { content, ownerName, ownerColor, deadline, locked, w, h } =
			shape.props
		// Locked decisions are the boldest type on the canvas — the entire frame
		// echoes the rubber-stamp: doubled olive border + a faint olive wash.
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div
					className="relative w-full h-full bg-paper text-ink flex flex-col"
					style={{
						borderRadius: 4,
						border: locked ? '2px solid var(--color-olive)' : 'none',
						background: locked
							? 'linear-gradient(135deg, rgba(46,83,55,0.04) 0%, rgba(46,83,55,0.0) 60%), var(--color-paper)'
							: 'var(--color-paper)',
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
					}}
				>
					{/* Olive ink-bar — official-stamp green. */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-olive"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-olive">
							{locked ? 'Decision · Locked' : 'Decision'}
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
					<div
						className={`px-4 py-3 text-[14px] leading-snug font-sans text-ink ${locked ? 'font-medium' : ''}`}
					>
						{content}
					</div>
					{deadline && (
						<div className="px-4 pb-3 mt-auto text-[11px] font-mono text-faded-ink">
							by {deadline}
						</div>
					)}
					{locked && <Stamp label="Locked" tone="olive" rotate={6} />}
				</div>
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: DecisionCardShape): TLIndicatorPath {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 4)
		return { path }
	}
}
