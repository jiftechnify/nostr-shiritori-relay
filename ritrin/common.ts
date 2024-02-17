import { finishEvent } from "nostr-tools/event";
import { relayInit } from "nostr-tools/relay";
import * as log from "std/log";
import { join } from "std/path";
import { EnvVars } from "./context.ts";
import { NostrEvent, NostrEventUnsigned } from "./types.ts";

export const currUnixtime = (): number => Math.floor(Date.now() / 1000);

export const publishToRelays = async (
  relayUrls: string[],
  ev: NostrEventUnsigned,
  privateKey: string,
  timeoutSec = 5,
): Promise<void> => {
  let canceled = false;
  const timeout = (rurl: string) =>
    new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (canceled) {
          resolve();
          return;
        }
        log.error(`[${rurl}] publish timed out`);
        reject("timed out");
      }, timeoutSec * 1000);
    });

  const pub = async (rurl: string, signed: NostrEvent) => {
    const r = relayInit(rurl);
    await r.connect();
    await r
      .publish(signed)
      .then(() => log.debug(`[${rurl}] ok`))
      .catch((e) => log.error(`[${rurl}] failed: ${e}`));
    canceled = true;
    r.close();
  };

  const signed = finishEvent(ev, privateKey);

  log.info(`publishing event to ${relayUrls.length} relays...`);
  await Promise.allSettled(
    relayUrls.map((rurl) => Promise.race([pub(rurl, signed), timeout(rurl)])),
  );
};

export const LAST_KANA_FILEPATH = "last_kana.txt";

export const getNextKana = (env: EnvVars): Promise<string> => {
  return Deno.readTextFile(join(env.RESOURCE_DIR, LAST_KANA_FILEPATH));
};
