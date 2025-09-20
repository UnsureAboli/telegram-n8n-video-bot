import type { ChatStateRepository } from "../domain/repositories";
import type { ChatState } from "../domain/models";

export class KvChatStateRepository implements ChatStateRepository {
  private prefix = "chatstate:";
  constructor(private kv: KVNamespace) {}

  async get(chatId: number): Promise<ChatState | null> {
    const key = this.key(chatId);
    const json = await this.kv.get(key);
    if (!json) return null;
    try {
      return JSON.parse(json) as ChatState;
    } catch {
      return null;
    }
  }

  async save(state: ChatState): Promise<void> {
    const key = this.key(state.chatId);
    await this.kv.put(key, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 2 }); // 2 days TTL
  }

  async delete(chatId: number): Promise<void> {
    const key = this.key(chatId);
    await this.kv.delete(key);
  }

  private key(chatId: number): string {
    return `${this.prefix}${chatId}`;
  }
}
