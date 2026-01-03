import { NostrFetcher } from "nostr-fetch";
import { npubEncode } from "nostr-tools/nip19";
import { delay } from "@std/async";
import * as log from "@std/log";
import { currUnixtime, jstTimeZone, publishToRelays } from "./common.ts";
import { AppContext } from "./context.ts";
import { RitrinPointTransaction } from "./ritrin_point/model.ts";
import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";
import { NostrEventUnsigned } from "./types.ts";

type RawRankingEntry = {
  pkHex: string;
  pts: number;
};

type RtpRankingEntry = {
  npub: string;
  name: string | undefined;
  points: number;
};

const parseProfileName = (k0Content: string) => {
  try {
    const profile = JSON.parse(k0Content) as {
      display_name?: string;
      name?: string;
    };
    return profile.display_name ?? profile.name;
  } catch {
    return undefined;
  }
};

export const dailyRtpRanking = async (
  rtpKv: Deno.Kv,
  dateStr: string,
): Promise<RtpRankingEntry[]> => {
  const rtpTxRepo = new RitrinPointTxRepo(rtpKv);
  const txs = await rtpTxRepo.findAllWithinDay(dateStr);

  return aggregateRtpRanking(txs, {
    filterEntry: ({ pts }) => pts > 4,
    limit: 10,
  });
};

type RtpRankingAggregationOptions = {
  filterEntry?: (entry: RawRankingEntry) => boolean;
  limit?: number;
};

export const aggregateRtpRanking = (
  rtpTxs: RitrinPointTransaction[],
  options: RtpRankingAggregationOptions,
): Promise<RtpRankingEntry[]> => {
  const { filterEntry, limit }: Required<RtpRankingAggregationOptions> = {
    filterEntry: () => true,
    limit: 10,
    ...options,
  };

  const ptsPerPubkey = rtpTxs.reduce(
    (acc, tx) => acc.set(tx.pubkey, (acc.get(tx.pubkey) ?? 0) + tx.amount),
    new Map<string, number>(),
  );

  const rawRanking = [...ptsPerPubkey.entries()]
    .map(([pkHex, pts]) => ({ pkHex, pts }))
    .filter(filterEntry)
    .sort(({ pts: pts1 }, { pts: pts2 }) => pts2 - pts1) // points desc
    .slice(0, limit);

  return joinProfileWithRanking(rawRanking);
};

const joinProfileWithRanking = async (
  rawRanking: RawRankingEntry[],
): Promise<RtpRankingEntry[]> => {
  const pks = rawRanking.map(({ pkHex }) => pkHex);

  // fetch profiles
  const fetcher = NostrFetcher.init({ minLogLevel: "info" });
  const profilesIter = fetcher.fetchLastEventPerAuthor({
    authors: pks,
    relayUrls: ["wss://directory.yabu.me", "wss://relay.nostr.band"],
  }, { kinds: [0] });
  const names = new Map<string, string | undefined>();
  for await (const { author, event } of profilesIter) {
    if (event !== undefined) {
      names.set(author, parseProfileName(event.content));
    } else {
      names.set(author, undefined);
    }
  }
  fetcher.shutdown();

  return rawRanking.map(({ pkHex, pts }) => ({
    npub: npubEncode(pkHex),
    name: names.get(pkHex),
    points: pts,
  }));
};

export const formatRtpRanking = (ranking: RtpRankingEntry[]): string[] => {
  let consecRank = 0;
  let prevPts = 0;
  return ranking.map(({ npub, name, points }, i) => {
    const rank = (points === prevPts) ? consecRank : i + 1;
    consecRank = rank;
    prevPts = points;
    const fmtRank = rankEmojis[rank] ?? String(rank)
    return (name !== undefined)
      ? `${fmtRank} ${points} ${name} (nostr:${npub})`
      : `${fmtRank} ${points} nostr:${npub}`;
  });
};

const rankEmojis = ["", "🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

const postDailyRtpRanking = async (
  { ritrinPointKv, writeRelayUrls, env }: AppContext,
  date: Temporal.PlainDate,
) => {
  const header = `${date.toLocaleString("ja-JP")}の獲得りとポランキング❗`;
  const ranking = await dailyRtpRanking(ritrinPointKv, date.toString());
  const lines = [header, "", ...formatRtpRanking(ranking)];

  const post: NostrEventUnsigned = {
    kind: 1,
    content: lines.join("\n"),
    tags: [],
    created_at: currUnixtime(),
  };

  await publishToRelays(writeRelayUrls, post, env.RITRIN_PRIVATE_KEY);
};

export const launchPostDailyRtpRankingCron = (ctx: AppContext) => {
  log.info("launching a cron job that posts daily RTP ranking...");

  // post daily RTP ranking at 00:00:10 (JST)
  Deno.cron("post daily RTP ranking", "0 15 * * *", async () => {
    await delay(10 * 1000); // wait for 10 secs
    const yesterday = Temporal.Now.plainDateISO(jstTimeZone).subtract({
      days: 1,
    });
    try {
      await postDailyRtpRanking(ctx, yesterday);
    } catch (err) {
      log.error("Failed to post daily RTP ranking:", err);
    }
  });
};
