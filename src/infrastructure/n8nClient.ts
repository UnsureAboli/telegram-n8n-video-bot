export interface N8nVideoPayload {
  chat_id: number;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    language_code?: string;
  };
  message_id?: number;
  date?: number;
  video?: {
    file_id: string;
    file_unique_id?: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
  };
  title: string;
  description: string;
  tags: string[];
  source_link?: string;
  channel?: string;
}

export class N8nClient {
  constructor(private webhookUrl: string) {
    if (!webhookUrl) throw new Error("N8N_WEBHOOK_URL is required");
  }

  async sendVideo(payload: N8nVideoPayload): Promise<Response> {
    const resp = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return resp;
  }
}
