import { RoomShell } from './RoomShell'

export default async function RoomPage({
	params,
}: {
	params: Promise<{ roomId: string }>
}) {
	const { roomId } = await params
	return <RoomShell roomId={roomId} />
}
