import { assert, assertEquals, assertNotEquals } from "std/assert/mod.ts";
import {
  grantDailyPoint,
  grantHibernationBreakingPoint,
  grantNicePassPoint,
  grantShiritoriPoint,
  grantSpecialConnectionPoint,
  unixDayJst,
} from "./grant.ts";
import {
  LastShiritoriConnectionRecord,
  ShiritoriConnectedPost,
} from "./model.ts";

const dateToUnixtimeSec = (date: Date) => Math.floor(date.getTime() / 1000);

Deno.test("unixDayJst", async (t) => {
  await t.step("returns unix day in JST", () => {
    const d1 = dateToUnixtimeSec(new Date("2024-01-01T00:00:00+09:00"));
    const d2 = dateToUnixtimeSec(new Date("2024-01-01T08:00:00+09:00"));
    const d3 = dateToUnixtimeSec(new Date("2024-01-01T23:59:59+09:00"));
    const d4 = dateToUnixtimeSec(new Date("2023-12-31T23:59:59+09:00"));

    const [u1, u2, u3, u4] = [d1, d2, d3, d4].map(unixDayJst);
    assertEquals(u1, u2);
    assertEquals(u1, u3);
    assertNotEquals(u1, u4);
  });
});

Deno.test("grantDailyPoint", async (t) => {
  const baseAcceptedAt = dateToUnixtimeSec(
    new Date("2024-02-14T00:00:00+09:00"),
  );
  const baseScp: ShiritoriConnectedPost = {
    pubkey: "p1",
    eventId: "e1",
    acceptedAt: baseAcceptedAt,
    head: "ア",
    last: "ア",
  };
  await t.step(
    "grant daily point if it's the first shiritori connected post for the user (e.g. lastAcceptedAt is null)",
    () => {
      const [pt] = grantDailyPoint(null, baseScp);
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "daily",
        pubkey: "p1",
        eventId: "e1",
        amount: 3,
        grantedAt: baseAcceptedAt,
      });
    },
  );
  await t.step(
    "grant daily point if new acceptance day > last acceptance day",
    () => {
      const lastAcceptedAt = dateToUnixtimeSec(
        new Date("2024-02-14T23:00:00+09:00"),
      );
      const newAcceptedAt = dateToUnixtimeSec(
        new Date("2024-02-15T01:00:00+09:00"),
      );

      const [pt] = grantDailyPoint(lastAcceptedAt, {
        ...baseScp,
        acceptedAt: newAcceptedAt,
      });
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "daily",
        pubkey: "p1",
        eventId: "e1",
        amount: 3,
        grantedAt: newAcceptedAt,
      });
    },
  );
  await t.step(
    "don't grant daily point if new acceptance day <= last acceptance day",
    () => {
      const lastAcceptedAt = dateToUnixtimeSec(
        new Date("2024-02-14T23:00:00+09:00"),
      );
      const newAcceptedAt = dateToUnixtimeSec(
        new Date("2024-02-14T23:59:59+09:00"),
      );

      const [pt] = grantDailyPoint(lastAcceptedAt, {
        ...baseScp,
        acceptedAt: newAcceptedAt,
      });
      assert(pt === undefined, "pt should beundefined");
    },
  );
});

const baseLastSc: LastShiritoriConnectionRecord = {
  pubkey: "p1",
  eventId: "e1",
  acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
  head: "ア",
  last: "ア",
  hibernationBreaking: false,
};
const baseNewScp: ShiritoriConnectedPost = {
  pubkey: "p1",
  eventId: "e1",
  acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
  head: "ア",
  last: "ア",
};

Deno.test("grantShiritoriPoint", async (t) => {
  await t.step(
    "grant shiritori point",
    () => {
      const lastSc = baseLastSc;
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        eventId: "e2",
      };

      const [pt] = grantShiritoriPoint(lastSc, newScp);
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "shiritori",
        amount: 1,
        pubkey: "p2",
        eventId: "e2",
        grantedAt: newScp.acceptedAt,
      });
    },
  );
  await t.step(
    "grant shiritori point if lastSc is null",
    () => {
      const lastSc = null;
      const newScp = {
        ...baseNewScp,
        pubkey: "p1",
        eventId: "e1",
      };

      const [pt] = grantShiritoriPoint(lastSc, newScp);
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "shiritori",
        amount: 1,
        pubkey: "p1",
        eventId: "e1",
        grantedAt: newScp.acceptedAt,
      });
    },
  );
  await t.step(
    "don't grant shiritori point if authors of two events are same",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p1", // same author
      };

      const [pt] = grantShiritoriPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
});

Deno.test("grantHibernationBreakingPoint", async (t) => {
  await t.step(
    "grant hibernation-breaking point if all conditions meet",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2", // author is different
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-15T00:00:00+09:00")), // interval is long enough
        head: "ア",
        last: "イ", // last kana changed
      };

      const [pt] = grantHibernationBreakingPoint(lastSc, newScp);
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "hibernation-breaking",
        amount: 15,
        pubkey: "p2",
        eventId: "e2",
        grantedAt: newScp.acceptedAt,
      });
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if lastSc is null",
    () => {
      const lastSc = null;
      const newScp = baseNewScp;

      const [pt] = grantHibernationBreakingPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if authors of two events are same",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p1", // same author
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-15T00:00:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantHibernationBreakingPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if newly accepted post doesn't change the last kana",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-15T00:00:00+09:00")),
        head: "ア",
        last: "ア", // last kana didn't change
      };
      const [pt] = grantHibernationBreakingPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if interval is below the threshold",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:30:00+09:00")), // interval is too short
        head: "ア",
        last: "イ",
      };

      const [pt] = grantHibernationBreakingPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
});

Deno.test("grantNicePassPoint", async (t) => {
  await t.step(
    "grant nice-pass point if all conditions meet",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        hibernationBreaking: true, // last connection was hibernation-breaking
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2", // author is different
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:30+09:00")), // interval is short enough
      };

      const [pt] = grantNicePassPoint(lastSc, newScp);
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "nice-pass",
        amount: 5,
        pubkey: "p1",
        eventId: "e1",
        grantedAt: newScp.acceptedAt,
      });
    },
  );
  await t.step(
    "don't grant nice-pass point if lastSc is null",
    () => {
      const lastSc = null; // no last acceptance
      const newScp = baseNewScp;

      const [pt] = grantNicePassPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if authors of two events are same",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        hibernationBreaking: true,
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p1", // same author
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:30+09:00")),
      };

      const [pt] = grantNicePassPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if last acceptance is not hibernation-breaking",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        hibernationBreaking: false, // last connection wasn't hibernation-breaking
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:30+09:00")),
      };

      const [pt] = grantNicePassPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if interval is above the threshold",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        hibernationBreaking: true,
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:15:00+09:00")), // interval is too long
      };

      const [pt] = grantNicePassPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
});

Deno.test("grantSpecialConnectionPoint", async (t) => {
  await t.step(
    "grant special-connection point if all conditions meet",
    () => {
      for (
        const [prevLast, newHead] of [
          ["ヴ", "ブ"],
          ["ヲ", "オ"],
          ["ヰ", "イ"],
          ["ヱ", "エ"],
        ]
      ) {
        const lastSc = {
          ...baseLastSc,
          pubkey: "p1",
          last: prevLast,
        };
        const newScp = {
          ...baseNewScp,
          pubkey: "p2", // author is different
          eventId: "e2",
          head: newHead, // spscial connection
        };

        const [pt] = grantSpecialConnectionPoint(lastSc, newScp);
        assert(pt !== undefined, "pt should not be undefined");
        assertEquals(pt, {
          type: "special-connection",
          amount: 10,
          pubkey: "p2",
          eventId: "e2",
          grantedAt: newScp.acceptedAt,
        });
      }
    },
  );
  await t.step(
    "don't grant special-connection point if connection is not special",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        last: "イ",
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p2",
        head: "イ",
      };

      const [pt] = grantSpecialConnectionPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant special-connection point if lastSc is null",
    () => {
      const lastSc = null; // no last acceptance
      const newScp = baseNewScp;

      const [pt] = grantSpecialConnectionPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant special-connection point if authors of two events are same",
    () => {
      const lastSc = {
        ...baseLastSc,
        pubkey: "p1",
        last: "ヴ",
      };
      const newScp = {
        ...baseNewScp,
        pubkey: "p1", // same author
        head: "ブ",
      };

      const [pt] = grantSpecialConnectionPoint(lastSc, newScp);
      assert(pt === undefined, "pt should be undefined");
    },
  );
});
