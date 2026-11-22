import { WarRoomClient } from "@/components/war-room/war-room-client";

export default async function WarRoomPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  return <WarRoomClient incidentId={decodeURIComponent(id)} />;
}