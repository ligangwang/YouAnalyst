# Stock comparison widget

On the Compare page, select up to ten stocks, apply a date range, and choose a
line or bar race. Select **Embed**, choose a light or dark theme, then select
**Copy embed code**. Paste the iframe into a website that supports HTML embeds.
**Preview widget** opens the same compact view in a new tab.

The localized `/compare/embed` route preserves the stocks, fixed dates, style,
and theme in its URL. It uses the same stored `eod_prices`, `corporate_actions`,
split adjustments, and comparison API as the full page. It creates no saved
comparison documents or additional collections. Corrections to stored history
are reflected when the widget reloads; the URL is not an immutable data snapshot.

The widget includes manual playback, speed, scrubbing, highlighting, the
YouAnalyst watermark inside the chart, and a link to the full comparison.
Pausing and scrubbing snap to a stored close. Values between closes during
playback are explicitly labeled as interpolated. Without WebGL the returns table
opens automatically. Website navigation, account providers, preferences, and
analytics are omitted from the widget view.

The generated iframe loads lazily, fills its container's width, and reserves
height for either animation style. Hosts can adjust its height; expanding the
returns table may require scrolling. The iframe requires no host-side script or
YouAnalyst account. A host with a Content Security Policy must permit the
YouAnalyst origin in `frame-src`. This is a website embed; social posts continue
to use a preview image and link.
