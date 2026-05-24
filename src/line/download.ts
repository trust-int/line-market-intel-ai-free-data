import { config } from "../config.js";

export type LineDownloadedContent = {
  body: Buffer;
  mimeType?: string;
  fileName: string;
};

export async function downloadLineMessageContent(
  messageId: string,
  accessToken = config.lineChannelAccessToken
): Promise<LineDownloadedContent> {
  if (!accessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN missing");

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) throw new Error(`LINE content download failed: ${response.status}`);
  const mimeType = response.headers.get("content-type") ?? undefined;
  const extension = extensionFromMime(mimeType);
  const arrayBuffer = await response.arrayBuffer();
  return {
    body: Buffer.from(arrayBuffer),
    mimeType,
    fileName: `${messageId}${extension}`
  };
}

function extensionFromMime(mimeType?: string): string {
  if (!mimeType) return ".bin";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("csv")) return ".csv";
  if (mimeType.includes("json")) return ".json";
  if (mimeType.includes("wordprocessingml")) return ".docx";
  if (mimeType.includes("spreadsheetml")) return ".xlsx";
  if (mimeType.includes("plain")) return ".txt";
  return ".bin";
}
