import {
  ConnectionStatePacket,
  createRxForwardReq,
  createRxNostr,
  getPublicKey,
  uniq,
  verify,
} from "rx-nostr";
import { filter } from "rxjs";
import * as dotenv from "std/dotenv";
import * as log from "std/log";
import rawAccountData from "./account_data.json" assert { type: "json" };
import { handleCommand, launchCmdChecker } from "./commands.ts";
import { AccountData, EnvVars } from "./types.ts";
import { currUnixtime, publishToRelays } from "./utils.ts";

if (import.meta.main) {
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

  const writeRelays = (rawAccountData as AccountData).relays
    .filter((r) => r.write)
    .map((r) => r.url);

  const rxn = createRxNostr();
  await rxn.switchRelays([env.SRTRELAY_URL]);

  // main logic: subscribe to posts on srtrelay and react to them
  const req = createRxForwardReq();
  rxn
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
          rxn.send(e, { seckey: env.PRIVATE_KEY });
        }
      } else {
        // send reactions to shiritori-connected posts
        const k7 = {
          kind: 7,
          content: "❗",
          tags: [
            ["e", event.id, ""],
            ["p", event.pubkey, ""],
          ],
          created_at: currUnixtime(),
        };
        await publishToRelays(writeRelays, k7, env.PRIVATE_KEY);
      }
    });
  req.emit({ kinds: [1], limit: 0 });

  // monitor relay connection state and reconenct on error
  const onConnStateChange = ({ from, state }: ConnectionStatePacket) => {
    switch (state) {
      case "ongoing":
        log.info(`[${from}] connection state: ${state}`);
        break;
      case "reconnecting":
        log.warning(`[${from}] connection state: ${state}`);
        break;
      case "error":
      case "rejected":
        log.error(`[${from}] connection state: ${state}`);
        break;
      default:
        // no-op
        break;
    }
  };
  rxn.createConnectionStateObservable().subscribe(onConnStateChange);

  setInterval(() => {
    if (["error", "rejected"].includes(rxn.getRelayState(env.SRTRELAY_URL))) {
      log.warning("reconnecting to srtrelay");
      rxn.reconnect(env.SRTRELAY_URL);
    }
  }, 10000);

  // launch command checker used by sifter
  launchCmdChecker();

  // notify launched
  await publishToRelays(
    writeRelays,
    {
      kind: 1,
      content: "!(ง๑ •̀_•́)ง",
      tags: [],
      created_at: currUnixtime(),
    },
    env.PRIVATE_KEY
  );
  log.info("Ritrin launched !(ง๑ •̀_•́)ง");
}
