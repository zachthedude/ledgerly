// Holds the OpenAI key so it never ships to the browser. Forwards only chat + tool definitions,
// pins the model and caps size. ponytail: no per-IP rate limit; add a KV/Durable Object counter if the URL gets abused.
const MAX_BODY = 300_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = { "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return reply(405, { error: "POST only" });
    if (!ok) return reply(403, { error: "Origin not allowed" });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "Request too large" });
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
    if (!Array.isArray(body.messages) || body.messages.length > 60 || !Array.isArray(body.tools)) return reply(400, { error: "Expected messages and tools" });

    const model = env.MODEL || "gpt-5-mini";
    const payload = { model, messages: body.messages, tools: body.tools, max_completion_tokens: 6000 };
    if (/^(gpt-5|o\d)/.test(model)) payload.reasoning_effort = env.REASONING_EFFORT || "low";
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, "Content-Type": "application/json" } });
  }
};
