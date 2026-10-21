<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Firestore collection changes

Ask the user to confirm the exact name and purpose before creating any new Firestore collection. Explicit authorization in the current conversation satisfies this requirement. Never infer permission for additional collections from a related task.

Before merging a PR, inspect its reviews and review comments, address actionable findings, and review the final diff. Passing CI alone is not a code review.

## Production availability

User requirement: every release must preserve availability. Keep the current website revision serving while building and validating its replacement. Verify a candidate revision before moving traffic. Use additive, backward-compatible data migrations before enabling dependent queries, and wait for required indexes. Never pause the website, change its ingress to block users, or stop existing schedules/subscriptions as a deployment shortcut. If a release cannot meet these requirements, stop before the disruptive action and explain the blocker.

Bulk writes can fan out into cache-change events and exhaust website capacity even when no service is stopped. Bound and throttle migration batches, monitor request errors and event backlog, and stop new batches on capacity errors before resuming. Never equate a healthy final response with proof of uninterrupted availability.

## Schema fields

Ask the user to confirm before adding any new persisted field (column). Existing explicit authorization satisfies this requirement.
