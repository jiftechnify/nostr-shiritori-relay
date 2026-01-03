import { assert, assertEquals } from "@std/assert";
import { matchCommand } from "./command.ts";

Deno.test("matchCommand", async (t) => {
  await t.step("accept valid commands", () => {
    const tt = [
      { in: "r!next", exp: "next" },
      { in: "r!point", exp: "point" },
      { in: "r!rtp", exp: "point" },
      { in: "r!ping", exp: "ping" },
      { in: "r!help", exp: "help" },
      { in: "r! next", exp: "next" },
      { in: "r!next ", exp: "next" },
      { in: "r! NEXT", exp: "next" },
      { in: "r!what's the next?", exp: "next" },
      { in: "r!tell me my rtp", exp: "point" },
      { in: "りとりん、次", exp: "next" },
      { in: "りとりん、つぎ", exp: "next" },
      { in: "りとりん、ツギ", exp: "next" },
      { in: "りとりん、 次", exp: "next" },
      { in: "りとりん、次　", exp: "next" },
      { in: "りとりん、次は?", exp: "next" },
      { in: "りとりん、次は？", exp: "next" },
      { in: "りとりん、つぎってなにからだっけ？", exp: "next" },
      { in: "りとりん、ポイント", exp: "point" },
      { in: "りとりん、ぽいんと", exp: "point" },
      { in: "りとりん、りとポ", exp: "point" },
      { in: "りとりん、楽天ポイント", exp: "point" },
      { in: "りとりん、生きてる?", exp: "ping" },
      { in: "りとりん、生きてる？", exp: "ping" },
      { in: "りとりん、生きてるか?", exp: "ping" },
      { in: "りとりん、生きとるかい？", exp: "ping" },
      { in: "りとりん、ヘルプ", exp: "help" },
      { in: "りとりん、へるぷ", exp: "help" },
      { in: "りとりん、ヘルプミー", exp: "help" },
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
      "!next",
      "りとりんポイント",
      "りとりん、生きてる",
    ];

    for (const input of invalidInputs) {
      const res = matchCommand(input);
      assert(res === undefined, `should not match: ${input}`);
    }
  });
  await t.step("submatch for 「りとりん、生き(て/と)る?」 is valid" , () => {
    const res = matchCommand("りとりん、生きてる？");
    assert(res !== undefined, "should match");
    assert(res.matches[1] === "て", "invalid submatch: should be て");

    const res2 = matchCommand("りとりん、生きとる？");
    assert(res2 !== undefined, "should match");
    assert(res2.matches[1] === "と", "invalid submatch: should be と");
  })
});
