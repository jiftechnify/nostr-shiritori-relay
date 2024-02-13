import * as log from "std/log";
import { join } from "std/path";
import { currUnixtime, publishToRelays } from "./common.ts";
import { EnvVars } from "./env.ts";

type EventAcceptance = {
  pubkey: string;
  eventId: string;
  acceptedAt: number;
};

export const sendReactionToAcceptedEvent = async (
  { pubkey, eventId }: EventAcceptance,
  env: EnvVars,
  writeRelays: string[],
) => {
  // send reactions to shiritori-connected posts
  const k7 = {
    kind: 7,
    content: "❗",
    tags: [
      ["e", eventId, ""],
      ["p", pubkey, ""],
    ],
    created_at: currUnixtime(),
  };
  await publishToRelays(writeRelays, k7, env.RITRIN_PRIVATE_KEY);
};

export const launchEventAcceptanceHook = (
  env: EnvVars,
  writeRelays: string[],
) => {
  const serve = async () => {
    const sockPath = join(env.RESOURCE_DIR, "event_acceptance_hook.sock");
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

      // const j = await toJson(conn.readable);
      const reqTxt = new TextDecoder().decode(
        n === null ? buf : buf.slice(0, n),
      );
      const evAcceptance = JSON.parse(reqTxt) as EventAcceptance;

      if (n === null) {
        log.error("failed to read from connection");
        conn.close();
        continue;
      }

      log.info(
        `received event acceptance notification: ${
          JSON.stringify(evAcceptance)
        }`,
      );
      await sendReactionToAcceptedEvent(evAcceptance, env, writeRelays);

      conn.close();
    }
  };

  log.info("launching event acceptance hook...");
  serve().catch((err) => {
    log.error(`error while launching event acceptance hook: ${err}`);
    Deno.exit(1);
  });
};
