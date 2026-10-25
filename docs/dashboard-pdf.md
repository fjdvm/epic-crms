# Dashboard PDF export

`GET /api/dashboard/pdf?period=today` downloads the Dashboard as a PDF. It accepts the same presets as the page: `today`, `7-days`, `this-month`, `last-month`, `90-days`. Missing or unknown values fall back to `7-days`.

The route requires the Dashboard Module before reading any data. It checks the data Modules through the Portal and passes only the held Modules to `loadDashboardFigures`, also used by the page. The renderer consumes that result without querying data or recalculating business figures. Analytics share the existing five-minute cache; Needs attention remains live. The page uses the loader's `stream: true` option to await each widget separately; the PDF awaits the complete set. PDF responses are `private, no-store`.

The document includes the existing `public/images/bren-raphaels-logo.svg`, Philippine dates and generation time, permitted widgets as text and bars, and explicit notes for failed widgets. An embedded DejaVu Sans font keeps peso signs readable without depending on installed server fonts. Its license is beside the font. No CSV route is provided.

The Dashboard header's Export button downloads the selected period directly, without confirmation. It shows `Exporting…` and disables repeat clicks until the response body is ready. A failed request, interrupted download or non-PDF response shows an inline error and allows another attempt. It uses the route's filename and releases the temporary download URL after starting the download. The page and route both require the Dashboard Module. Render tests cover the busy state, successful download, failures and retry.

Route tests parse the actual PDF to check figures, periods, omissions and failures, and check access refusal before data reads. Layout is reviewed manually rather than asserted by tests.

Spec: [#211](https://github.com/fjdvm/epic-crms/issues/211), part of [#200](https://github.com/fjdvm/epic-crms/issues/200).

Design reference: [Bren Raphael's CRM Dashboard](https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=2-2).
