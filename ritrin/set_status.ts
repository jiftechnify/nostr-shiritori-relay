import { debounce } from "@std/async";
import * as log from "@std/log";
import { basename } from "@std/path";
import {
  currUnixtime,
  getNextKana,
  LAST_KANA_FILEPATH,
  publishToRelays,
} from "./common.ts";
import { AppContext, EnvVars } from "./context.ts";

const updateStatusOnNextKanaChange = (env: EnvVars, writeRelayUrls: string[]) =>
  debounce(async () => {
    const nextKana = await getNextKana(env);
    const k30315 = {
      kind: 30315,
      content: `次は「${nextKana}」から！`,
      tags: [
        ["d", "general"],
        ["r", env.NOZOKIMADO_URL],
      ],
      created_at: currUnixtime(),
    };
    await publishToRelays(writeRelayUrls, k30315, env.RITRIN_PRIVATE_KEY);
  }, 1000);

export const launchStatusUpdater = async (
  { env, writeRelayUrls }: AppContext,
) => {
  log.info("launching status updater...");

  const watcher = Deno.watchFs(env.RESOURCE_DIR);
  const updateStatus = updateStatusOnNextKanaChange(env, writeRelayUrls);

  for await (const event of watcher) {
    const lastKanaPath = event.paths.find(
      (p) => basename(p) === LAST_KANA_FILEPATH,
    );
    if (
      lastKanaPath !== undefined &&
      ["create", "modify"].includes(event.kind)
    ) {
      updateStatus();
    }
  }
};
