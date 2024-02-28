import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";
import {
  lastShiritoriAcceptedAtPerAuthorKey,
  lastShiritoriConnectionKey,
} from "./ritrin_point/grant.ts";

type LastShiritoriConnectionRecord = {
  pubkey: string;
  eventId: string;
  acceptedAt: number;
  hibernationBreaking: boolean;
};

if (import.meta.main) {
  console.log(Deno.args);

  const kv = await Deno.openKv("../resource/rtp.db");

  switch (Deno.args[0]) {
    case "last-accepted": {
      if (Deno.args[1] === undefined) {
        console.error("missing pubkey");
        Deno.exit(1);
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
    case "point-txs": {
      if (Deno.args[1] === undefined) {
        console.error("missing pubkey");
        Deno.exit(1);
      }
      const rtpTxRepo = new RitrinPointTxRepo(kv);
      const txs = await rtpTxRepo.findAllByPubkey(Deno.args[1]);
      for (const tx of txs) {
        console.log(tx);
      }
      break;
    }
  }
}
