const { json, requireApiKey } = require("./_lib/http");
const { requireAuth } = require("./_lib/auth");

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
  return resp;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return withCors(json(200, { ok: true }));
    if (event.httpMethod !== "GET") return withCors(json(405, { ok: false, error: "Method not allowed" }));

    requireApiKey(event);
    const user = requireAuth(event);

    return withCors(json(200, { ok: true, user }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};
