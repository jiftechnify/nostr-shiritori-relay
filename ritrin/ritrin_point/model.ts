export type ShiritoriConnectedPost = {
  pubkey: string;
  eventId: string;
  head: string;
  last: string;
  acceptedAt: number;
};

export type LastShiritoriConnectionRecord = ShiritoriConnectedPost & {
  hibernationBreaking: boolean;
};

export type RitrinPointType =
  | "shiritori"
  | "daily"
  | "hibernation-breaking"
  | "nice-pass"
  | "special-connection";

export type RitrinPointTransaction = {
  type: RitrinPointType;
  amount: number;
  pubkey: string;
  eventId: string;
  grantedAt: number;
};

export type BonusPointType = Exclude<RitrinPointType, "shiritori">;
type BonusPointTransaction = RitrinPointTransaction & { type: BonusPointType };
export const isBonusPoint = (
  rtp: RitrinPointTransaction,
): rtp is BonusPointTransaction => rtp.type !== "shiritori";
