#!/usr/bin/env bash
# Default off; no Firestore schema migration or company writes are required.
for flag in CN_DISCOVERY_QUEUE_ENABLED CN_DISCOVERY_BOOTSTRAP_IAM; do
  case "${!flag:-0}" in 0|1) ;; *) echo "$flag must be 0 or 1" >&2; return 1 ;; esac
done
export CN_DISCOVERY_QUEUE_ENABLED="${CN_DISCOVERY_QUEUE_ENABLED:-0}"
export CN_DISCOVERY_BOOTSTRAP_IAM="${CN_DISCOVERY_BOOTSTRAP_IAM:-0}"
