FROM lukechannings/deno:latest

WORKDIR /app

COPY . .

# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["task", "start"]
