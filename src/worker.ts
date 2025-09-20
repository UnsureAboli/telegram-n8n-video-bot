import type { Env } from "./types/env";
import { KvChatStateRepository } from "./infrastructure/kvChatStateRepository";
import { TelegramApi } from "./infrastructure/telegramApi";
import { N8nClient } from "./infrastructure/n8nClient";
import { TelegramUpdateProcessor } from "./application/telegramUpdateProcessor";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, name: "tg-n8n-proxy-bot" });
      }

      if (request.method === "POST" && url.pathname === "/webhook") {
        // Validate secret token if provided
        const secret = env.TELEGRAM_SECRET_TOKEN;
        if (secret) {
          const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
          if (header !== secret) {
            return new Response("Forbidden", { status: 403 });
          }
        }

        const update = await request.json();

        const repo = new KvChatStateRepository(env.CHAT_STATES);
        const tg = new TelegramApi(env);
        const n8n = new N8nClient(env.N8N_WEBHOOK_URL);
        const processor = new TelegramUpdateProcessor(repo, tg, n8n);

        await processor.handleUpdate(update);
        return json({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: any) {
      return json({ ok: false, error: String(err?.message || err) }, 500);
    }
  },
};

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
