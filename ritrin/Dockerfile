FROM denoland/deno:debian-2.6.3

WORKDIR /app

COPY . .

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "-A", "--unstable-kv", "--unstable-temporal", "--unstable-cron", "main.ts"]
