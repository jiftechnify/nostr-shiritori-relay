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
import { AccountData } from "./types.ts";

const main = async () => {
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("DEBUG", {
        formatter: ({ levelName, datetime, msg }) => {
          return `${datetime.toLocaleString()} [${levelName.padEnd(8)}] ${msg}`;
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
  await rxn.switchRelays([env.SRTRELAY_URL]);

  // force reconnect if no post received for 10 minutes
  let forceReconnectTimer: number | undefined;
  const scheduleForceReconnect = () => {
    if (forceReconnectTimer !== undefined) {
      clearTimeout(forceReconnectTimer);
    }
    forceReconnectTimer = setTimeout(async () => {
      log.warning("force reconnect to srtrelay");
      await rxn.removeRelay(env.SRTRELAY_URL);
      await rxn.addRelay(env.SRTRELAY_URL);
      scheduleForceReconnect();
    }, 10 * 60 * 1000);
  };

  // main logic: subscribe to posts on srtrelay and react to them
  const req = createRxForwardReq();
  rxn
    .use(req)
    .pipe(
      verify(),
      uniq(),
      filter(({ event }) =>
        event.pubkey !== botPubkey && event.content.startsWith("!")
      ),
    )
    .subscribe(async ({ event }) => {
      // handle commands
      const res = await handleCommand(event, env);
      for (const e of res) {
        rxn.send(e, { seckey: env.RITRIN_PRIVATE_KEY });
      }
      // schedule force reconnect every time post received
      scheduleForceReconnect();
    });
  req.emit({ kinds: [1], limit: 0 });

  // monitor relay connection state
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

  // reconnect on error
  setInterval(() => {
    if (["error", "rejected"].includes(rxn.getRelayState(env.SRTRELAY_URL))) {
      log.warning("reconnecting to srtrelay");
      rxn.reconnect(env.SRTRELAY_URL);
    }
  }, 5000);
  // schedule force reconnect for the first time
  scheduleForceReconnect();

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
