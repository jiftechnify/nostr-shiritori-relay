import { finishEvent } from "nostr-tools/event";
import { relayInit } from "nostr-tools/relay";
import { NostrEvent, NostrEventUnsigned } from "./types.ts";

export const currUnixtime = (): number => Math.floor(Date.now() / 1000);

export const publishToRelays = async (
  relayUrls: string[],
  ev: NostrEventUnsigned,
  privateKey: string,
  timeoutSec = 5
): Promise<void> => {
  let canceled = false;
  const timeout = (rurl: string) =>
    new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (canceled) {
          resolve();
          return;
        }
        console.log(`[${rurl}] publish timed out`);
        reject("timed out");
      }, timeoutSec * 1000);
    });

  const pub = async (rurl: string, signed: NostrEvent) => {
    const r = relayInit(rurl);
    await r.connect();
    await r
      .publish(signed)
      .then(() => console.log(`[${rurl}] ok`))
      .catch((e) => console.log(`[${rurl}] failed: ${e}`));
    canceled = true;
    r.close();
  };

  const signed = finishEvent(ev, privateKey);

  await Promise.allSettled(
    relayUrls.map((rurl) => Promise.race([pub(rurl, signed), timeout(rurl)]))
  );
};
