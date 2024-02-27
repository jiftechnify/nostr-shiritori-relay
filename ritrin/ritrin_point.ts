import * as log from "std/log";
import * as path from "std/path";
import { currUnixtime, publishToRelays } from "./common.ts";
import { AppContext } from "./context.ts";
import { ulid } from "ulid";

type ShiritoriConnectedPost = {
  pubkey: string;
  eventId: string;
  head: string;
  last: string;
  acceptedAt: number;
};

type LastShiritoriConnectionRecord = ShiritoriConnectedPost & {
  hibernationBreaking: boolean;
};

type RitrinPointType =
  | "shiritori"
  | "daily"
  | "hibernation-breaking"
  | "nice-pass"
  | "special-connection";

type RitrinPointTransaction = {
  type: RitrinPointType;
  amount: number;
  pubkey: string;
  eventId: string;
  grantedAt: number;
};

type ExtraPointType = Exclude<RitrinPointType, "shiritori">;

const reactionContentForExtraPointType: Record<ExtraPointType, string> = {
  daily: "🎁",
  "hibernation-breaking": "‼️",
  "nice-pass": "🙌",
  "special-connection": "🫰",
};

export const launchShiritoriConnectionHook = (
  appCtx: AppContext,
) => {
  const serve = async () => {
    const sockPath = path.join(
      appCtx.env.RESOURCE_DIR,
      "shiritori_connection_hook.sock",
    );
    try {
      Deno.removeSync(sockPath);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(`failed to remove unix socket: ${err}`);
        Deno.exit(1);
      }
    }

    const listener = Deno.listen({ transport: "unix", path: sockPath });
    while (true) {
      const conn = await listener.accept();
      const buf = new Uint8Array(1024);
      const n = await conn.read(buf);

      const reqTxt = new TextDecoder().decode(
        n === null ? buf : buf.slice(0, n),
      );
      const scp = JSON.parse(reqTxt) as ShiritoriConnectedPost;

      if (n === null) {
        log.error("failed to read from connection");
        conn.close();
        continue;
      }

      log.info(
        `received shiritori connected post: ${JSON.stringify(scp)}`,
      );

      try {
        await handleShiritoriConnection(
          scp,
          appCtx,
        );
      } catch (err) {
        log.error(
          `error while handling shiritori connected post connection: ${err}`,
        );
      }

      conn.close();
    }
  };

  log.info("launching shiritori connection hook...");
  serve().catch((err) => {
    log.error(`error while launching shiritori connection hook: ${err}`);
    Deno.exit(1);
  });
};

const shiritoriReactionContent = (
  newScp: ShiritoriConnectedPost,
): string => {
  if (newScp.last === "ン") {
    return "🤔";
  }
  if (newScp.head === "ン") {
    return "🥳";
  }
  // white: last kana not changed, red: last kana changed
  return newScp.head === newScp.last ? "❕" : "❗";
};

export const handleShiritoriConnection = async (
  newScp: ShiritoriConnectedPost,
  { env, writeRelayUrls, ritrinPointKv }: AppContext,
) => {
  const rtps = await grantRitrinPoints(
    ritrinPointKv,
    newScp,
  );
  await saveRitrinPointTxs(ritrinPointKv, rtps);

  const reactions = rtps.filter((rtp) => rtp.type !== "shiritori").map(
    ({ type, eventId, pubkey }) => {
      return {
        kind: 7,
        content: reactionContentForExtraPointType[type as ExtraPointType],
        tags: [
          ["e", eventId, ""],
          ["p", pubkey, ""],
        ],
        created_at: currUnixtime(),
      };
    },
  );
  // if no extra points granted, send default shiritori reaction
  if (reactions.length === 0) {
    reactions.push({
      kind: 7,
      content: shiritoriReactionContent(newScp),
      tags: [
        ["e", newScp.eventId, ""],
        ["p", newScp.pubkey, ""],
      ],
      created_at: currUnixtime(),
    });
  }

  // send reactions to accepted / nice-pass posts
  await Promise.all(
    reactions.map((k7) =>
      publishToRelays(writeRelayUrls, k7, env.RITRIN_PRIVATE_KEY)
    ),
  );
};

const lastShiritoriAcceptedAtPerAuthorKey = (
  author: string,
): Deno.KvKey => ["last_accepted_at", author];

const lastShiritoriConnectionKey: Deno.KvKey = ["last_shiritori_connection"];

const grantRitrinPoints = async (
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

const grantShiritoriPoint = (
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

export const unixDayJst = (unixtimeSec: number) =>
  Math.floor((unixtimeSec + 9 * 3600) / (24 * 3600));

const dailyPointAmount = 10;
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

// threshold of considering inactivity as "hibernation": 1 hour
const hibernationMinIntervalSec = 1 * 60 * 60;
const hibernationBreakingPointMax = 10;
const hibernationBreakingPointAmount = (
  intervalSec: number,
  minIntervalSec: number,
) => {
  const effectiveIntervalHr = (intervalSec - minIntervalSec) / 3600;
  if (effectiveIntervalHr <= 0) {
    return 0;
  }
  const base = Math.floor(Math.pow(effectiveIntervalHr, 0.25) * 6);
  return Math.min(Math.max(base, 1), hibernationBreakingPointMax);
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

// threshold of "shortness" of consecutive shiritori connection span: 5 minutes
// in this case, preceding connection considered as "nice pass"
const nicePassMaxIntervalSec = 5 * 60;
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

const isSpecialConnection = (prevLast: string, newHead: string) =>
  [["ヴ", "ブ"], ["ヲ", "オ"], ["ヰ", "イ"], ["ヱ", "エ"]].some(([pl, nh]) =>
    pl === prevLast && nh === newHead
  );
const specialConnectionPointAmount = 5;

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

const ulidFromUnixtimeSec = (unixtimeSec: number) => ulid(unixtimeSec * 1000);

const ritrinPointTxPK = (
  ulid: string,
): Deno.KvKey => ["ritrin_point_tx", ulid];

const ritrinPointTxSKByPubkey = (
  pubkey: string,
  ulid: string,
): Deno.KvKey => ["ritrin_point_tx_by_pubkey", pubkey, ulid];

const ritrinPointTxKeys = (
  tx: RitrinPointTransaction,
): { pk: Deno.KvKey; skByPubkey: Deno.KvKey } => {
  const ulid = ulidFromUnixtimeSec(tx.grantedAt);
  return {
    pk: ritrinPointTxPK(ulid),
    skByPubkey: ritrinPointTxSKByPubkey(tx.pubkey, ulid),
  };
};

const saveRitrinPointTxs = async (
  kv: Deno.Kv,
  txs: RitrinPointTransaction[],
) => {
  const jobs = txs.map(async (tx) => {
    const { pk, skByPubkey } = ritrinPointTxKeys(tx);
    await kv.set(pk, tx);
    await kv.set(skByPubkey, tx);
    log.info(`granted ritrin point: ${JSON.stringify(tx)}`);
  });
  await Promise.all(jobs);
};
