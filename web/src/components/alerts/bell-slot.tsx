// The bell's place in the top bar. Nothing while PR watch is switched off on
// the server (`access.state` "unavailable"), or when the list can't be read.
import { alertList } from "@/lib/api";
import { AlertBell } from "./bell";

export async function BellSlot({ userId }: { userId: string }) {
  const r = await alertList(userId);
  if (!r.ok || r.data.access.state === "unavailable") return null;
  return <AlertBell initial={r.data} />;
}
