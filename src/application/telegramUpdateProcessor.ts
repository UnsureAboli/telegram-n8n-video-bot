import type { ChatState, WizardStep } from "../domain/models";
import type { ChatStateRepository } from "../domain/repositories";
import { TelegramApi } from "../infrastructure/telegramApi";
import { N8nClient } from "../infrastructure/n8nClient";

// Minimal Telegram types used in this app
export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}
export interface TgChat { id: number; type: string; }
export interface TgVideo { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string; file_size?: number }
export interface TgDocument { file_id: string; file_unique_id?: string; mime_type?: string; file_name?: string; file_size?: number }
export interface TgMessageEntity {
  offset: number;
  length: number;
  type: "mention" | "text_mention" | string;
  user?: TgUser; // for text_mention
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  video?: TgVideo;
  document?: TgDocument;
  entities?: TgMessageEntity[];
  caption?: string;
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
}
export interface TgUpdate { update_id: number; message?: TgMessage }

export class TelegramUpdateProcessor {
  constructor(
    private repo: ChatStateRepository,
    private tg: TelegramApi,
    private n8n: N8nClient,
  ) {}

  private botUsername?: string;
  private botId?: number;

  private async ensureBotIdentity(): Promise<void> {
    if (this.botUsername && this.botId) return;
    const me = await this.tg.getMe();
    this.botUsername = me?.username || undefined;
    this.botId = me?.id || undefined;
  }

  async handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const caption = (msg.caption || "").trim();
    const content = text || caption; // prefer text, fallback to caption
    const chatType = msg.chat.type || "";

    // Group handling: only react if bot is mentioned
    if (chatType === "group" || chatType === "supergroup") {
      await this.ensureBotIdentity();
      const mentioned = this.isMentioned(msg, this.botUsername, this.botId);
      if (!mentioned) {
        // Ignore any non-mentioned message in groups
        return;
      }

      // If mentioned and a template-style message is present, try to parse and send directly
      if (content) {
        const parsed = parseGroupTemplate(content, this.botUsername);
        if (parsed && parsed.title && parsed.description && parsed.tags && parsed.tags.length > 0) {
          await this.tg.sendChatAction(chatId, "typing");
          // Prefer file_id from the replied message (explicit selection), then fallback to current message
          const repliedVideoId = msg.reply_to_message?.video?.file_id
            || (msg.reply_to_message?.document?.mime_type?.startsWith("video/") ? msg.reply_to_message?.document?.file_id : undefined);
          const currentVideoId = msg.video?.file_id
            || (msg.document?.mime_type?.startsWith("video/") ? msg.document?.file_id : undefined);
          // If template contains a source_link, require reply-based selection to avoid ambiguity
          const videoFileId = parsed.source_link ? repliedVideoId : (repliedVideoId || currentVideoId);
          console.log("group-parse", { chatId, mentioned, hasSourceLink: !!parsed.source_link, repliedVideoId: !!repliedVideoId, currentVideoId: !!currentVideoId, chosen: !!videoFileId });
          if (!videoFileId) {
            await this.tg.sendMessage(
              chatId,
              parsed.source_link
                ? "برای این پیام که لینک منبع دارد، حتما باید روی پیام ویدیوی تلگرام REPLY بزنید تا همان ویدیو انتخاب شود."
                : "برای ارسال به n8n لازم است ویدیوی تلگرام را ضمیمه کنید یا پیام شما ریپلایِ مستقیم به پیامِ ویدیوی تلگرام باشد.",
              { reply_to_message_id: msg.message_id }
            );
            return;
          }
          // Validate file_id with Telegram getFile to avoid wrong/temporary unavailable issues
          const fileCheck = await this.tg.getFile(videoFileId);
          if (!fileCheck.ok) {
            await this.tg.sendMessage(
              chatId,
              `خطا در دریافت فایل از تلگرام: ${fileCheck.description || "file_id نامعتبر یا فایل موقتاً در دسترس نیست"}.\nلطفاً ویدیو را مستقیماً در همین گروه ارسال کنید و سپس روی همان پیام REPLY کرده و قالب را بفرستید.`,
              { reply_to_message_id: msg.message_id }
            );
            return;
          }

          // Final validation before sending to n8n
          if (!videoFileId || videoFileId.trim().length === 0) {
            await this.tg.sendMessage(
              chatId,
              "خطای داخلی: file_id ویدیو خالی است. لطفاً دوباره تلاش کنید.",
              { reply_to_message_id: msg.message_id }
            );
            console.error("Empty videoFileId detected before n8n send", { chatId, videoFileId });
            return;
          }

          const payload = {
            chat_id: chatId,
            from: msg.from ? { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name, last_name: msg.from.last_name, language_code: msg.from.language_code } : undefined,
            message_id: msg.message_id,
            date: msg.date,
            video: { 
              file_id: videoFileId,
              file_path: fileCheck.result?.file_path,
              file_size: fileCheck.result?.file_size
            },
            title: parsed.title,
            description: parsed.description,
            tags: parsed.tags,
            source_link: parsed.source_link,
            channel: parsed.channel,
          };
          
          // Log payload details for debugging
          console.log("Sending to n8n:", {
            chat_id: payload.chat_id,
            video_file_id: payload.video.file_id,
            title: payload.title,
            has_source_link: !!payload.source_link,
            has_channel: !!payload.channel
          });
          const resp = await this.n8n.sendVideo(payload);
          if (resp.ok) {
            console.log("n8n success", { chatId, video_file_id: videoFileId });
            await this.tg.sendMessage(chatId, "درخواست شما ثبت شد و به n8n ارسال گردید. ✅", { reply_to_message_id: msg.message_id });
          } else {
            const body = await safeReadText(resp);
            console.error("n8n error", { chatId, video_file_id: videoFileId, status: resp.status, body });
            await this.tg.sendMessage(chatId, `ارسال به n8n با خطا مواجه شد (HTTP ${resp.status}).\n${body?.slice(0, 400) || ""}`, { reply_to_message_id: msg.message_id });
          }
          return;
        } else {
          // Mentioned but template invalid -> provide brief guidance
          await this.tg.sendMessage(chatId, guidanceTemplate(), { reply_to_message_id: msg.message_id });
          return;
        }
      }
      // No text to parse: inform user and provide guidance
      await this.tg.sendMessage(
        chatId,
        "پیام شما قابل‌خواندن نبود. لطفاً قالب را به صورت متن در یک پیام ارسال کنید.\n\n" + guidanceTemplate(),
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    // Commands available at any time
    if (text === "/start") {
      await this.repo.delete(chatId);
      await this.repo.save({ chatId, step: "awaiting_video", updatedAt: Date.now() });
      await this.tg.sendMessage(chatId, this.msgWelcome());
      return;
    }
    if (text === "/cancel" || text.toLowerCase() === "cancel" || text === "لغو") {
      await this.repo.delete(chatId);
      await this.tg.sendMessage(chatId, "روند فعلی لغو شد. برای شروع دوباره، /start را بزنید.");
      return;
    }

    let state = await this.repo.get(chatId);

    // If user sends a video without starting, start flow
    if (!state && msg.video) {
      state = { chatId, step: "awaiting_title", video_file_id: msg.video.file_id, updatedAt: Date.now() };
      await this.repo.save(state);
      await this.tg.sendMessage(chatId, "عنوان ویدیو را ارسال کنید:");
      return;
    }

    if (!state) {
      await this.tg.sendMessage(chatId, "برای شروع فرآیند آپلود، ابتدا /start را ارسال کنید و سپس ویدیو را بفرستید.");
      return;
    }

    switch (state.step) {
      case "awaiting_video":
        if (msg.video?.file_id) {
          state.video_file_id = msg.video.file_id;
          state.step = "awaiting_title";
          state.updatedAt = Date.now();
          await this.repo.save(state);
          await this.tg.sendMessage(chatId, "عنوان ویدیو را ارسال کنید:");
        } else {
          await this.tg.sendMessage(chatId, "لطفاً ابتدا ویدیو را ارسال کنید (نه فایل اسناد).\nمی‌توانید ویدیو را مستقیماً در چت بفرستید.");
        }
        break;

      case "awaiting_title":
        if (text) {
          state.title = limit(text, 100);
          state.step = "awaiting_description";
          state.updatedAt = Date.now();
          await this.repo.save(state);
          await this.tg.sendMessage(chatId, "توضیحات ویدیو را ارسال کنید:");
        } else {
          await this.tg.sendMessage(chatId, "عنوان نامعتبر است. لطفاً یک متن ارسال کنید.");
        }
        break;

      case "awaiting_description":
        if (text) {
          state.description = limit(text, 5000);
          state.step = "awaiting_tags";
          state.updatedAt = Date.now();
          await this.repo.save(state);
          await this.tg.sendMessage(chatId, "تگ‌ها را با ویرگول جدا کنید.\nمثال: آموزش, برنامه نویسی, جاوااسکریپت");
        } else {
          await this.tg.sendMessage(chatId, "توضیحات نامعتبر است. لطفاً یک متن ارسال کنید.");
        }
        break;

      case "awaiting_tags":
        if (text) {
          const tags = parseTags(text);
          if (tags.length === 0) {
            await this.tg.sendMessage(chatId, "حداقل یک تگ وارد کنید (با ویرگول جدا کنید).");
            return;
          }
          state.tags = tags;
          state.step = "awaiting_confirm";
          state.updatedAt = Date.now();
          await this.repo.save(state);
          await this.tg.sendMessage(chatId, this.msgConfirm(state));
        } else {
          await this.tg.sendMessage(chatId, "ورودی نامعتبر. لطفاً تگ‌ها را با ویرگول جدا کنید.");
        }
        break;

      case "awaiting_confirm":
        if (text === "/confirm" || text.toLowerCase() === "confirm" || text === "تایید") {
          if (!state.video_file_id || !state.title || !state.description || !state.tags) {
            await this.tg.sendMessage(chatId, "اطلاعات ناقص است. لطفاً از ابتدا /start را ارسال کنید.");
            await this.repo.delete(chatId);
            return;
          }
          await this.tg.sendChatAction(chatId, "typing");
          const payload = {
            chat_id: chatId,
            from: msg.from ? { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name, last_name: msg.from.last_name, language_code: msg.from.language_code } : undefined,
            message_id: msg.message_id,
            date: msg.date,
            video: { file_id: state.video_file_id },
            title: state.title,
            description: state.description,
            tags: state.tags,
          };
          const resp = await this.n8n.sendVideo(payload);
          if (resp.ok) {
            await this.tg.sendMessage(chatId, "درخواست با موفقیت برای n8n ارسال شد. منتظر آپلود یوتیوب بمانید.\nبرای شروع دوباره، /start را بزنید.");
            await this.repo.delete(chatId);
          } else {
            const body = await safeReadText(resp);
            await this.tg.sendMessage(chatId, `ارسال به n8n با خطا مواجه شد (HTTP ${resp.status}).\n${body?.slice(0, 400) || ""}`);
          }
        } else if (text === "/cancel" || text.toLowerCase() === "cancel" || text === "لغو") {
          await this.repo.delete(chatId);
          await this.tg.sendMessage(chatId, "لغو شد. برای شروع دوباره، /start را بزنید.");
        } else {
          await this.tg.sendMessage(chatId, "برای تایید، کلمه confirm یا /confirm را ارسال کنید. برای لغو، cancel یا /cancel.");
        }
        break;

      default:
        await this.repo.delete(chatId);
        await this.tg.sendMessage(chatId, "حالت ناشناخته. لطفاً /start را ارسال کنید.");
        break;
    }
  }

  private msgWelcome(): string {
    return [
      "سلام! 👋",
      "این ربات اطلاعات ویدیو را جمع‌آوری می‌کند و برای n8n می‌فرستد تا در یوتیوب آپلود شود.",
      "لطفاً ویدیوی خود را ارسال کنید تا شروع کنیم.",
      "برای لغو در هر مرحله: /cancel",
    ].join("\n");
  }

  private msgConfirm(state: ChatState): string {
    const tagsStr = (state.tags || []).map((t) => `#${t}`).join(" ");
    return [
      "لطفاً اطلاعات زیر را بررسی کنید:",
      `عنوان: ${state.title || "-"}`,
      `توضیحات: ${state.description || "-"}`,
      `تگ‌ها: ${tagsStr || "-"}`,
      "اگر مورد تایید است، confirm یا /confirm را ارسال کنید. برای لغو: cancel یا /cancel",
    ].join("\n");
  }

  // Determine if the message mentions the bot (by @username or text_mention entity)
  // Falls back to scanning text for @username if entities are missing
  private isMentioned(msg: TgMessage, botUsername?: string, botId?: number): boolean {
    if (!botUsername && !botId) return false;
    const entities = (msg.entities || []).concat(msg.caption_entities || []);
    const text = msg.text || msg.caption || "";
    for (const e of entities) {
      if (e.type === "text_mention" && e.user?.id && botId && e.user.id === botId) return true;
      if (e.type === "mention" && botUsername && text) {
        const at = text.substring(e.offset, e.offset + e.length);
        if (at.toLowerCase() === ("@" + botUsername).toLowerCase()) return true;
      }
    }
    if (botUsername && text) {
      return text.toLowerCase().includes(("@" + botUsername).toLowerCase());
    }
    return false;
  }
}

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^#/, ""))
    .slice(0, 30);
}

function limit(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

async function safeReadText(resp: Response): Promise<string | null> {
  try { return await resp.text(); } catch { return null; }
}

// Parse Persian template from a single message text
// Expected sections (order tolerant):
// "آپلود" (next non-empty line = source_link),
// "کانال:" (next lines until next header = channel),
// "عنوان:" (next non-empty line = title),
// "توضیح:" (collect until next header = description),
// "تگ ها:" or "تگ‌ها:" (next lines = tags string)
function parseGroupTemplate(input: string, botUsername?: string): { source_link?: string; channel?: string; title?: string; description?: string; tags?: string[] } | null {
  // Remove bot mention to not interfere with header matching
  let text = input;
  if (botUsername) {
    const re = new RegExp("@" + escapeRegExp(botUsername), "ig");
    text = text.replace(re, "");
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  let section: "none" | "upload" | "channel" | "title" | "desc" | "tags" = "none";
  let source_link: string | undefined;
  let channel: string[] = [];
  let title: string | undefined;
  let desc: string[] = [];
  let tagsRaw: string[] = [];

  const isHeader = (s: string): "upload" | "channel" | "title" | "desc" | "tags" | null => {
    const t = s.replace(/[:：]/g, "").trim();
    if (/^آپلود$/i.test(t)) return "upload";
    if (/^کانال$/i.test(t)) return "channel";
    if (/^عنوان$/i.test(t)) return "title";
    if (/^توضیح$/i.test(t)) return "desc";
    if (/^تگ(\s*|‌)?ها$/i.test(t) || /^تگ$/i.test(t)) return "tags"; // supports تگ ها / تگ‌ها / تگ
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = isHeader(l);
    if (h) { section = h; continue; }
    switch (section) {
      case "upload":
        if (!source_link && isUrl(l)) source_link = l;
        break;
      case "channel":
        channel.push(l);
        break;
      case "title":
        if (!title) title = l;
        break;
      case "desc":
        desc.push(l);
        break;
      case "tags":
        tagsRaw.push(l);
        break;
      default:
        // Allow a compact form where the first line is آپلود and the second is URL, else ignore
        break;
    }
  }

  const tags = splitTags(tagsRaw.join(" "));
  const result = {
    source_link,
    channel: channel.join(" ") || undefined,
    title: title?.slice(0, 100),
    description: desc.join("\n").slice(0, 5000) || undefined,
    tags: tags.length ? tags.slice(0, 30) : undefined,
  };
  if (!result.title && !result.description && (!result.tags || result.tags.length === 0)) return null;
  return result;
}

function splitTags(s: string): string[] {
  if (!s) return [];
  return s
    .split(/[,،\n]+|\s*و\s*|\s*and\s*/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/^#/, ""));
}

function isUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function guidanceTemplate(): string {
  return [
    "لطفاً پیام خود را با منشن کردن ربات و در قالب زیر ارسال کنید:",
    "",
    "@BOT_USERNAME",
    "آپلود",
    "https://t.me/YOUR_CHANNEL/MESSAGE_ID (اختیاری)",
    "",
    "کانال:",
    "نام کانال شما",
    "",
    "عنوان:",
    "عنوان ویدیو",
    "",
    "توضیح:",
    "توضیحات ویدیو",
    "",
    "تگ ها:",
    "تگ۱ و تگ۲ و تگ۳",
    "",
    "نکات:",
    "- لینک در بخش آپلود اختیاری است.",
    "- تگ‌ها را می‌توانید با ویرگول، 'و' یا سطر جدید جدا کنید.",
    "- برای اطمینان از انتخاب ویدیوی درست، روی پیامِ ویدیوی تلگرام REPLY بزنید و این قالب را به همراه منشن ارسال کنید.",
  ].join("\n");
}
