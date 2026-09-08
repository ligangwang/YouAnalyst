# Visitor-to-registration experiment

Baseline reported by owner on September 8, 2026: seven internal testers,
zero external registrations. External visitor count, sources and observation
window are not yet verified. No conversion-rate improvement is claimed.

## Outcome

Primary conversion: a new external visitor creates a YouAnalyst account,
for any reason. Saving a company and publishing a prediction are separate
activation measures, not requirements for counting a registration.

Reconcile new accounts with production registration records and exclude the
seven testers. Report external registrations divided by external visitors for
the same period, with counts alongside percentages. GA4 events may be blocked
or lost; they do not replace the registration records.

## First experiment

Audience hypothesis: individual investors researching companies behind AI.
Offer supported by the current product: inspect company relationships and SEC
filing evidence, then create a personal list of companies to revisit.
Do not imply that saving provides change alerts or live holdings monitoring.

Inspect this path on mobile and desktop with production data:
company link -> filing evidence -> create account to save -> authentication ->
selected company. Currently saving requires a second explicit click after
authentication. Observe whether that causes abandonment before changing it.

The auth page now measures `auth_view` once per mounted page for signed-out
visitors after account loading finishes. `entry_point` is `map_save`,
`prediction`, or `general`, and accompanies authentication attempts and outcomes.
No raw destination, email or account ID is included.

In GA4, inspect users reaching `auth_view` -> `auth_start` -> `sign_up`,
with intervening events allowed, grouped by source and device. Also inspect
map load -> save intent -> auth view. Do not require map engagement in the
sitewide conversion definition: users can join through other pages.

## Seven-day execution

1. Verify production signup and analytics delivery; obtain external visitor and
   new-account counts for the previous seven days. Review this change before release.
2. Inspect one company's live evidence, choose one useful supported finding,
   and prepare a post linking directly to that company with campaign parameters.
3. Publish the reviewed post through an authorized account. Choose a relevant
   community and check its current participation and self-promotion rules first.
4. Review visitor arrival, save intent, auth views, attempts and errors. Reply
   to real questions and collect reasons people did or did not create accounts.
5. Fix the largest observed obstacle. With a tiny sample, use direct observations
   and avoid claiming statistical significance or splitting traffic into an A/B test.
6. Publish a second verified example if the first reached interested readers.
   Follow up only with people who engaged and where contact is authorized.
7. Reconcile external registrations, report the funnel counts and feedback,
   and decide whether to change the audience, offer or signup experience.

## Draft outreach

X draft, after checking the live NVDA map's TSMC evidence on September 8, 2026:

> Who makes NVIDIA's chips? Its 10-K names TSMC as a foundry. I built YouAnalyst
> to explore these connections with filing evidence. Start with NVDA; create
> an account to save companies for later.
> https://youanalyst.com/?company=NVDA&utm_source=x&utm_medium=social&utm_campaign=first_external_user

For Reddit, first choose a community that permits builder feedback posts.
Draft title: "Feedback on an AI company map built from SEC filing evidence".
Disclose ownership, show a verified example, explain coverage limitations,
and ask for specific feedback. Include a site link only where permitted.

## Access and current status

First useful access: the production GA4 property and read access to registration
counts. Social accounts come after the conversion path is verified. Use connected
accounts or signed-in browser sessions; do not put passwords or tokens in this doc.
Public posts and direct messages require explicit authorization for sending.

On September 8, an existing browser session provided read access to production GA4.
Firebase listed the project but opening it returned an access/project error, so
registration counts remain unverified. Private analytics observations are kept outside the public repository.
The live NVDA map loaded, exposed TSMC evidence from its February 25, 2026 10-K,
and linked to registration with NVDA preserved as the destination.

This file is an execution checklist, not a scheduled job. No production release,
GA4 configuration, completed live signup or outreach is implied by local tests.
