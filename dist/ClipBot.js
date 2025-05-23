"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const googleapis_1 = require("googleapis");
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const youtube = googleapis_1.google.youtube({
    version: "v3",
    auth: process.env.YOUTUBE_API_KEY,
});
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const POLL_INTERVAL = 15000;
const CLIP_DURATION = 30;
const CLIP_COOLDOWN = 30 * 1000;
let liveChatId = null;
let streamStartTime = null;
let lastMessageTimestamp = "";
let lastClipTimestamp = 0;
let currentVideoId = null;
let streamTitle = null;
let nextPageToken = undefined;
let pollingInterval = POLL_INTERVAL;
function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}
function getLiveBroadcast() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const res = yield youtube.search.list({
            part: ["snippet"],
            channelId: CHANNEL_ID,
            eventType: "live",
            type: ["video"],
            maxResults: 1,
        });
        const live = (_a = res.data.items) === null || _a === void 0 ? void 0 : _a[0];
        if (!live)
            throw new Error("❌ No live broadcast found.");
        const videoId = (_b = live.id) === null || _b === void 0 ? void 0 : _b.videoId;
        currentVideoId = videoId;
        streamTitle = ((_c = live.snippet) === null || _c === void 0 ? void 0 : _c.title) || "Untitled Stream";
        const videoRes = yield youtube.videos.list({
            part: ["liveStreamingDetails"],
            id: [videoId],
        });
        const details = (_e = (_d = videoRes.data.items) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.liveStreamingDetails;
        if (!(details === null || details === void 0 ? void 0 : details.activeLiveChatId) || !details.actualStartTime) {
            throw new Error("❌ Missing live stream details.");
        }
        streamStartTime = new Date(details.actualStartTime);
        liveChatId = details.activeLiveChatId;
        console.log("🎥 Live Video ID:", videoId);
        console.log("📺 Stream Title:", streamTitle);
        console.log("⏱️ Stream Started At:", streamStartTime.toISOString());
    });
}
function pollChat() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (!liveChatId || !streamStartTime || !currentVideoId)
            return;
        try {
            const res = yield youtube.liveChatMessages.list({
                liveChatId,
                part: ["snippet", "authorDetails"],
                pageToken: nextPageToken,
            });
            nextPageToken = res.data.nextPageToken;
            pollingInterval = res.data.pollingIntervalMillis || POLL_INTERVAL;
            const messages = res.data.items || [];
            for (const msg of messages) {
                const msgTime = new Date((_a = msg.snippet) === null || _a === void 0 ? void 0 : _a.publishedAt);
                const text = (_b = msg.snippet) === null || _b === void 0 ? void 0 : _b.displayMessage;
                const author = ((_c = msg.authorDetails) === null || _c === void 0 ? void 0 : _c.displayName) || "Unknown";
                if (msgTime <= new Date(lastMessageTimestamp))
                    continue;
                lastMessageTimestamp = (_d = msg.snippet) === null || _d === void 0 ? void 0 : _d.publishedAt;
                if (text.toLowerCase().startsWith("!clip")) {
                    const now = Date.now();
                    if (now - lastClipTimestamp < CLIP_COOLDOWN) {
                        console.log("⏱ Cooldown active. Ignoring duplicate `!clip`.");
                        continue;
                    }
                    lastClipTimestamp = now;
                    const elapsedSec = Math.floor((msgTime.getTime() - streamStartTime.getTime()) / 1000);
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
                    yield sendToDiscord(message);
                }
            }
        }
        catch (error) {
            console.error("❌ Error polling chat:", error.message);
        }
        setTimeout(pollChat, pollingInterval);
    });
}
function sendToDiscord(content) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield axios_1.default.post(WEBHOOK_URL, { content });
        }
        catch (err) {
            console.error("❌ Discord webhook error:", err.message);
        }
    });
}
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield getLiveBroadcast();
            console.log("✅ Bot is now listening for `!clip` commands...");
            pollChat();
        }
        catch (err) {
            console.error("❌ Bot failed to start:", err.message);
        }
    });
}
init();
