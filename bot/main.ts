import * as dotenv from "https://deno.land/std@0.207.0/dotenv/mod.ts";
import * as log from "https://deno.land/std@0.207.0/log/mod.ts";
import {
  ConnectionStatePacket,
  RxNostr,
  createRxForwardReq,
  createRxNostr,
  getPublicKey,
  uniq,
  verify,
} from "npm:rx-nostr@1.8.1";
import { filter } from "npm:rxjs@7.8.1";
import { handleCommand, launchCmdChecker } from "./commands.ts";

type EnvVars = {
  SRTRELAY_URL: string;
  PRIVATE_KEY: string;
};

const writeRelays = [
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nostr.holybea.com",
  "wss://nrelay-jp.c-stellar.net",
  "wss://r.kojira.io",
  "wss://relay-jp.shino3.net",
  "wss://nostr-relay.nokotaro.com",
  "wss://relay.nostr.wirednet.jp",
  "wss://nos.lol",
  "wss://relay.damus.io",
];

log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: ({ levelName, datetime, msg }) => {
        return `${datetime.toLocaleString()} [${levelName.padEnd(5)}] ${msg}`;
      },
    }),
  },
  loggers: {
    default: {
      handlers: ["console"],
    },
  },
});
const env = dotenv.loadSync({ export: true }) as EnvVars;
const botPubkey = getPublicKey(env.PRIVATE_KEY);

const rxnSrtrelayOnly = createRxNostr();
const rxnWriteRelays = createRxNostr();

await rxnSrtrelayOnly.switchRelays([env.SRTRELAY_URL]);
await rxnWriteRelays.switchRelays(
  [env.SRTRELAY_URL, ...writeRelays].map((url) => ({
    url,
    read: false,
    write: true,
  }))
);

// main logic: subscribe to posts on srtrelay and react to them
const req = createRxForwardReq();
rxnSrtrelayOnly
  .use(req)
  .pipe(
    verify(),
    uniq(),
    filter(({ event }) => event.pubkey !== botPubkey)
  )
  .subscribe(async ({ event }) => {
    if (event.content.startsWith("!")) {
      // handle commands
      const res = await handleCommand(event);
      for (const e of res) {
        rxnSrtrelayOnly.send(e, { seckey: env.PRIVATE_KEY });
      }
    } else {
      // send reactions to shiritori-connected posts
      rxnWriteRelays.send({
        kind: 7,
        content: "❗",
        tags: [
          ["e", event.id, ""],
          ["p", event.pubkey, ""],
        ],
      });
    }
  });
req.emit({ kinds: [1], limit: 0 });

// monitor relay connection state and reconenct on error
const onConnStateChange =
  (rxn: RxNostr, poolName: string) =>
  ({ from, state }: ConnectionStatePacket) => {
    switch (state) {
      case "ongoing":
        log.info(`[${poolName}:${from}] connection state: ${state}`);
        break;
      case "reconnecting":
        log.warning(`[${poolName}:${from}] connection state: ${state}`);
        break;
      case "error":
      case "rejected":
        log.error(`[${poolName}:${from}] connection state: ${state}`);
        setTimeout(() => rxn.reconnect(from), 10000);
        break;
      default:
        // no-op
        break;
    }
  };
rxnSrtrelayOnly
  .createConnectionStateObservable()
  .subscribe(onConnStateChange(rxnSrtrelayOnly, "srtrelayOnly"));
rxnWriteRelays
  .createConnectionStateObservable()
  .subscribe(onConnStateChange(rxnWriteRelays, "writeRelays"));

// launch command checker used by sifter
launchCmdChecker();

// notify launched
rxnSrtrelayOnly.send(
  {
    kind: 1,
    content: "!(ง๑ •̀_•́)ง",
    tags: [],
  },
  { seckey: env.PRIVATE_KEY }
);
log.info("Ritrin launched !(ง๑ •̀_•́)ง");
