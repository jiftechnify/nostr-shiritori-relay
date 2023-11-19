import * as dotenv from "https://deno.land/std@0.207.0/dotenv/mod.ts";
import * as log from "https://deno.land/std@0.207.0/log/mod.ts";
import {
  createRxForwardReq,
  createRxNostr,
  getPublicKey,
  uniq,
  verify,
} from "npm:rx-nostr@1.8.1";
import { filter } from "npm:rxjs@7.8.1";
import { handleCommand, launchCmdChecker } from "./commands.ts";

log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: ({ levelName, datetime, msg }) => {
        return `${datetime.toLocaleString()} [${levelName.padEnd(5)}] ${msg}`
      }
    }),
  },
  loggers: {
    default: {
      handlers: ["console"],
    },
  },
});

type EnvVars = {
  SRTRELAY_URL: string;
  PRIVATE_KEY: string;
};
const env = dotenv.loadSync({ export: true }) as EnvVars;

const botPubkey = getPublicKey(env.PRIVATE_KEY);

const rxNostr = createRxNostr();
await rxNostr.switchRelays([env.SRTRELAY_URL]);

const req = createRxForwardReq();

rxNostr
  .use(req)
  .pipe(
    verify(),
    uniq(),
    filter(
      ({ event }) => event.pubkey !== botPubkey && event.content.startsWith("!")
    )
  )
  .subscribe(async ({ event }) => {
    const res = await handleCommand(event);
    for (const e of res) {
      rxNostr.send(e, { seckey: env.PRIVATE_KEY });
    }
  });
req.emit({ kinds: [1], limit: 0 });

// launch command checker used by sifter
launchCmdChecker();

// notify launched
rxNostr.send(
  {
    kind: 1,
    content: "!(ง๑ •̀_•́)ง",
    tags: [],
  },
  { seckey: env.PRIVATE_KEY }
);
log.info("Ritrin launched !(ง๑ •̀_•́)ง");
