import * as log from "std/log/mod.ts";
import { ulid } from "ulid";
import { RitrinPointTransaction } from "./model.ts";

const prefixRtpTxPk = "ritrin_point_tx";
const prefixRtpTxSkByPubkey = "ritrin_point_tx_by_pubkey";

const ritrinPointTxPk = (
  ulid: string,
): Deno.KvKey => [prefixRtpTxPk, ulid];

const ritrinPointTxSkByPubkey = (
  pubkey: string,
  ulid: string,
): Deno.KvKey => [prefixRtpTxSkByPubkey, pubkey, ulid];

const ulidFromUnixtimeSec = (unixtimeSec: number) => ulid(unixtimeSec * 1000);
const ritrinPointTxKeys = (
  tx: RitrinPointTransaction,
): { pk: Deno.KvKey; skByPubkey: Deno.KvKey } => {
  const ulid = ulidFromUnixtimeSec(tx.grantedAt);
  return {
    pk: ritrinPointTxPk(ulid),
    skByPubkey: ritrinPointTxSkByPubkey(tx.pubkey, ulid),
  };
};

export class RitrinPointTxRepo {
  constructor(private kv: Deno.Kv) {}

  async saveAll(txs: RitrinPointTransaction[]) {
    const jobs = txs.map(async (tx) => {
      const { pk, skByPubkey } = ritrinPointTxKeys(tx);
      await this.kv.set(pk, tx);
      await this.kv.set(skByPubkey, tx);
      log.info(`granted ritrin point: ${JSON.stringify(tx)}`);
    });
    await Promise.all(jobs);
  }

  async findByUlid(ulid: string): Promise<RitrinPointTransaction | undefined> {
    const res = await this.kv.get<RitrinPointTransaction>(
      ritrinPointTxPk(ulid),
    );
    return res.value ?? undefined;
  }

  findAllByPubkey(pubkey: string): Promise<RitrinPointTransaction[]> {
    const iter = this.kv.list<RitrinPointTransaction>(
      { prefix: [prefixRtpTxSkByPubkey, pubkey] },
    );
    return collectAsyncIter(iter, (v) => v.value);
  }

  findAllWithinTimeRange(
    tr: TimeRange,
  ): Promise<RitrinPointTransaction[]> {
    const selector: Deno.KvListSelector = (() => {
      if ("since" in tr && "until" in tr) {
        return {
          start: ritrinPointTxPk(minUlidForInstant(tr.since)),
          end: ritrinPointTxPk(minUlidForInstant(tr.until)),
        };
      }
      if ("since" in tr) {
        return {
          prefix: [prefixRtpTxPk],
          start: ritrinPointTxPk(minUlidForInstant(tr.since)),
        };
      }
      // tr: until only
      return {
        prefix: [prefixRtpTxPk],
        end: ritrinPointTxPk(minUlidForInstant(tr.until)),
      };
    })();

    const iter = this.kv.list<RitrinPointTransaction>(selector);
    return collectAsyncIter(iter, (v) => v.value);
  }

  findAllWithinDay(dateStr: string): Promise<RitrinPointTransaction[]> {
    return this.findAllWithinTimeRange(timeRangeForDay(dateStr));
  }

  findAllByPubkeyWithinTimeRange = (
    pubkey: string,
    tr: TimeRange,
  ): Promise<RitrinPointTransaction[]> => {
    const selector: Deno.KvListSelector = (() => {
      if ("since" in tr && "until" in tr) {
        return {
          start: ritrinPointTxSkByPubkey(pubkey, minUlidForInstant(tr.since)),
          end: ritrinPointTxSkByPubkey(pubkey, minUlidForInstant(tr.until)),
        };
      }
      if ("since" in tr) {
        return {
          prefix: [prefixRtpTxSkByPubkey, pubkey],
          start: ritrinPointTxSkByPubkey(pubkey, minUlidForInstant(tr.since)),
        };
      }
      // tr: until only
      return {
        prefix: [prefixRtpTxSkByPubkey, pubkey],
        end: ritrinPointTxSkByPubkey(pubkey, minUlidForInstant(tr.until)),
      };
    })();

    const iter = this.kv.list<RitrinPointTransaction>(selector);
    return collectAsyncIter(iter, (v) => v.value);
  };

  findAllByPubkeyWithinDay = (
    pubkey: string,
    dateStr: string,
  ): Promise<RitrinPointTransaction[]> => {
    return this.findAllByPubkeyWithinTimeRange(
      pubkey,
      timeRangeForDay(dateStr),
    );
  };
}

/* date string (yyyy-mm-dd) -> time range */
type TimeRange = { since: Temporal.Instant } | { until: Temporal.Instant } | {
  since: Temporal.Instant;
  until: Temporal.Instant;
};

const timeZoneJst = Temporal.TimeZone.from("Asia/Tokyo");
const timeRangeForDay = (
  dateStr: string,
): { since: Temporal.Instant; until: Temporal.Instant } => {
  const date = Temporal.PlainDate.from(dateStr);
  const startZdt = date.toZonedDateTime(timeZoneJst);
  const endZdt = startZdt.add({ days: 1 });
  return {
    since: startZdt.toInstant(),
    until: endZdt.toInstant(),
  };
};

/* ulid stuff */
const B32_CHARACTERS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulidTimePartForInstant = (t: Temporal.Instant) => {
  let ms = t.epochMilliseconds;
  if (ms > 281474976710655) {
    throw new Error("Cannot encode time greater than 281474976710655");
  }
  if (ms < 0) {
    throw new Error("Cannot encode negative time");
  }
  const chars: string[] = [];
  for (let i = 0; i < 10; i++) {
    chars.unshift(B32_CHARACTERS[ms % 32]);
    ms = Math.floor(ms / 32);
  }
  return chars.join("");
};

const ulidMinRandomPart = "0000000000000000";
const minUlidForInstant = (t: Temporal.Instant) =>
  `${ulidTimePartForInstant(t)}${ulidMinRandomPart}`;

const collectAsyncIter = async <T, U>(
  iter: AsyncIterable<T>,
  fn: (v: T) => U,
): Promise<U[]> => {
  const res: U[] = [];
  for await (const v of iter) {
    res.push(fn(v));
  }
  return res;
};
