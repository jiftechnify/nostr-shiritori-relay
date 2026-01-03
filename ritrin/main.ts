import {
  ConnectionStatePacket,
  createRxForwardReq,
  createRxNostr,
  getPublicKey,
  uniq,
  verify,
} from "rx-nostr";
import { filter } from "rxjs";
import * as log from "@std/log";
import * as path from "@std/path";
import rawAccountData from "./account_data.json" with { type: "json" };
import {
  handleCommand,
  isLikelyCommand,
  launchCommandChecker,
} from "./command.ts";
import { currUnixtime, publishToRelays, systemTimeZone } from "./common.ts";
import { AppContext, maskSecretsInEnvVars, parseEnvVars } from "./context.ts";
import { findLastShiritoriAcceptedAtOfPubkey } from "./ritrin_point/grant.ts";
import { launchShiritoriConnectionHook } from "./ritrin_point/handler.ts";
import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";
import { launchPostDailyRtpRankingCron } from "./rtp_ranking.ts";
import { launchStatusUpdater } from "./set_status.ts";
import { AccountData, NostrEventUnsigned } from "./types.ts";

const main = async () => {
  log.setup({
    handlers: {
      console: new log.ConsoleHandler("DEBUG", {
        formatter: ({ levelName, datetime, msg }) => {
          const dt = datetime
            .toTemporalInstant()
            .toZonedDateTimeISO(systemTimeZone)
            .toString({ timeZoneName: "never", fractionalSecondDigits: 3 });
          return `${dt} [${levelName.padEnd(8)}] ${msg}`;
        },
        useColors: false,
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
  const rtpRepo = new RitrinPointTxRepo(ritrinPointKv);

  const botPubkey = getPublicKey(env.RITRIN_PRIVATE_KEY);

  const rxn = createRxNostr();
  rxn.setDefaultRelays((rawAccountData as AccountData).relays);

  // main logic: subscribe to posts on relays and react to them
  const req = createRxForwardReq();
  rxn
    .use(req)
    .pipe(
      verify(),
      uniq(),
      filter(({ event }) => event.pubkey !== botPubkey),
    )
    .subscribe(async ({ event }) => {
      if (isLikelyCommand(event.content)) {
        // handle commands
        const res = await handleCommand(event, env, rtpRepo);
        for (const e of res) {
          rxn.send(e, { seckey: env.RITRIN_PRIVATE_KEY });
        }
        return;
      }
      if (isRitrinCall(event.content)) {
        // respond to "りっとりーん" call with reaction
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
      if (isAskForAgreement(event.content)) {
        // respond to an ask for Rinrin's agreement (e.g. "りとりんもそう思うよな").
        // users must ask an agreement in 1 min from last shiritori accepted to get a response.
        const now = currUnixtime();
        const lastAcceptedAt = await findLastShiritoriAcceptedAtOfPubkey(
          appCtx.ritrinPointKv,
          event.pubkey,
        );
        if (
          lastAcceptedAt === undefined ||
          lastAcceptedAt < now - ASK_FOR_AGREEMENT_GRACE_PERIOD_SEC
        ) {
          return;
        }

        log.info(
          `someone asked for Ritrin's agreement: ${event.content} (id: ${event.id})`,
        );
        const resp: NostrEventUnsigned = {
          kind: 7,
          content: Math.random() < 0.6 ? "🙂‍↕" : "🙂‍↔",
          tags: [
            ["p", event.pubkey, ""],
            ["e", event.id, ""],
          ],
          created_at: now,
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
        log.warn(`[${from}] connection state: ${state}`);
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
  launchCommandChecker(appCtx);
  launchShiritoriConnectionHook(appCtx);
  launchStatusUpdater(appCtx);
  launchPostDailyRtpRankingCron(appCtx);

  // setup handler for SIGTERM
  Deno.addSignalListener("SIGTERM", () => {
    log.info("received SIGTERM: shutting down...");
    rxn.dispose();
    Deno.exit(0);
  });

  // notify launched
  const launchingRitrin = env.REVERSE_MODE ? "╭(｡△｡*)╮¡" : "!(ง๑ •̀_•́)ง";
  await publishToRelays(
    writeRelayUrls,
    {
      kind: 1,
      content: launchingRitrin,
      tags: [],
      created_at: currUnixtime(),
    },
    env.RITRIN_PRIVATE_KEY,
  );
  log.info(`Ritrin launched ${launchingRitrin}`);
};

/* special responses */
const ritrinCallRegexp = /りっ*とり[ー〜]*ん/g;
const isRitrinCall = (content: string): boolean => {
  const matches = content.matchAll(ritrinCallRegexp);
  return [...matches].some((m) => m[0] !== "りとりん");
};

const ASK_FOR_AGREEMENT_GRACE_PERIOD_SEC = 120;
const isAskForAgreement = (content: string): boolean => {
  return content.includes("りとりんも") &&
    (["そう思う", "よな", "よね"].some((kw) => content.includes(kw)));
};

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e);
    Deno.exit(1);
  }
}
