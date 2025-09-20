import type { Env } from "../types/env";

export type ReplyMarkup = { keyboard?: any; inline_keyboard?: any; remove_keyboard?: boolean; selective?: boolean };

export interface SendMessageOptions {
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
  reply_markup?: ReplyMarkup;
}

export class TelegramApi {
  private baseUrl: string;

  constructor(env: Env) {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is required");
    this.baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  }

  async sendMessage(chatId: number, text: string, options: SendMessageOptions = {}) {
    return this.request("sendMessage", { chat_id: chatId, text, ...options });
  }

  async sendChatAction(chatId: number, action: string) {
    return this.request("sendChatAction", { chat_id: chatId, action });
  }

  async getMe(): Promise<{ id: number; is_bot: boolean; first_name?: string; username?: string }> {
    const resp = await this.request("getMe", {});
    try {
      const json = (await resp.json()) as any;
      // Telegram returns: { ok: boolean, result: { ... } }
      return json?.result ?? {};
    } catch {
      return { id: 0, is_bot: true } as any;
    }
  }

  async getFile(file_id: string): Promise<{ ok: boolean; result?: { file_id: string; file_unique_id?: string; file_size?: number; file_path?: string }; description?: string; status?: number }> {
    const resp = await this.request("getFile", { file_id });
    const status = resp.status;
    try {
      const json = (await resp.json()) as any;
      if (json?.ok) return { ok: true, result: json.result, status };
      return { ok: false, description: json?.description, status };
    } catch {
      return { ok: false, description: "Failed to parse getFile response", status };
    }
  }

  private async request(method: string, body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}/${method}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return resp;
  }
}
