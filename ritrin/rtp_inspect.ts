import {
  lastShiritoriAcceptedAtPerAuthorKey,
  lastShiritoriConnectionKey,
} from "./ritrin_point/grant.ts";
import { RitrinPointTransaction } from "./ritrin_point/model.ts";
import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";
import { dailyRtpRanking, formatRtpRanking } from "./rtp_ranking.ts";

type LastShiritoriConnectionRecord = {
  pubkey: string;
  eventId: string;
  acceptedAt: number;
  hibernationBreaking: boolean;
};

const usage = `Usage: deno task rtp-inspect <command> [args...]

Commands:

  last-accepted <pubkey>         Show the last shiritori accepted time of the pubkey
  last-srtr-conn                 Show the last shiritori connection record
  point <pubkey> [date-str]      Show the total point amount of the pubkey.
	                               If date-str is given, show the total of the date.
				                         date-str format: yyyy-mm-dd or "today"
  point-tx <pubkey> [date-str]   Show all the point transactions of the pubkey.
                                 If date-str is given, show the transactions of the date.
                                 date-str format: yyyy-mm-dd or "today"
  ranking [date-str]             Show the daily ritrin point ranking.
                                 date-str format: yyyy-mm-dd or "today". If omitted, show today's ranking.
`;

const showUsageAndExit = () => {
  console.log(usage);
  Deno.exit(1);
};

const dateStrOfToday = () => Temporal.Now.plainDateISO().toString();

if (import.meta.main) {
  const kv = await Deno.openKv("../resource/rtp.db");

  switch (Deno.args[0]) {
    case "last-accepted": {
      if (Deno.args[1] === undefined) {
        console.error("missing pubkey");
        showUsageAndExit();
      }
      const res = await kv.get<number>(
        lastShiritoriAcceptedAtPerAuthorKey(Deno.args[1]),
      );
      res.value
        ? console.log(
          `${res.value} (${new Date(res.value * 1000).toLocaleString()})`,
        )
        : console.log("not found");
      break;
    }
    case "last-srtr-conn": {
      const res = await kv.get<LastShiritoriConnectionRecord>(
        lastShiritoriConnectionKey,
      );
      console.log(res.value);
      break;
    }
    case "point": {
      if (Deno.args[1] === undefined) {
        console.error("missing pubkey");
        showUsageAndExit();
      }
      const [pubkey, dateStr] = Deno.args.slice(1);
      const rtpTxRepo = new RitrinPointTxRepo(kv);

      const calcTotalPts = (txs: RitrinPointTransaction[]) =>
        txs.reduce((sum, tx) => sum + tx.amount, 0);

      if (dateStr !== undefined) {
        const d = dateStr === "today" ? dateStrOfToday() : dateStr;
        const txs = await rtpTxRepo.findAllByPubkeyWithinDay(pubkey, d);
        console.log(
          `${pubkey}'s total ritrin points (${d}): ${calcTotalPts(txs)}`,
        );
        break;
      }
      const txs = await rtpTxRepo.findAllByPubkey(pubkey);
      console.log(
        `${pubkey}'s total ritrin points (all-time): ${calcTotalPts(txs)}`,
      );
      break;
    }
    case "point-tx": {
      if (Deno.args[1] === undefined) {
        console.error("missing pubkey");
        showUsageAndExit();
      }
      const [pubkey, dateStr] = Deno.args.slice(1);
      const rtpTxRepo = new RitrinPointTxRepo(kv);
      const txs = dateStr === "today"
        ? await rtpTxRepo.findAllByPubkeyWithinDay(
          pubkey,
          dateStrOfToday(),
        )
        : dateStr !== undefined
        ? await rtpTxRepo.findAllByPubkeyWithinDay(pubkey, dateStr)
        : await rtpTxRepo.findAllByPubkey(pubkey);

      if (txs.length === 0) {
        console.log("no records found");
        break;
      }
      console.log(`${txs.length} records found`);
      for (const tx of txs) {
        console.log(tx);
      }
      break;
    }
    case "ranking": {
      const [dstr] = Deno.args.slice(1);
      const dateStr = dstr ?? "today";

      const ranking = await dailyRtpRanking(
        kv,
        dateStr === "today" ? dateStrOfToday() : dateStr,
      );
      const formatted = formatRtpRanking(ranking);
      for (const line of formatted) {
        console.log(line);
      }
      break;
    }
    default: {
      console.error("unknown command");
      showUsageAndExit();
    }
  }
}
