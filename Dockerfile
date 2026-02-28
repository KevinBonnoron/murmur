FROM oven/bun:1 AS base
WORKDIR /app

RUN usermod -l murmur -d /home/murmur -m bun \
    && groupmod -n murmur bun \
    && apt-get update && apt-get install -y --no-install-recommends gosu tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/murmur/.murmur/models \
    && chown -R murmur:murmur /home/murmur/.murmur

FROM base AS install
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM base
COPY docker-entrypoint.sh ./
COPY --from=install /app/node_modules ./node_modules
COPY . .

EXPOSE 8080
ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
CMD ["serve"]
