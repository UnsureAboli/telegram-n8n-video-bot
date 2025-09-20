export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  N8N_WEBHOOK_URL: string;
  CHAT_STATES: KVNamespace;
}
