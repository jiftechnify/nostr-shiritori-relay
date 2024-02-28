import { decodeTime, ulid } from "ulid";

const B32_CHARACTERS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const encodeTime = (ms: number) => {
  if (ms > 281474976710655) {
    throw new Error("Cannot encode time greater than 281474976710655");
  }
  if (ms < 0) {
    throw new Error("Cannot encode negative time");
  }
  const chars: string[] = [];
  for (let i = 0; i < 10; i++) {
    chars.unshift(B32_CHARACTERS[ms % 32]);
    ms = Math.floor(ms / 32);
  }
  return chars.join("");
};

// const uild = monotonicFactory();
const now = 1234567890000;
console.log(now);

console.log(ulid(now));
console.log(encodeTime(now));

// for (const u of us1) {
//   console.log(decodeTime(u));
// }
// for (const u of us2) {
//   console.log(decodeTime(u));
// }
