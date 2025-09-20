export type WizardStep =
  | "awaiting_video"
  | "awaiting_title"
  | "awaiting_description"
  | "awaiting_tags"
  | "awaiting_confirm";

export interface ChatState {
  chatId: number;
  step: WizardStep;
  video_file_id?: string;
  title?: string;
  description?: string;
  tags?: string[];
  updatedAt: number;
}
