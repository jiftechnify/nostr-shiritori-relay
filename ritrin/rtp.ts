import * as log from "std/log";
import { join } from "std/path";
import { currUnixtime, publishToRelays } from "./common.ts";
import { EnvVars } from "./env.ts";

type EventAcceptance = {
  pubkey: string;
  eventId: string;
  head: string;
  last: string;
  acceptedAt: number;
};

export const grantRitrinPointsAndSendReactions = async (
  kv: Deno.Kv,
  ea: EventAcceptance,
  env: EnvVars,
  writeRelays: string[],
) => {
  const rtps = await grantRitrinPoints(kv, ea);
  await saveRitrinPointTxs(kv, rtps);

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
      // white: last kana not changed, red: last kana changed
      content: ea.head === ea.last ? "❕" : "❗",
      tags: [
        ["e", ea.eventId, ""],
        ["p", ea.pubkey, ""],
      ],
      created_at: currUnixtime(),
    }];

  // send reactions to accepted / nice-pass posts
  await Promise.all(
    reactions.map((k7) =>
      publishToRelays(writeRelays, k7, env.RITRIN_PRIVATE_KEY)
    ),
  );
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

const lastAcceptedAtPerPubkeyKey = (
  pubkey: string,
): Deno.KvKey => ["last_accepted_at", pubkey];

const lastEventAcceptanceKey: Deno.KvKey = ["last_event_acceptance"];

const grantRitrinPoints = async (
  kv: Deno.Kv,
  newAcceptance: EventAcceptance,
): Promise<RitrinPointTransaction[]> => {
  const myLastAcceptedAtKey = lastAcceptedAtPerPubkeyKey(newAcceptance.pubkey);

  let res = { ok: false };
  while (!res.ok) {
    const [myLastAcceptedAt, lastEventAcceptance] = await kv.getMany<
      [number, LastEventAcceptanceRecord]
    >([myLastAcceptedAtKey, lastEventAcceptanceKey]);

    const grantedPoints = [
      ...grantDailyPoint(myLastAcceptedAt.value, newAcceptance),
      ...grantHibernationBreakingPoint(
        lastEventAcceptance.value,
        newAcceptance,
      ),
      ...grantNicePassPoint(
        lastEventAcceptance.value,
        newAcceptance,
      ),
    ];
    const hibernationBreaking = grantedPoints.some((b) =>
      b.type === "hibernation-breaking"
    );

    const newLastAcceptanceRecord: LastEventAcceptanceRecord = {
      pubkey: newAcceptance.pubkey,
      eventId: newAcceptance.eventId,
      acceptedAt: newAcceptance.acceptedAt,
      hibernationBreaking,
    };
    res = await kv.atomic().check(myLastAcceptedAt).check(lastEventAcceptance)
      .set(myLastAcceptedAtKey, newAcceptance.acceptedAt)
      .set(
        lastEventAcceptanceKey,
        newLastAcceptanceRecord,
      )
      .commit();
    return grantedPoints;
  }
  console.error("unreachable");
  return [];
};

export const unixDayJst = (unixtimeSec: number) =>
  Math.floor((unixtimeSec + 9 * 3600) / (24 * 3600));

export const grantDailyPoint = (
  lastAcceptedAt: number | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (
    lastAcceptedAt !== null &&
    unixDayJst(newAcceptance.acceptedAt) === unixDayJst(lastAcceptedAt)
  ) {
    return [];
  }

  return [
    {
      type: "daily",
      pubkey: newAcceptance.pubkey,
      eventId: newAcceptance.eventId,
      amount: 1,
      grantedAt: newAcceptance.acceptedAt,
    },
  ];
};

// threshold of considering inactivity as "hibernation": 12 hours
const hibernationThreshold = 12 * 60 * 60;

export const grantHibernationBreakingPoint = (
  lastAcceptanceRec: LastEventAcceptanceRecord | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (lastAcceptanceRec === null) {
    return [];
  }
  if (lastAcceptanceRec.pubkey === newAcceptance.pubkey) {
    // grant hibernation-breaking point only if new event's author is different than prev event' author
    return [];
  }
  if (newAcceptance.head === newAcceptance.last) {
    // grant hibernation-breaking point only if the last kana changed
    return [];
  }
  if (
    newAcceptance.acceptedAt - lastAcceptanceRec.acceptedAt <
      hibernationThreshold
  ) {
    return [];
  }

  return [{
    type: "hibernation-breaking",
    pubkey: newAcceptance.pubkey,
    eventId: newAcceptance.eventId,
    amount: 1,
    grantedAt: newAcceptance.acceptedAt,
  }];
};

// threshold of "short" consecutive acceptance: 10 minutes
// in this case, preceding acceptance considered as "nice pass"
const shortAcceptanceSpanThreshold = 10 * 60;

export const grantNicePassPoint = (
  lastAcceptance: LastEventAcceptanceRecord | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (lastAcceptance === null) {
    return [];
  }
  if (lastAcceptance.pubkey === newAcceptance.pubkey) {
    // grant nice-pass point only if authors of previous event and new event are different
    return [];
  }
  if (!lastAcceptance.hibernationBreaking) {
    // grant nice-pass point only if the previous acceptance is hibernation-breaking
    return [];
  }
  if (
    newAcceptance.acceptedAt - lastAcceptance.acceptedAt >
      shortAcceptanceSpanThreshold
  ) {
    return [];
  }

  return [{
    type: "nice-pass",
    pubkey: lastAcceptance.pubkey,
    eventId: lastAcceptance.eventId,
    amount: 1,
    grantedAt: newAcceptance.acceptedAt,
  }];
};

const ritrinPointTxKey = (
  pubkey: string,
  createdAtMs: number = Date.now(),
  pointType: RitrinPointType,
): Deno.KvKey => ["ritrin_point_transaction", pubkey, createdAtMs, pointType];

type LastEventAcceptanceRecord = {
  pubkey: string;
  eventId: string;
  acceptedAt: number;
  hibernationBreaking: boolean;
};

const saveRitrinPointTxs = async (
  kv: Deno.Kv,
  txs: RitrinPointTransaction[],
) => {
  const now = Date.now();
  const jobs = txs.map((tx) => {
    log.info(`granted ritrin point: ${JSON.stringify(tx)}`);
    const key = ritrinPointTxKey(tx.pubkey, now, tx.type);
    return kv.set(key, tx);
  });
  await Promise.all(jobs);
};

export const launchEventAcceptanceHook = (
  env: EnvVars,
  writeRelays: string[],
) => {
  const serve = async () => {
    const kv = await Deno.openKv(join(env.RESOURCE_DIR, "rtp.db"));
    const sockPath = join(env.RESOURCE_DIR, "event_acceptance_hook.sock");
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
      const evAcceptance = JSON.parse(reqTxt) as EventAcceptance;

      if (n === null) {
        log.error("failed to read from connection");
        conn.close();
        continue;
      }

      log.info(
        `received event acceptance notification: ${
          JSON.stringify(evAcceptance)
        }`,
      );

      try {
        await grantRitrinPointsAndSendReactions(
          kv,
          evAcceptance,
          env,
          writeRelays,
        );
      } catch (err) {
        log.error(`error while processing event acceptance: ${err}`);
      }

      conn.close();
    }
  };

  log.info("launching event acceptance hook...");
  serve().catch((err) => {
    log.error(`error while launching event acceptance hook: ${err}`);
    Deno.exit(1);
  });
};
