import {
  ConnectionStatePacket,
  createRxForwardReq,
  createRxNostr,
  getPublicKey,
  uniq,
  verify,
} from "rx-nostr";
import { filter } from "rxjs";
import * as log from "std/log";
import * as path from "std/path";
import rawAccountData from "./account_data.json" with { type: "json" };
import { handleCommand, launchCmdChecker } from "./commands.ts";
import { currUnixtime, publishToRelays } from "./common.ts";
import { AppContext, maskSecretsInEnvVars, parseEnvVars } from "./context.ts";
import { launchShiritoriConnectionHook } from "./ritrin_point/handler.ts";
import { launchStatusUpdater } from "./set_status.ts";
import { AccountData, NostrEventUnsigned } from "./types.ts";
import { systemTimeZone } from "./common.ts";

const main = async () => {
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("DEBUG", {
        formatter: ({ levelName, datetime, msg }) => {
          const dt = datetime
            .toTemporalInstant()
            .toZonedDateTimeISO(systemTimeZone)
            .toString({ timeZoneName: "never" });
          return `${dt} [${levelName.padEnd(8)}] ${msg}`;
        },
      }),
    },
    loggers: {
      default: {
        handlers: ["console"],
      },
    },
  });

  // initialize app context
  const env = parseEnvVars();
  log.info(`environment vars: ${JSON.stringify(maskSecretsInEnvVars(env))}`);

  const writeRelayUrls = (rawAccountData as AccountData).relays
    .filter((r) => r.write)
    .map((r) => r.url);
  const ritrinPointKv = await Deno.openKv(
    path.join(env.RESOURCE_DIR, "rtp.db"),
  );
  const appCtx: AppContext = {
    env,
    writeRelayUrls,
    ritrinPointKv,
  };

  const botPubkey = getPublicKey(env.RITRIN_PRIVATE_KEY);

  const rxn = createRxNostr();
  rxn.setDefaultRelays((rawAccountData as AccountData).relays);

  // main logic: subscribe to posts on relays and react to them
  const ritrinCallRegexp = /^りっ*とり[ー〜]*ん.*$/;
  const req = createRxForwardReq();
  rxn
    .use(req)
    .pipe(
      verify(),
      uniq(),
      filter(({ event }) => event.pubkey !== botPubkey),
    )
    .subscribe(async ({ event }) => {
      if (event.content.startsWith("!")) {
        // handle commands
        const res = await handleCommand(event, env);
        for (const e of res) {
          rxn.send(e, { seckey: env.RITRIN_PRIVATE_KEY });
        }
        return;
      }
      if (ritrinCallRegexp.test(event.content)) {
        // respond to "りとりん" call with reaction
        log.info(`Ritrin called: ${event.content} (id: ${event.id})`);
        const resp: NostrEventUnsigned = {
          kind: 7,
          content: ":ritrin:",
          tags: [
            ["p", event.pubkey, ""],
            ["e", event.id, ""],
            [
              "emoji",
              "ritrin",
              "https://pubimgs.c-stellar.net/ritrin1_r.webp",
            ],
          ],
          created_at: currUnixtime(),
        };
        rxn.send(resp, { seckey: env.RITRIN_PRIVATE_KEY });
        return;
      }
    });
  req.emit({ kinds: [1], limit: 0 });

  // monitor relay connection state, and recoonect on error
  const onConnStateChange = ({ from, state }: ConnectionStatePacket) => {
    switch (state) {
      case "connecting":
      case "connected":
      case "dormant":
        log.info(`[${from}] connection state: ${state}`);
        break;
      case "waiting-for-retrying":
      case "retrying":
        log.warning(`[${from}] connection state: ${state}`);
        break;
      case "error":
      case "rejected": {
        log.error(`[${from}] connection state: ${state}`);
        const relayCnf = rxn.getDefaultRelay(from);
        if (relayCnf?.read) {
          rxn.reconnect(from);
        }
        break;
      }
      default:
        // no-op
        break;
    }
  };
  rxn.createConnectionStateObservable().subscribe(onConnStateChange);

  // launch subsystems
  launchCmdChecker(appCtx);
  launchShiritoriConnectionHook(appCtx);
  launchStatusUpdater(appCtx);

  // setup handler for SIGTERM
  Deno.addSignalListener("SIGTERM", () => {
    log.info("received SIGTERM: shutting down...");
    rxn.dispose();
    Deno.exit(0);
  });

  // notify launched
  await publishToRelays(
    writeRelayUrls,
    {
      kind: 1,
      content: "!(ง๑ •̀_•́)ง",
      tags: [],
      created_at: currUnixtime(),
    },
    env.RITRIN_PRIVATE_KEY,
  );
  log.info("Ritrin launched !(ง๑ •̀_•́)ง");
};

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e);
    Deno.exit(1);
  }
}
