import * as log from "std/log/mod.ts";
import * as path from "std/path/mod.ts";
import { currUnixtime, publishToRelays } from "../common.ts";
import { AppContext } from "../context.ts";
import {
  BonusPointType,
  isBonusPoint,
  ShiritoriConnectedPost,
} from "./model.ts";
import { RitrinPointTxRepo } from "./tx.ts";
import { grantRitrinPoints } from "./grant.ts";

const reactionContentForBonusPointType: Record<BonusPointType, string> = {
  daily: "🎁",
  "hibernation-breaking": "‼️",
  "nice-pass": "🙌",
  "special-connection": "🫰",
};

export const launchShiritoriConnectionHook = (
  appCtx: AppContext,
) => {
  const rtpTxRepo = new RitrinPointTxRepo(appCtx.ritrinPointKv);

  const serve = async () => {
    const sockPath = path.join(
      appCtx.env.RESOURCE_DIR,
      "shiritori_connection_hook.sock",
    );
    try {
      Deno.removeSync(sockPath);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(`failed to remove unix socket: ${err}`);
        Deno.exit(1);
      }
    }

    const listener = Deno.listen({ transport: "unix", path: sockPath });
    while (true) {
      const conn = await listener.accept();
      const buf = new Uint8Array(1024);
      const n = await conn.read(buf);

      const reqTxt = new TextDecoder().decode(
        n === null ? buf : buf.slice(0, n),
      );
      const scp = JSON.parse(reqTxt) as ShiritoriConnectedPost;

      if (n === null) {
        log.error("failed to read from connection");
        conn.close();
        continue;
      }

      log.info(
        `received shiritori connected post: ${JSON.stringify(scp)}`,
      );

      try {
        await handleShiritoriConnection(scp, appCtx, rtpTxRepo);
      } catch (err) {
        log.error(
          `error while handling shiritori connected post connection: ${err}`,
        );
      }
      conn.close();
    }
  };

  log.info("launching shiritori connection hook...");
  serve().catch((err) => {
    log.error(`error while launching shiritori connection hook: ${err}`);
    Deno.exit(1);
  });
};

const shiritoriReactionContent = (
  newScp: ShiritoriConnectedPost,
): string => {
  if (newScp.last === "ン") {
    return "🤔";
  }
  if (newScp.head === "ン") {
    return "🥳";
  }
  // white: last kana not changed, red: last kana changed
  return newScp.head === newScp.last ? "❕" : "❗";
};

export const handleShiritoriConnection = async (
  newScp: ShiritoriConnectedPost,
  { env, writeRelayUrls, ritrinPointKv }: AppContext,
  rtpTxRepo: RitrinPointTxRepo,
) => {
  const rtps = await grantRitrinPoints(
    ritrinPointKv,
    newScp,
  );
  await rtpTxRepo.saveAll(rtps);

  const reactions = rtps.filter(isBonusPoint).map(
    ({ type, eventId, pubkey }) => {
      return {
        kind: 7,
        content: reactionContentForBonusPointType[type],
        tags: [
          ["e", eventId, ""],
          ["p", pubkey, ""],
        ],
        created_at: currUnixtime(),
      };
    },
  );
  // if no bonus points granted, send default shiritori reaction
  if (reactions.length === 0) {
    reactions.push({
      kind: 7,
      content: shiritoriReactionContent(newScp),
      tags: [
        ["e", newScp.eventId, ""],
        ["p", newScp.pubkey, ""],
      ],
      created_at: currUnixtime(),
    });
  }

  // send reactions to accepted / nice-pass posts
  await Promise.all(
    reactions.map((k7) =>
      publishToRelays(writeRelayUrls, k7, env.RITRIN_PRIVATE_KEY)
    ),
  );
};
