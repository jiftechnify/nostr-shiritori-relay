import { join } from "https://deno.land/std@0.207.0/path/mod.ts";
import { type EventPacket } from "npm:rx-nostr@1.8.1";

type NostrEvent = EventPacket["event"];
type NostrEventRaw = Omit<NostrEvent, "sig" | "id" | "pubkey">;
type NostrEventPre = Omit<NostrEventRaw, "created_at">;

type CommandDef = {
  key: string;
  trigger: RegExp;
  allowTrailingQuestions: boolean;
  handle: (
    event: NostrEvent,
    matches: RegExpMatchArray
  ) => NostrEventPre[] | Promise<NostrEventPre[]>;
};

const helpText = `「!」からはじまる投稿がコマンドとして扱われます(例: !次)。

- next,次: 次の投稿をどの文字からはじめればいいか答えます。
- ping,生きてる?: botが生きているか確認します。
- help,ヘルプ: このヘルプを表示します。
`;

const getNextKana = (): Promise<string> => {
  const resouceDir = Deno.env.get("RESOURCE_DIR");
  if (resouceDir === undefined) {
    throw new Error("RESOURCE_DIR is not defined");
  }
  return Deno.readTextFile(join(resouceDir, "last_kana.txt"));
};

const commands: CommandDef[] = [
  {
    key: "next",
    trigger: /^next|(次|つぎ)は?((何|なに)(から)?)?$/i,
    allowTrailingQuestions: true,
    handle: async () => {
      const next = await getNextKana();
      return [
        {
          kind: 1,
          content: `次は「${next}」から！`,
          tags: [],
        },
      ];
    },
  },
  {
    key: "ping",
    trigger: /^ping|(生|い)き(て|と)る\?$/i,
    allowTrailingQuestions: false,
    handle: (_, matches) => {
      const t = matches[2] ?? "て";
      return [
        {
          kind: 1,
          content: `生き${t}るよ！`,
          tags: [],
        },
      ];
    },
  },
  {
    key: "help",
    trigger: /^help|ヘルプ$/i,
    allowTrailingQuestions: false,
    handle: () => {
      return [
        {
          kind: 1,
          content: helpText,
          tags: [],
        },
      ];
    },
  },
];

export const matchCommand = (
  cmdEv: NostrEvent
): { cmdDef: CommandDef; matches: RegExpMatchArray } | undefined => {
  if (!cmdEv.content.startsWith("!")) {
    console.log("not a command:", cmdEv.content);
    return undefined;
  }
  const rawCmd = cmdEv.content.substring(1);
  console.log("received:", rawCmd);

  for (const cmdDef of commands) {
    const cmd = cmdDef.allowTrailingQuestions
      ? rawCmd.replaceAll(/(\?|？)+$/g, "")
      : rawCmd;
      
    const matches = cmd.match(cmdDef.trigger);
    if (matches !== null) {
      console.log("command matched! ", cmdDef.key)
      return { cmdDef, matches };
    }
  }
  console.log("no commands matched")
  return undefined;
};

export const handleCommand = async (
  cmdEv: NostrEvent
): Promise<NostrEventRaw[]> => {
  const cmdMatch = matchCommand(cmdEv);
  if (cmdMatch === undefined) {
    return [];
  }
  const { cmdDef, matches } = cmdMatch;

  try {
    const res = await cmdDef.handle(cmdEv, matches);
    return res.map((e, i) => ({
      ...e,
      created_at: cmdEv.created_at + 1 + i,
    }));
  } catch (e) {
    console.error("failed to handle command:", e);
    return [
      {
        kind: 1,
        content: "コマンド処理中にエラーが発生しました…",
        tags: [],
        created_at: cmdEv.created_at + 1,
      },
    ];
  }
};
