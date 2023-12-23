import * as log from "std/log";
import { join } from "std/path";
import { getNextKana } from "./common.ts";
import type { NostrEvent, NostrEventPre, NostrEventUnsigned } from "./types.ts";

type CommandDef = {
  key: string;
  trigger: RegExp;
  allowTrailingQuestions: boolean;
  handle: (
    event: NostrEvent,
    matches: RegExpMatchArray
  ) => NostrEventPre[] | Promise<NostrEventPre[]>;
};

const plainNote = (content: string): NostrEventPre => {
  return {
    kind: 1,
    content,
    tags: [],
  };
};

const silentMention = (target: NostrEvent, content: string): NostrEventPre => {
  return {
    kind: 1,
    content,
    tags: [["e", target.id, "", "mention"]],
  };
};

const helpText = `「!」からはじまる投稿がコマンドとして扱われます(例: !次)。

- next,次: 次の投稿をどの文字からはじめればいいか答えます。
- ping,生きてる?: botが生きているか確認します。
- help,ヘルプ: このヘルプを表示します。
`;

const commands: CommandDef[] = [
  {
    key: "next",
    trigger: /^next|(次|つぎ)は?((何|なに)(から)?)?$/i,
    allowTrailingQuestions: true,
    handle: async (event) => {
      const next = await getNextKana();
      return [silentMention(event, `次は「${next}」から！`)];
    },
  },
  {
    key: "ping",
    trigger: /^ping|(生|い)き(て|と)る\?$/i,
    allowTrailingQuestions: false,
    handle: async (event, matches) => {
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
        return [silentMention(event, `生き${t}るよ！`)];
      } catch (e) {
        log.error(`something wrong with the system: ${e}`);
        return [silentMention(event, "調子が悪いみたい…")];
      }
    },
  },
  {
    key: "help",
    trigger: /^help|ヘルプ$/i,
    allowTrailingQuestions: false,
    handle: () => {
      return [plainNote(helpText)];
    },
  },
];

export const matchCommand = (
  input: string
): { cmdDef: CommandDef; matches: RegExpMatchArray } | undefined => {
  if (!input.startsWith("!")) {
    log.info(`not a command: ${input}`);
    return undefined;
  }
  const rawCmd = input.substring(1);
  log.info(`received: ${rawCmd}`);

  for (const cmdDef of commands) {
    const cmd = cmdDef.allowTrailingQuestions
      ? rawCmd.replaceAll(/(\?|？)+$/g, "")
      : rawCmd;

    const matches = cmd.match(cmdDef.trigger);
    if (matches !== null) {
      log.info(`command matched: ${cmdDef.key}`);
      return { cmdDef, matches };
    }
  }
  log.info("no commands matched");
  return undefined;
};

export const handleCommand = async (
  cmdEv: NostrEvent
): Promise<NostrEventUnsigned[]> => {
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
    log.error(`failed to handle command: ${e}`);
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
      log.error("RESOURCE_DIR is not defined");
      Deno.exit(1);
    }

    const sockPath = join(resouceDir, "bot_cmd_check.sock");
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

      const req = new TextDecoder().decode(n === null ? buf : buf.slice(0, n));

      log.info(`requested command check...`);
      const match = matchCommand(req);
      const resp = match !== undefined ? "ok" : "ng";
      await conn.write(new TextEncoder().encode(resp));
      conn.close();
    }
  };

  serve().catch((err) => {
    log.error(`error from launch command checker: ${err}`);
    Deno.exit(1);
  });
};
