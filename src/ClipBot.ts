import { google, youtube_v3 } from "googleapis";
import axios from "axios";
import dotenv from 'dotenv';
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
console.log("Loaded API Keys:", process.env.YOUTUBE_API_KEY_1, process.env.YOUTUBE_API_KEY_2);

const API_KEYS = [process.env.YOUTUBE_API_KEY_1!, process.env.YOUTUBE_API_KEY_2!].filter(Boolean);
if (API_KEYS.length === 0) throw new Error("No YouTube API keys found!");

const CHANNEL_ID = process.env.CHANNEL_ID!;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const POLL_INTERVAL = 150000000;
const CLIP_DURATION = 30;
const CLIP_COOLDOWN = 30 * 1000;

let keyIndex = 0;
let liveChatId: string = "";
let streamStartTime: Date | null = null;
let lastMessageTimestamp = "";
let lastClipTimestamp = 0;
let currentVideoId: string | null = null;
let streamTitle: string | null = null;
let nextPageToken: any = undefined;
let pollingInterval = POLL_INTERVAL;

function getYouTubeClient() {
  return google.youtube({
    version: "v3",
    auth: API_KEYS[keyIndex],
  });
}

async function makeYouTubeRequest<T>(fn: (client: youtube_v3.Youtube) => Promise<T>): Promise<T> {
  const maxRetries = API_KEYS.length;
  let attempts = 0;

  while (attempts < maxRetries) {
    const youtube = getYouTubeClient();
    try {
      return await fn(youtube);
    } catch (error: any) {
      if (error.code === 403 && error.errors?.some((e: any) => e.reason === "quotaExceeded")) {
        console.warn(`⚠️ Quota exceeded for API key ${keyIndex + 1}, switching to next...`);
        keyIndex = (keyIndex + 1) % API_KEYS.length;
        attempts++;
        continue;
      } else {
        throw error;
      }
    }
  }
  throw new Error("❌ All API keys have exceeded their quota.");
}

function formatTime(seconds: number): string {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

async function getLiveBroadcast(): Promise<void> {
  const res = await makeYouTubeRequest(youtube =>
    youtube.search.list({
      part: ["snippet"],
      channelId: CHANNEL_ID,
      eventType: "live",
      type: ["video"],
      maxResults: 1,
    })
  );

  const live = res.data.items?.[0];
  if (!live) throw new Error("❌ No live broadcast found.");

  const videoId = live.id?.videoId!;
  currentVideoId = videoId;
  streamTitle = live.snippet?.title || "Untitled Stream";

  const videoRes = await makeYouTubeRequest(youtube =>
    youtube.videos.list({
      part: ["liveStreamingDetails"],
      id: [videoId],
    })
  );

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
    const res = await makeYouTubeRequest(youtube =>
      youtube.liveChatMessages.list({
        liveChatId,
        part: ["snippet", "authorDetails"],
        pageToken: nextPageToken,
      })
    );

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
