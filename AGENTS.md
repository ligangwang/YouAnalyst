<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Firestore collection changes

Ask the user to confirm the exact name and purpose before creating any new Firestore collection. Explicit authorization in the current conversation satisfies this requirement. Never infer permission for additional collections from a related task.

Before merging a PR, inspect its reviews and review comments, address actionable findings, and review the final diff. Passing CI alone is not a code review.
