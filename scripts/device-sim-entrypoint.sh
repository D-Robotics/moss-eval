#!/bin/sh
set -eu

if [ -z "${AUTHORIZED_KEY:-}" ]; then
  echo "AUTHORIZED_KEY is required" >&2
  exit 64
fi

ssh-keygen -A >/dev/null 2>&1
printf '%s\n' "$AUTHORIZED_KEY" > /home/evaluator/.ssh/authorized_keys
chown evaluator:evaluator /home/evaluator/.ssh/authorized_keys
chmod 600 /home/evaluator/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
