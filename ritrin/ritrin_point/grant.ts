import {
  LastShiritoriConnectionRecord,
  RitrinPointTransaction,
  ShiritoriConnectedPost,
} from "./model.ts";

export const lastShiritoriAcceptedAtPerAuthorKey = (
  author: string,
): Deno.KvKey => ["last_accepted_at", author];

export const lastShiritoriConnectionKey: Deno.KvKey = [
  "last_shiritori_connection",
];

/**
 * grants ritrin points to the shiritori-connected post, and update internal states
 */
export const grantRitrinPoints = async (
  kv: Deno.Kv,
  newScp: ShiritoriConnectedPost,
): Promise<RitrinPointTransaction[]> => {
  const myLastAcceptedAtKey = lastShiritoriAcceptedAtPerAuthorKey(
    newScp.pubkey,
  );

  let res = { ok: false };
  while (!res.ok) {
    const [myLastConnectedAt, prevConnRecord] = await kv.getMany<
      [number, LastShiritoriConnectionRecord]
    >([myLastAcceptedAtKey, lastShiritoriConnectionKey]);

    const grantedPoints = [
      ...grantShiritoriPoint(prevConnRecord.value, newScp),
      ...grantDailyPoint(myLastConnectedAt.value, newScp),
      ...grantHibernationBreakingPoint(prevConnRecord.value, newScp),
      ...grantNicePassPoint(prevConnRecord.value, newScp),
      ...grantSpecialConnectionPoint(prevConnRecord.value, newScp),
    ];
    const hibernationBreaking = grantedPoints.some((b) =>
      b.type === "hibernation-breaking"
    );

    const newConnRecord: LastShiritoriConnectionRecord = {
      ...newScp,
      hibernationBreaking,
    };
    res = await kv.atomic().check(myLastConnectedAt).check(prevConnRecord)
      .set(myLastAcceptedAtKey, newScp.acceptedAt)
      .set(
        lastShiritoriConnectionKey,
        newConnRecord,
      )
      .commit();
    return grantedPoints;
  }
  throw Error("grantRitrinPoints: unreachable");
};

/* basic shiritori point */
export const grantShiritoriPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
): RitrinPointTransaction[] => {
  if (prevSc !== null && prevSc.pubkey === newScp.pubkey) {
    // grant shiritori point only if new event's author is different than prev event's author
    return [];
  }
  return [{
    type: "shiritori",
    pubkey: newScp.pubkey,
    eventId: newScp.eventId,
    amount: 1,
    grantedAt: newScp.acceptedAt,
  }];
};

/* daily bonus point */
export const unixDayJst = (unixtimeSec: number) =>
  Math.floor((unixtimeSec + 9 * 3600) / (24 * 3600));

const dailyPointAmount = 3;

export const grantDailyPoint = (
  lastAcceptedAt: number | null,
  newScp: ShiritoriConnectedPost,
): RitrinPointTransaction[] => {
  if (
    lastAcceptedAt !== null &&
    unixDayJst(newScp.acceptedAt) === unixDayJst(lastAcceptedAt)
  ) {
    return [];
  }

  return [
    {
      type: "daily",
      pubkey: newScp.pubkey,
      eventId: newScp.eventId,
      amount: dailyPointAmount,
      grantedAt: newScp.acceptedAt,
    },
  ];
};

/* bonus point for hibernation-breaking post */
// threshold of considering inactivity as "hibernation": 2 hour
const hibernationMinIntervalSec = 2 * 60 * 60;
const hibernationBreakingPointMax = 15;
export const hibernationBreakingPointAmount = (
  intervalSec: number,
  minIntervalSec: number,
) => {
  if (intervalSec <= minIntervalSec) {
    return 0;
  }
  const intervalHr = intervalSec / 3600;
  const pt = (() => {
    if (intervalHr <= 12) {
      return intervalHr / 2;
    }
    if (intervalHr <= 20) {
      return (intervalHr - 12) * 5 / 8 + 6;
    }
    return intervalHr - 9;
  })();
  return Math.min(Math.floor(pt), hibernationBreakingPointMax);
};

export const grantHibernationBreakingPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
  minIntervalSec = hibernationMinIntervalSec,
): RitrinPointTransaction[] => {
  if (prevSc === null) {
    return [];
  }
  if (prevSc.pubkey === newScp.pubkey) {
    // grant hibernation-breaking point only if new event's author is different than prev event' author
    return [];
  }
  if (newScp.head === newScp.last) {
    // grant hibernation-breaking point only if the last kana changed
    return [];
  }

  const intervalSec = newScp.acceptedAt - prevSc.acceptedAt;
  const amount = hibernationBreakingPointAmount(intervalSec, minIntervalSec);
  if (amount <= 0) {
    return [];
  }
  return [{
    type: "hibernation-breaking",
    pubkey: newScp.pubkey,
    eventId: newScp.eventId,
    amount,
    grantedAt: newScp.acceptedAt,
  }];
};

/* bonus point for nice-pass post */
// threshold of "shortness" of consecutive shiritori connection span: 10 minutes
// in this case, preceding connection considered as "nice pass"
const nicePassMaxIntervalSec = 10 * 60;
const nicePassPointMaxAmount = 5;
const nicePassPointAmount = (intervalSec: number, maxIntervalSec: number) => {
  const effectiveIntervalSec = maxIntervalSec - intervalSec;
  return Math.ceil(
    nicePassPointMaxAmount * effectiveIntervalSec / maxIntervalSec,
  );
};

export const grantNicePassPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
  maxIntervalSec = nicePassMaxIntervalSec,
): RitrinPointTransaction[] => {
  if (prevSc === null) {
    return [];
  }
  if (prevSc.pubkey === newScp.pubkey) {
    // grant nice-pass point only if authors of previous event and new event are different
    return [];
  }
  if (!prevSc.hibernationBreaking) {
    // grant nice-pass point only if the previous connection is hibernation-breaking
    return [];
  }

  const intervalSec = newScp.acceptedAt - prevSc.acceptedAt;
  const amount = nicePassPointAmount(intervalSec, maxIntervalSec);
  if (amount <= 0) {
    return [];
  }
  return [{
    type: "nice-pass",
    pubkey: prevSc.pubkey,
    eventId: prevSc.eventId,
    amount,
    grantedAt: newScp.acceptedAt,
  }];
};

/* bonus point for special shiritori connection  */
const isSpecialConnection = (prevLast: string, newHead: string) =>
  [["ヴ", "ブ"], ["ヲ", "オ"], ["ヰ", "イ"], ["ヱ", "エ"]].some(([pl, nh]) =>
    pl === prevLast && nh === newHead
  );
const specialConnectionPointAmount = 10;

export const grantSpecialConnectionPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
): RitrinPointTransaction[] => {
  if (prevSc === null) {
    return [];
  }
  if (prevSc.pubkey === newScp.pubkey) {
    // grant special-connection point only if authors of previous event and new event are different
    return [];
  }
  if (!isSpecialConnection(prevSc.last, newScp.head)) {
    return [];
  }

  return [{
    type: "special-connection",
    pubkey: newScp.pubkey,
    eventId: newScp.eventId,
    amount: specialConnectionPointAmount,
    grantedAt: newScp.acceptedAt,
  }];
};
