import * as dotenv from "std/dotenv/mod.ts";
import rawAccountData from "./account_data.json" with { type: "json" };
import { currUnixtime, publishToRelays } from "./common.ts";
import { parseEnvVars } from "./context.ts";
import { AccountData } from "./types.ts";

const acctData: AccountData = rawAccountData;

const relayListTags = acctData.relays.reduce((a, r) => {
  if (r.read && r.write) {
    return [...a, ["r", r.url]];
  }
  if (r.read) {
    return [...a, ["r", r.url, "read"]];
  }
  if (r.write) {
    return [...a, ["r", r.url, "write"]];
  }
  return a;
}, [] as string[][]);

if (import.meta.main) {
  dotenv.loadSync({ export: true });
  const env = parseEnvVars();
  const writeRelayUrls = acctData.relays.filter((r) => r.write).map((r) =>
    r.url
  );

  const k0 = {
    kind: 0,
    content: JSON.stringify(acctData.profile),
    tags: [],
    created_at: currUnixtime(),
  };
  const k3 = {
    kind: 3,
    content: "",
    tags: acctData.follows.map((pubkey) => ["p", pubkey, ""]),
    created_at: currUnixtime(),
  };
  const k10002 = {
    kind: 10002,
    content: "",
    tags: relayListTags,
    created_at: currUnixtime(),
  };

  await Promise.allSettled(
    [k0, k3, k10002].map(async (ev) => {
      await publishToRelays(writeRelayUrls, ev, env.RITRIN_PRIVATE_KEY, 10);
    }),
  );
}
