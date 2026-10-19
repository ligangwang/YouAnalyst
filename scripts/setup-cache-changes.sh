#!/usr/bin/env bash
set -euo pipefail
# Source listeners replace Eventarc/global checkpoint invalidation. Do not remove
# existing triggers here: old revisions/jobs must finish before operator cleanup.
echo 'Targeted source listeners enabled; shared checkpoint setup retired.'
