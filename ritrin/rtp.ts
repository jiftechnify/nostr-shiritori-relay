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
      content: ea.head === ea.last ? "❗" : "❕",
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
  acceptedAt: number;
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

    const bonuses = [
      ...grantDailyBonus(myLastAcceptedAt.value, newAcceptance),
      ...grantHibernationBreakingBonus(
        lastEventAcceptance.value,
        newAcceptance,
      ),
      ...grantNicePassBonus(
        lastEventAcceptance.value,
        newAcceptance,
      ),
    ];
    const hibernationBreaking = bonuses.some((b) =>
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
    return bonuses;
  }

  console.log("unreachable");
  return [];
};

const unixDay = (unixtime: number) => Math.floor(unixtime / 86400);

const grantDailyBonus = (
  lastAcceptedAt: number | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (
    lastAcceptedAt !== null &&
    unixDay(newAcceptance.acceptedAt) === unixDay(lastAcceptedAt)
  ) {
    return [];
  }

  return [
    {
      type: "daily",
      pubkey: newAcceptance.pubkey,
      eventId: newAcceptance.eventId,
      amount: 1,
      acceptedAt: newAcceptance.acceptedAt,
    },
  ];
};

// threshold of considering inactivity as "hibernation": 12 hours
const hibernationThreshold = 12 * 60 * 60;

const grantHibernationBreakingBonus = (
  lastAcceptance: LastEventAcceptanceRecord | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (lastAcceptance === null) {
    return [];
  }
  if (newAcceptance.head === newAcceptance.last) {
    return [];
  }
  if (
    newAcceptance.acceptedAt - lastAcceptance.acceptedAt < hibernationThreshold
  ) {
    return [];
  }

  return [{
    type: "hibernation-breaking",
    pubkey: newAcceptance.pubkey,
    eventId: newAcceptance.eventId,
    amount: 1,
    acceptedAt: newAcceptance.acceptedAt,
  }];
};

// threshold of "short" consecutive acceptance: 10 minutes
// in this case, preceding acceptance considered as "nice pass"
const shortAcceptanceSpanThreshold = 10 * 60;

const grantNicePassBonus = (
  lastAcceptance: LastEventAcceptanceRecord | null,
  newAcceptance: EventAcceptance,
): RitrinPointTransaction[] => {
  if (lastAcceptance === null) {
    return [];
  }
  if (!lastAcceptance.hibernationBreaking) {
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
    pubkey: newAcceptance.pubkey,
    eventId: newAcceptance.eventId,
    amount: 1,
    acceptedAt: newAcceptance.acceptedAt,
  }];
};

const ritrinPointTxKey = (
  pubkey: string,
  createdAtMs: number = Date.now(),
): Deno.KvKey => ["ritrin_point_transaction", pubkey, createdAtMs];

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
    const key = ritrinPointTxKey(tx.pubkey, now);
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
      await grantRitrinPointsAndSendReactions(
        kv,
        evAcceptance,
        env,
        writeRelays,
      );

      conn.close();
    }
  };

  log.info("launching event acceptance hook...");
  serve().catch((err) => {
    log.error(`error while launching event acceptance hook: ${err}`);
    Deno.exit(1);
  });
};
