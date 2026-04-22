export function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowlist = String(env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  if (!(allowlist.length === 1 && allowlist[0] === "*")) {
    if (allowlist.includes(origin)) {
      allowOrigin = origin;
    } else {
      allowOrigin = allowlist[0] || "null";
    }
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function handleCors(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request, env)
    });
  }
  return null;
}
