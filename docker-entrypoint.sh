#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Update murmur user/group to match requested UID/GID
if [ "$(id -u murmur)" != "$PUID" ]; then
    usermod -o -u "$PUID" murmur
fi
if [ "$(id -g murmur)" != "$PGID" ]; then
    groupmod -o -g "$PGID" murmur
fi

# Fix permissions for mounted volumes
chown -R murmur:murmur /home/murmur/.murmur

# Drop privileges and run as murmur
exec gosu murmur bun run src/main.ts "$@"
