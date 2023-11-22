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
  let cancelTimeout: () => void | undefined;
  const timeout = (rurl: string) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`[${rurl}] publish timed out`);
        reject("timed out");
      }, timeoutSec * 1000);

      cancelTimeout = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

  const pub = async (rurl: string, signed: NostrEvent) => {
    const r = relayInit(rurl);
    await r.connect();
    await r
      .publish(signed)
      .then(() => console.log(`[${rurl}] ok`))
      .catch((e) => console.log(`[${rurl}] failed: ${e}`));
    r.close();
    cancelTimeout?.();
  };

  const signed = finishEvent(ev, privateKey);
  await Promise.all(
    relayUrls.map((rurl) => Promise.race([pub(rurl, signed), timeout(rurl)]))
  );
};
