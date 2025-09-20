export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
}

export function validateYouTubeMetadata(meta: Partial<YouTubeMetadata>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!meta.title || meta.title.trim().length === 0) errors.push("عنوان الزامی است");
  if (!meta.description || meta.description.trim().length === 0) errors.push("توضیحات الزامی است");
  if (!meta.tags || meta.tags.length === 0) errors.push("حداقل یک تگ لازم است");
  if ((meta.title || "").length > 100) errors.push("عنوان حداکثر 100 کاراکتر");
  if ((meta.description || "").length > 5000) errors.push("توضیحات حداکثر 5000 کاراکتر");
  if ((meta.tags || []).length > 30) errors.push("حداکثر 30 تگ مجاز است");
  return { ok: errors.length === 0, errors };
}
