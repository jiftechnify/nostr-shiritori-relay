import * as log from "std/log/mod.ts";
import { join } from "std/path/mod.ts";
import { getNextKana } from "./common.ts";
import { AppContext, EnvVars } from "./context.ts";
import type { NostrEvent, NostrEventPre, NostrEventUnsigned } from "./types.ts";
import { RitrinPointTxRepo } from "./ritrin_point/tx.ts";

type CommandContext = {
  env: EnvVars;
  rtpRepo: RitrinPointTxRepo;
  matches: RegExpMatchArray;
};
type CommandDef = {
  key: string;
  trigger: RegExp;
  handle: (
    event: NostrEvent,
    ctx: CommandContext,
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

const reply = (target: NostrEvent, content: string): NostrEventPre => {
  return {
    kind: 1,
    content,
    tags: [["p", target.pubkey, ""], ["e", target.id, "", "root"]],
  };
};

const helpText =
  `「r!」「りとりん、」に続けてコマンドを入力してね❗ (例:「r!next」「りとりん、ポイント」)

- next,次: 次の投稿をどの文字からはじめればいいか答えます。
- point,ポイント: りとりんポイントの獲得状況を表示します。
- ping,生きてる?: しりとリレーが生きているか確認します。
- help,ヘルプ: このヘルプを表示します。
`;

const commands: CommandDef[] = [
  {
    key: "next",
    trigger:
      /^(next|(次|つぎ)は?((何|なに)(から)?)?[?？]?)$|^[\u{23e9}\u{27a1}\u{1f51c}]/iu,
    handle: async (event, { env }) => {
      const next = await getNextKana(env);
      return [silentMention(event, `次は「${next}」から❗`)];
    },
  },
  {
    key: "point",
    trigger: /^(point|ポイント)$|^\u{1f17f}/iu,
    handle: async (event, { rtpRepo }) => {
      const txs = await rtpRepo.findAllByPubkey(event.pubkey);
      const startOfToday =
        Temporal.Now.zonedDateTimeISO().startOfDay().epochSeconds;

      const [total, today] = txs.reduce(
        (
          [total, today],
          { amount, grantedAt },
        ) => [
          total + amount,
          grantedAt >= startOfToday ? today + amount : today,
        ],
        [0, 0],
      );
      const lines = [
        "あなたのりとりんポイント獲得状況❗",
        `累計: ${total} ポイント`,
        `本日: ${today} ポイント`,
      ];
      return [
        reply(event, lines.join("\n")),
      ];
    },
  },
  {
    key: "ping",
    trigger: /^(ping|[生い]き([てと])る[?？])$|^[\u{1f44b}\u{1f918}]/iu,
    handle: async (event, { env, matches }) => {
      try {
        const apiHealthResp = await fetch(`${env.YOMI_API_BASE_URL}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!apiHealthResp.ok) {
          throw new Error("yomi api is not healthy");
        }

        const t = matches[2] ?? "て";
        return [silentMention(event, `生き${t}るよ❗`)];
      } catch (e) {
        log.error(`r!ping: something wrong with the system: ${e}`);
        return [silentMention(event, "調子が悪いみたい…")];
      }
    },
  },
  {
    key: "help",
    trigger: /^(help|ヘルプ)$|^\u{2753}/iu,
    handle: () => {
      return [plainNote(helpText)];
    },
  },
];

const commandTriggers = ["r!", "りとりん、", "\u{1f98a}\u{2757}"];

export const isLikelyCommand = (input: string): boolean => {
  return commandTriggers.some((t) => input.startsWith(t));
};

const stripCommandTrigger = (input: string): string => {
  for (const trigger of commandTriggers) {
    if (input.startsWith(trigger)) {
      return input.replace(trigger, "").trim();
    }
  }
  return input;
};

export const matchCommand = (
  input: string,
): { cmdDef: CommandDef; matches: RegExpMatchArray } | undefined => {
  if (!isLikelyCommand(input)) {
    log.info(`not a command: ${input}`);
    return undefined;
  }
  const cmdText = stripCommandTrigger(input);
  log.info(`received: ${cmdText}`);

  for (const cmdDef of commands) {
    const matches = cmdText.match(cmdDef.trigger);
    if (matches !== null) {
      log.info(`command matched: ${cmdDef.key}`);
      return { cmdDef, matches };
    }
  }
  log.info("no commands matched");
  return undefined;
};

export const handleCommand = async (
  cmdEv: NostrEvent,
  env: EnvVars,
  rtpRepo: RitrinPointTxRepo,
): Promise<NostrEventUnsigned[]> => {
  const cmdMatch = matchCommand(cmdEv.content);
  if (cmdMatch === undefined) {
    return [];
  }
  const { cmdDef, matches } = cmdMatch;

  try {
    const res = await cmdDef.handle(cmdEv, { env, matches, rtpRepo });
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

export const launchCmdChecker = ({ env }: AppContext) => {
  const serve = async () => {
    const sockPath = join(env.RESOURCE_DIR, "bot_cmd_check.sock");
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

  log.info("launching command checker...");
  serve().catch((err) => {
    log.error(`error while launching command checker: ${err}`);
    Deno.exit(1);
  });
};
