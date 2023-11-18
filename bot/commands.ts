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
    handle: async (_, matches) => {
      try {
        const apiBaseUrl = Deno.env.get("YOMI_API_BASE_URL");
        if (apiBaseUrl === undefined) {
          throw new Error("YOMI_API_BASE_URL is not defined");
        }
        const apiHealthResp = await fetch(`${apiBaseUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!apiHealthResp.ok) {
          throw new Error("yomi api is not healthy");
        }

        const t = matches[2] ?? "て";
        return [
          {
            kind: 1,
            content: `生き${t}るよ！`,
            tags: [],
          },
        ];
      } catch (e) {
        console.error("system is unhealthy:", e);
        return [
          {
            kind: 1,
            content: "調子が悪いみたい…",
            tags: [],
          },
        ];
      }
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
  input: string
): { cmdDef: CommandDef; matches: RegExpMatchArray } | undefined => {
  if (!input.startsWith("!")) {
    console.log("not a command:", input);
    return undefined;
  }
  const rawCmd = input.substring(1);
  console.log("received:", rawCmd);

  for (const cmdDef of commands) {
    const cmd = cmdDef.allowTrailingQuestions
      ? rawCmd.replaceAll(/(\?|？)+$/g, "")
      : rawCmd;

    const matches = cmd.match(cmdDef.trigger);
    if (matches !== null) {
      console.log("command matched!", cmdDef.key);
      return { cmdDef, matches };
    }
  }
  console.log("no commands matched");
  return undefined;
};

export const handleCommand = async (
  cmdEv: NostrEvent
): Promise<NostrEventRaw[]> => {
  const cmdMatch = matchCommand(cmdEv.content);
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

export const launchCmdChecker = () => {
  const serve = async () => {
    const resouceDir = Deno.env.get("RESOURCE_DIR");
    if (resouceDir === undefined) {
      console.error("RESOURCE_DIR is not defined");
      Deno.exit(1);
    }

    const sockPath = join(resouceDir, "bot_cmd_check.sock");
    try {
      Deno.removeSync(sockPath);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        console.error(err);
        Deno.exit(1);
      }
    }

    const listener = Deno.listen({ transport: "unix", path: sockPath });
    while (true) {
      const conn = await listener.accept();
      const buf = new Uint8Array(1024);
      await conn.read(buf);
      const req = new TextDecoder().decode(buf);

      console.log("command check request!");
      const match = matchCommand(req);
      const resp = match !== undefined ? "ok" : "ng";
      await conn.write(new TextEncoder().encode(resp));
      conn.close();
    }
  };

  serve().catch((err) => {
    console.error(err);
    Deno.exit(1);
  });
};
