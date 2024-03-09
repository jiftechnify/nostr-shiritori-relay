import { assert, assertEquals } from "std/assert/mod.ts";
import { matchCommand } from "./commands.ts";

Deno.test("matchCommand", async (t) => {
  await t.step("accept valid commands", () => {
    const tt = [
      { in: "r!next", exp: "next" },
      { in: "r!point", exp: "point" },
      { in: "r!ping", exp: "ping" },
      { in: "r!help", exp: "help" },
      { in: "r! next", exp: "next" },
      { in: "r!next ", exp: "next" },
      { in: "r! NEXT", exp: "next" },
      { in: "りとりん、次", exp: "next" },
      { in: "りとりん、 次", exp: "next" },
      { in: "りとりん、次　", exp: "next" },
      { in: "りとりん、次は?", exp: "next" },
      { in: "りとりん、次は？", exp: "next" },
      { in: "りとりん、ポイント", exp: "point" },
      { in: "りとりん、生きてる?", exp: "ping" },
      { in: "りとりん、生きてる？", exp: "ping" },
      { in: "りとりん、ヘルプ", exp: "help" },
      { in: "🦊❗➡️", exp: "next" },
      { in: "🦊❗🔜", exp: "next" },
      { in: "🦊❗⏩", exp: "next" },
      { in: "🦊❗🅿️", exp: "point" },
      { in: "🦊❗👋", exp: "ping" },
      { in: "🦊❗🤘", exp: "ping" },
      { in: "🦊❗❓", exp: "help" },
    ];

    for (const test of tt) {
      const res = matchCommand(test.in);
      assert(res !== undefined, "should match");
      assertEquals(res.cmdDef.key, test.exp);
    }
  });
  await t.step("reject invalid commands", () => {
    const invalidInputs = [
      "r!nextt",
      "!next",
      "りとりんポイント",
    ];

    for (const input of invalidInputs) {
      const res = matchCommand(input);
      assert(res === undefined, `should not match: ${input}`);
    }
  });
});
