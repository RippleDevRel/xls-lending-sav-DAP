import { NextRequest, NextResponse } from "next/server";

/**
 * Renders a minimal Swagger UI for `/api/openapi`. Loaded from the
 * official CDN so we don't ship any UI dependency. Public — no auth.
 *
 * The CSP set in middleware uses `strict-dynamic`, so both <script> tags
 * must carry the per-request nonce (read from the `x-nonce` request header)
 * or the browser will refuse to run them.
 */
export function GET(request: NextRequest) {
  const nonce = request.headers.get("x-nonce") ?? "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>XLS-66 Lending API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>body{margin:0}#ui{min-height:100vh}</style>
  </head>
  <body>
    <div id="ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin nonce="${nonce}"></script>
    <script nonce="${nonce}">
      window.addEventListener("load", () => {
        window.ui = SwaggerUIBundle({
          url: "/api/openapi",
          dom_id: "#ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
        });
      });
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
