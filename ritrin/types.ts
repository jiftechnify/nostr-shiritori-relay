import { EventPacket } from "rx-nostr";

export type NostrEvent = EventPacket["event"];
export type NostrEventUnsigned = Omit<
  NostrEvent,
  "sig" | "id" | "pubkey" | "ots"
>;
export type NostrEventPre = Omit<NostrEventUnsigned, "created_at">;

export type RelayUsage = {
  url: string;
  read: boolean;
  write: boolean;
};
export type AccountData = {
  profile: Record<string, unknown>;
  follows: string[];
  relays: RelayUsage[];
};
