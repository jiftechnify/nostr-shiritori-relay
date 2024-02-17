import { assertEquals } from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.210.0/testing/bdd.ts";
import { parseEnvVars } from "./context.ts";

const TEST_PRIVATE_KEY = {
  nsec: "nsec1kcnh9qp4tg8uqjx2rrt442wtkcqdy2k9h95ddgspfxnzrawzh0ls9arstu",
  hex: "b6277280355a0fc048ca18d75aa9cbb600d22ac5b968d6a20149a621f5c2bbff",
};

describe("parseEnvVars", () => {
  beforeEach(() => {
    for (const k of Object.keys(Deno.env.toObject())) {
      Deno.env.delete(k);
    }
  });

  it("parses env vars successfully", () => {
    Deno.env.set("RITRIN_PRIVATE_KEY", TEST_PRIVATE_KEY.nsec);
    Deno.env.set("RESOURCE_DIR", "/path/to/resource");
    Deno.env.set("SRTRELAY_URL", "https://srtrelay.example.com");
    Deno.env.set("YOMI_API_BASE_URL", "https://yomi.example.com");
    Deno.env.set("NOZOKIMADO_URL", "https://nozokimado.example.com");

    const env = parseEnvVars();

    assertEquals(env.RITRIN_PRIVATE_KEY, TEST_PRIVATE_KEY.hex); // make sure that nsec is converted to hex
    assertEquals(env.RESOURCE_DIR, "/path/to/resource");
    assertEquals(env.SRTRELAY_URL, "https://srtrelay.example.com");
    assertEquals(env.YOMI_API_BASE_URL, "https://yomi.example.com");
    assertEquals(env.NOZOKIMADO_URL, "https://nozokimado.example.com");
  });
});
