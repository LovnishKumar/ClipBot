import { google } from "googleapis";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const youtube = google.youtube({
  version: "v3",
  auth: process.env.YOUTUBE_API_KEY,
});

const CHANNEL_ID = process.env.CHANNEL_ID!;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const POLL_INTERVAL = 15000;
const CLIP_DURATION = 30;
const CLIP_COOLDOWN = 30 * 1000;

let liveChatId: string | null = null;
let streamStartTime: Date | null = null;
let lastMessageTimestamp = "";
let lastClipTimestamp = 0;
let currentVideoId: string | null = null;
let streamTitle: string | null = null;
let nextPageToken: any = undefined;
let pollingInterval = POLL_INTERVAL;

function formatTime(seconds: number): string {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

async function getLiveBroadcast(): Promise<void> {
  const res = await youtube.search.list({
    part: ["snippet"],
    channelId: CHANNEL_ID,
    eventType: "live",
    type: ["video"],
    maxResults: 1,
  });

  const live = res.data.items?.[0];
  if (!live) throw new Error("❌ No live broadcast found.");

  const videoId = live.id?.videoId!;
  currentVideoId = videoId;
  streamTitle = live.snippet?.title || "Untitled Stream";

  const videoRes = await youtube.videos.list({
    part: ["liveStreamingDetails"],
    id: [videoId],
  });

  const details = videoRes.data.items?.[0]?.liveStreamingDetails;
  if (!details?.activeLiveChatId || !details.actualStartTime) {
    throw new Error("❌ Missing live stream details.");
  }

  streamStartTime = new Date(details.actualStartTime);
  liveChatId = details.activeLiveChatId;

  console.log("🎥 Live Video ID:", videoId);
  console.log("📺 Stream Title:", streamTitle);
  console.log("⏱️ Stream Started At:", streamStartTime.toISOString());
}

async function pollChat(): Promise<void> {
  if (!liveChatId || !streamStartTime || !currentVideoId) return;

  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId,
      part: ["snippet", "authorDetails"],
      pageToken: nextPageToken,
    });

    nextPageToken = res.data.nextPageToken;
    pollingInterval = res.data.pollingIntervalMillis || POLL_INTERVAL;

    const messages = res.data.items || [];

    for (const msg of messages) {
      const msgTime = new Date(msg.snippet?.publishedAt!);
      const text = msg.snippet?.displayMessage!;
      const author = msg.authorDetails?.displayName || "Unknown";

      if (msgTime <= new Date(lastMessageTimestamp)) continue;
      lastMessageTimestamp = msg.snippet?.publishedAt!;

      if (text.toLowerCase().startsWith("!clip")) {
        const now = Date.now();
        if (now - lastClipTimestamp < CLIP_COOLDOWN) {
          console.log("⏱ Cooldown active. Ignoring duplicate `!clip`.");
          continue;
        }

        lastClipTimestamp = now;

        const elapsedSec = Math.floor(
          (msgTime.getTime() - streamStartTime.getTime()) / 1000
        );
        const start = Math.max(elapsedSec - CLIP_DURATION, 0);
        const end = elapsedSec + CLIP_DURATION;

        const formattedStart = formatTime(start);
        const formattedEnd = formatTime(end);
        const videoLink = `https://youtu.be/${currentVideoId}?t=${start}`;

        // Parse optional custom title
        const parts = text.trim().split(" ");
        const customTitle = parts.slice(1).join(" ");
        const titleText = customTitle || "Untitled Clip";

        const message = `🎬 **Clip Requested!**\n👤 By: ${author}\n📺 Title: **${titleText}**\n⏱ From: \`${formattedStart}\` to \`${formattedEnd}\`\n🔗 [Watch Clip](${videoLink})`;

        console.log(message);
        await sendToDiscord(message);
      }
    }
  } catch (error) {
    console.error("❌ Error polling chat:", (error as any).message);
  }

  setTimeout(pollChat, pollingInterval);
}

async function sendToDiscord(content: string): Promise<void> {
  try {
    await axios.post(WEBHOOK_URL, { content });
  } catch (err) {
    console.error("❌ Discord webhook error:", (err as any).message);
  }
}

async function init(): Promise<void> {
  try {
    await getLiveBroadcast();
    console.log("✅ Bot is now listening for `!clip` commands...");
    pollChat();
  } catch (err) {
    console.error("❌ Bot failed to start:", (err as any).message);
  }
}

init();
