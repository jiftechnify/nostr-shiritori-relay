import { cleanEnv, makeValidator, str, url } from "envalid";
import { decode } from "nostr-tools/nip19";

// validate whether the input is a valid nsec then convert it to hex string key
const nsec = makeValidator((i) => {
  const res = decode(i);
  if (res.type !== "nsec") {
    throw Error("input is not a nsec");
  }
  return res.data;
});

const envVarsSpec = {
  RITRIN_PRIVATE_KEY: nsec(),
  RESOURCE_DIR: str(),

  SRTRELAY_URL: url(),
  YOMI_API_BASE_URL: url(),
  NOZOKIMADO_URL: url(),
} as const;

export const parseEnvVars = () => {
  const cleaned = cleanEnv(Deno.env.toObject(), envVarsSpec);
  return { ...cleaned, REVERSE_MODE: Deno.env.has("REVERSE_MODE") };
};
export type EnvVars = ReturnType<typeof parseEnvVars>;

export const maskSecretsInEnvVars = (env: EnvVars): Record<string, unknown> => {
  return {
    ...env,
    RITRIN_PRIVATE_KEY: "*******",
  };
};

export type AppContext = {
  env: EnvVars;
  writeRelayUrls: string[];
  ritrinPointKv: Deno.Kv;
};
