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
		'proposal-card': {
			w: number
			h: number
			content: string
			proposerName: string
			proposerColor: string
			status: 'open' | 'superseded' | 'decided'
			ts: number
		}
	}
}

export type ProposalCardShape = TLShape<'proposal-card'>

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
		const { w, h, content, proposerName, proposerColor, status } = shape.props
		// A proposal that has been folded into a decision visually recedes —
		// reduced contrast lets the eye land on live material first.
		const decided = status === 'decided'
		const superseded = status === 'superseded'
		const opacity = decided ? 0.65 : superseded ? 0.5 : 1
		return (
			<HTMLContainer
				style={{
					width: w,
					height: h,
					pointerEvents: 'all',
					opacity,
				}}
			>
				<div
					className="relative w-full h-full bg-paper text-ink flex flex-col"
					style={{
						borderRadius: 4,
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
					}}
				>
					{/* Ink-bar: near-black for proposals (draft material). */}
					<div
						className="absolute left-0 top-0 bottom-0 w-1 bg-ink"
						style={{ borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
					/>
					<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
						<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Proposal
						</span>
						<span className="ml-auto inline-flex items-center gap-1.5 text-[10px]">
							<span
								className="w-1.5 h-1.5 rounded-full"
								style={{ background: proposerColor }}
							/>
							<span className="font-sans tracking-tight text-ink">
								{proposerName}
							</span>
						</span>
					</div>
					<div className="px-4 py-3 text-[14px] leading-snug font-sans text-ink">
						{content}
					</div>
					{decided && <Stamp label="Decided" tone="crimson" />}
				</div>
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: ProposalCardShape): TLIndicatorPath {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 4)
		return { path }
	}
}
