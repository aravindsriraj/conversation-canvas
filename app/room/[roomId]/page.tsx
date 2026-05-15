import { CanvasLoader } from './canvas-loader'

export default async function RoomPage({
	params,
}: {
	params: Promise<{ roomId: string }>
}) {
	const { roomId } = await params
	return <CanvasLoader roomId={roomId} />
}
