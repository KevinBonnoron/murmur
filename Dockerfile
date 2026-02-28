FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM base

RUN groupadd --system murmur && useradd --system --gid murmur --create-home murmur \
    && mkdir -p /home/murmur/.murmur/models \
    && chown -R murmur:murmur /home/murmur/.murmur
USER murmur

COPY --from=install /app/node_modules ./node_modules
COPY . .

EXPOSE 8080
ENTRYPOINT ["bun", "run", "src/main.ts"]
CMD ["serve"]
