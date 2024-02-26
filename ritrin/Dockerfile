FROM denoland/deno:debian-1.41.0

WORKDIR /app

COPY . .

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "-A", "--unstable-kv", "main.ts"]
