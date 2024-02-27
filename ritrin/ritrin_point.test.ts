import { assertNotEquals } from "https://deno.land/std@0.210.0/assert/assert_not_equals.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  grantDailyPoint,
  grantHibernationBreakingPoint,
  grantNicePassPoint,
  grantSpecialConnectionPoint,
  unixDayJst,
} from "./ritrin_point.ts";

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
  await t.step(
    "grant daily point if it's the first shiritori connected post for the user (e.g. lastAcceptedAt is null)",
    () => {
      const [pt] = grantDailyPoint(null, {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: 1000,
        head: "",
        last: "",
      });
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "daily",
        pubkey: "p1",
        eventId: "e1",
        amount: 1,
        grantedAt: 1000,
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
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: newAcceptedAt,
        head: "",
        last: "",
      });
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "daily",
        pubkey: "p1",
        eventId: "e1",
        amount: 1,
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
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: newAcceptedAt,
        head: "",
        last: "",
      });
      assert(pt === undefined, "pt should beundefined");
    },
  );
});

Deno.test("grantHibernationBreakingPoint", async (t) => {
  await t.step(
    "grant hibernation-breaking point if all conditions meet",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p2", // author is different
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")), // interval is long enough
        head: "ア",
        last: "イ", // last kana changed
      };

      const [pt] = grantHibernationBreakingPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "hibernation-breaking",
        amount: 1,
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
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantHibernationBreakingPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if authors of two events are same",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p1", // same author
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantHibernationBreakingPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if newly accepted post doesn't change the last kana",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")),
        head: "ア",
        last: "ア", // last kana didn't change
      };

      const [pt] = grantHibernationBreakingPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant hibernation-breaking point if interval is below the threshold",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T11:00:00+09:00")), // interval is too short
        head: "ア",
        last: "イ",
      };

      const [pt] = grantHibernationBreakingPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
});

Deno.test("grantNicePassPoint", async (t) => {
  await t.step(
    "grant nice-pass point if all conditions meet",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: true, // last connection was hibernation-breaking
      };
      const newScp = {
        pubkey: "p2", // author is different
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")), // interval is short enough
        head: "ア",
        last: "イ",
      };

      const [pt] = grantNicePassPoint(
        lastSc,
        newScp,
        10 * 60,
      );
      assert(pt !== undefined, "pt should not be undefined");
      assertEquals(pt, {
        type: "nice-pass",
        amount: 1,
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
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantNicePassPoint(
        lastSc,
        newScp,
        10 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if authors of two events are same",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p1", // same author
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantNicePassPoint(
        lastSc,
        newScp,
        12 * 60 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if last acceptance is not hibernation-breaking",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false, // last connection wasn't hibernation-breaking
      };
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantNicePassPoint(
        lastSc,
        newScp,
        10 * 60,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant nice-pass point if interval is above the threshold",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: true,
      };
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:15:00+09:00")), // interval is too long
        head: "ア",
        last: "イ",
      };

      const [pt] = grantNicePassPoint(
        lastSc,
        newScp,
        10 * 60,
      );
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
          pubkey: "p1",
          eventId: "e1",
          acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
          head: "ア",
          last: prevLast,
          hibernationBreaking: true, // last connection was hibernation-breaking
        };
        const newScp = {
          pubkey: "p2", // author is different
          eventId: "e2",
          acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")), // interval is short enough
          head: newHead,
          last: "イ",
        };

        const [pt] = grantSpecialConnectionPoint(
          lastSc,
          newScp,
        );
        assert(pt !== undefined, "pt should not be undefined");
        assertEquals(pt, {
          type: "special-connection",
          amount: 1,
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
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: true, // last connection was hibernation-breaking
      };
      const newScp = {
        pubkey: "p2", // author is different
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")), // interval is short enough
        head: "ア",
        last: "イ",
      };

      const [pt] = grantSpecialConnectionPoint(
        lastSc,
        newScp,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant special-connection point if lastSc is null",
    () => {
      const lastSc = null; // no last acceptance
      const newScp = {
        pubkey: "p2",
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:05:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantSpecialConnectionPoint(
        lastSc,
        newScp,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
  await t.step(
    "don't grant special-connection point if authors of two events are same",
    () => {
      const lastSc = {
        pubkey: "p1",
        eventId: "e1",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T00:00:00+09:00")),
        head: "ア",
        last: "ア",
        hibernationBreaking: false,
      };
      const newScp = {
        pubkey: "p1", // same author
        eventId: "e2",
        acceptedAt: dateToUnixtimeSec(new Date("2024-02-14T15:00:00+09:00")),
        head: "ア",
        last: "イ",
      };

      const [pt] = grantSpecialConnectionPoint(
        lastSc,
        newScp,
      );
      assert(pt === undefined, "pt should be undefined");
    },
  );
});
