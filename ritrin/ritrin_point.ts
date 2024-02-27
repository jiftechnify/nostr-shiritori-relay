import * as log from "std/log";
import * as path from "std/path";
import { currUnixtime, publishToRelays } from "./common.ts";
import { AppContext } from "./context.ts";

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

type RitrinPointType = "daily" | "hibernation-breaking" | "nice-pass";
type RitrinPointTransaction = {
  type: RitrinPointType;
  amount: number;
  pubkey: string;
  eventId: string;
  grantedAt: number;
};

const reactionContentForPointType: Record<RitrinPointType, string> = {
  daily: "🎁",
  "hibernation-breaking": "‼️",
  "nice-pass": "🙌",
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

const isSpecialConnection = (prevLast: string, newHead: string) =>
  [["ヴ", "ブ"], ["ヲ", "オ"], ["ヰ", "イ"], ["ヱ", "エ"]].some(([pl, nh]) =>
    pl === prevLast && nh === newHead
  );

const nonPointReactionContent = (
  prevConn: LastShiritoriConnectionRecord | undefined,
  newScp: ShiritoriConnectedPost,
): string => {
  if (
    prevConn !== undefined && isSpecialConnection(prevConn.last, newScp.head)
  ) {
    // special connection
    return "🫰";
  }
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
  const { grantedPoints: rtps, prevConn } = await grantRitrinPoints(
    ritrinPointKv,
    newScp,
  );
  await saveRitrinPointTxs(ritrinPointKv, rtps);

  const reactions = rtps.length > 0
    ? rtps.map(({ type, eventId, pubkey }) => {
      return {
        kind: 7,
        content: reactionContentForPointType[type],
        tags: [
          ["e", eventId, ""],
          ["p", pubkey, ""],
        ],
        created_at: currUnixtime(),
      };
    })
    : [{
      kind: 7,
      content: nonPointReactionContent(prevConn, newScp),
      tags: [
        ["e", newScp.eventId, ""],
        ["p", newScp.pubkey, ""],
      ],
      created_at: currUnixtime(),
    }];

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
): Promise<
  {
    grantedPoints: RitrinPointTransaction[];
    prevConn: LastShiritoriConnectionRecord | undefined;
  }
> => {
  const myLastAcceptedAtKey = lastShiritoriAcceptedAtPerAuthorKey(
    newScp.pubkey,
  );

  let res = { ok: false };
  while (!res.ok) {
    const [myLastConnectedAt, prevConnRecord] = await kv.getMany<
      [number, LastShiritoriConnectionRecord]
    >([myLastAcceptedAtKey, lastShiritoriConnectionKey]);

    const grantedPoints = [
      ...grantDailyPoint(myLastConnectedAt.value, newScp),
      ...grantHibernationBreakingPoint(
        prevConnRecord.value,
        newScp,
        hibernationMinIntervalSec,
      ),
      ...grantNicePassPoint(
        prevConnRecord.value,
        newScp,
        nicePassMaxIntervalSec,
      ),
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
    return { grantedPoints, prevConn: prevConnRecord.value ?? undefined };
  }
  throw Error("grantRitrinPoints: unreachable");
};

export const unixDayJst = (unixtimeSec: number) =>
  Math.floor((unixtimeSec + 9 * 3600) / (24 * 3600));

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
      amount: 1,
      grantedAt: newScp.acceptedAt,
    },
  ];
};

// threshold of considering inactivity as "hibernation": 12 hours
// TODO:make it configurable by env var
const hibernationMinIntervalSec = 12 * 60 * 60;

export const grantHibernationBreakingPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
  minIntervalSec: number,
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
  if (
    newScp.acceptedAt - prevSc.acceptedAt <
      minIntervalSec
  ) {
    return [];
  }

  return [{
    type: "hibernation-breaking",
    pubkey: newScp.pubkey,
    eventId: newScp.eventId,
    amount: 1,
    grantedAt: newScp.acceptedAt,
  }];
};

// threshold of "shortness" of consecutive shiritori connection span: 10 minutes
// in this case, preceding connection considered as "nice pass"
// TODO:make it configurable by env var
const nicePassMaxIntervalSec = 10 * 60;

export const grantNicePassPoint = (
  prevSc: LastShiritoriConnectionRecord | null,
  newScp: ShiritoriConnectedPost,
  maxIntervalSec: number,
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
  if (
    newScp.acceptedAt - prevSc.acceptedAt >
      maxIntervalSec
  ) {
    return [];
  }

  return [{
    type: "nice-pass",
    pubkey: prevSc.pubkey,
    eventId: prevSc.eventId,
    amount: 1,
    grantedAt: newScp.acceptedAt,
  }];
};

const ritrinPointTxKey = (
  pubkey: string,
  grantedAt: number,
  pointType: RitrinPointType,
): Deno.KvKey => ["point_transaction", pubkey, grantedAt, pointType];

const saveRitrinPointTxs = async (
  kv: Deno.Kv,
  txs: RitrinPointTransaction[],
) => {
  const jobs = txs.map(async (tx) => {
    const key = ritrinPointTxKey(tx.pubkey, tx.grantedAt, tx.type);
    await kv.set(key, tx);
    log.info(`granted ritrin point: ${JSON.stringify(tx)}`);
  });
  await Promise.all(jobs);
};
