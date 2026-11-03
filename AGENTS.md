<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design principles

User-defined design principles: simple and easy to use, visually delightful, and strikingly futuristic, with an experience that goes beyond conventional financial platforms.

Apply these principles to all future interface and interaction design. Make primary actions intuitive and effortless, minimizing cognitive load and unnecessary steps. Keep the visual experience clear, comfortable, and refined, using color, lighting, spatial depth, and restrained motion to create a compelling sense of future technology. Visual effects should support understanding and interaction. Preserve simplicity and usability as new features are added.

## Firestore collection changes

Ask the user to confirm the exact name and purpose before creating any new Firestore collection. Explicit authorization in the current conversation satisfies this requirement. Never infer permission for additional collections from a related task.

Before merging a PR, inspect its reviews and review comments, address actionable findings, and review the final diff. Passing CI alone is not a code review.

## Complete fixes through deployment

User preference: when asked to fix an issue, carry the fix through testing, review, merge, production deployment, and verification. Do not stop at a local change or open PR, or ask for deployment permission again when the fix is already authorized. Preserve availability and the approval requirements for schema changes above/below; report concrete blockers when required access or approvals are unavailable.

## Production availability

User requirement: every release must preserve availability. Keep the current website revision serving while building and validating its replacement. Verify a candidate revision before moving traffic. Use additive, backward-compatible data migrations before enabling dependent queries, and wait for required indexes. Never pause the website, change its ingress to block users, or stop existing schedules/subscriptions as a deployment shortcut. If a release cannot meet these requirements, stop before the disruptive action and explain the blocker.

Bulk writes can fan out into cache-change events and exhaust website capacity even when no service is stopped. Bound and throttle migration batches, monitor request errors and event backlog, and stop new batches on capacity errors before resuming. Never equate a healthy final response with proof of uninterrupted availability.

## Schema fields

Ask the user to confirm before adding any new persisted field (column). Existing explicit authorization satisfies this requirement.
