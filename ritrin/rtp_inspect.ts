import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";
import {
  lastShiritoriAcceptedAtPerAuthorKey,
  lastShiritoriConnectionKey,
} from "./ritrin_point/grant.ts";
import { RitrinPointTransaction } from "./ritrin_point/model.ts";
import { NostrFetcher } from "nostr-fetch";

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
`;

const showUsageAndExit = () => {
  console.log(usage);
  Deno.exit(1);
};

const dateStrOfToday = () => Temporal.Now.plainDateISO().toString();

const parseProfileName = (k0Content: string) => {
  try {
    const profile = JSON.parse(k0Content);
    return profile.display_name ?? profile.name ?? "???";
  } catch {
    return "???";
  }
};

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
      const rtpTxRepo = new RitrinPointTxRepo(kv);
      const txs = await rtpTxRepo.findAllWithinDay(dateStrOfToday());
      const ptsPerPubkey = txs.reduce(
        (acc, tx) => acc.set(tx.pubkey, (acc.get(tx.pubkey) ?? 0) + tx.amount),
        new Map<string, number>(),
      );

      const ranking = [...ptsPerPubkey.entries()].sort(
        ([, a], [, b]) => b - a,
      );

      const profilesIter = NostrFetcher.init().fetchLastEventPerAuthor({
        authors: [...ptsPerPubkey.keys()],
        relayUrls: ["wss://directory.yabu.me", "wss://relay.nostr.band"],
      }, { kinds: [0] });
      const names = new Map<string, string>();
      for await (const { author, event } of profilesIter) {
        if (event !== undefined) {
          names.set(author, parseProfileName(event.content));
        } else {
          names.set(author, "???");
        }
      }
      for (const [pubkey, count] of ranking) {
        console.log(`${names.get(pubkey) ?? pubkey}: ${count}`);
      }
      break;
    }
    default: {
      console.error("unknown command");
      showUsageAndExit();
    }
  }
}
