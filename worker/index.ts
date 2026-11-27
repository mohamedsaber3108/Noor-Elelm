import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
// shortcut: script-src has 'unsafe-inline' because the server renderer writes inline bootstrap and RSC data
// scripts on every page without a per-request nonce; move to nonces when vinext can pass one.
// Fonts and styles still allow Google until the self-hosting question (Q22) is answered.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, async () => {
      // Buffer request bodies up front: caps payload size, and guarantees the stream is fully
      // consumed even when a route rejects early (keeps local Miniflare keep-alive connections healthy).
      let req = request;
      if (request.body) {
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > MAX_BODY_BYTES) return new Response('{"error":"PAYLOAD_TOO_LARGE"}', { status: 413, headers: { "Content-Type": "application/json" } });
        const buf = await request.arrayBuffer();
        if (buf.byteLength > MAX_BODY_BYTES) return new Response('{"error":"PAYLOAD_TOO_LARGE"}', { status: 413, headers: { "Content-Type": "application/json" } });
        req = new Request(request, { body: buf });
      }
      const res = await handler.fetch(req, env, ctx);
      if (import.meta.env.DEV) return res;
      const out = new Response(res.body, res);
      out.headers.set("X-Content-Type-Options", "nosniff");
      out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      out.headers.set("X-Frame-Options", "SAMEORIGIN");
      out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      // Report-only unless CSP_MODE=enforce. No report endpoint exists: violations show in the browser console only.
      const enforce = String((env as unknown as Record<string, unknown>).CSP_MODE || "").toLowerCase() === "enforce";
      out.headers.set(enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", CSP);
      return out;
    });
  },
};

export default worker;
