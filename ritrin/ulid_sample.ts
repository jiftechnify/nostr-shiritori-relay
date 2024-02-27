import { decodeTime, ulid } from "ulid";

// const uild = monotonicFactory();
const now = Date.now();
console.log(now);

const us1 = Array.from({ length: 5 }).map((_) => {
  return ulid(now);
});
const us2 = Array.from({ length: 5 }).map((_) => {
  return ulid(now - 1);
});

for (const u of us1) {
  console.log(decodeTime(u));
}
for (const u of us2) {
  console.log(decodeTime(u));
}
