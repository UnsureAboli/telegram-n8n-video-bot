import type { ChatState } from "./models";

export interface ChatStateRepository {
  get(chatId: number): Promise<ChatState | null>;
  save(state: ChatState): Promise<void>;
  delete(chatId: number): Promise<void>;
}
