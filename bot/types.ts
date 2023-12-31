import { EventPacket } from "rx-nostr";

export type NostrEvent = EventPacket["event"];
export type NostrEventUnsigned = Omit<NostrEvent, "sig" | "id" | "pubkey">;
export type NostrEventPre = Omit<NostrEventUnsigned, "created_at">;

export type EnvVars = {
  SRTRELAY_URL: string;
  PRIVATE_KEY: string;
  RESOURCE_DIR: string;
};

export type RelayUsage = {
  url: string;
  read: boolean;
  write: boolean;
};
export type AccountData = {
  profile: Record<string, string>;
  follows: string[];
  relays: RelayUsage[];
};
