import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== Global CORS for ALL routes (and errors) =====
app.use((req, res, next) => {
  // Allow any origin (you can swap "*" for a specific origin if you want)
  res.set("Access-Control-Allow-Origin", "*");
  // Let the browser send Content-Type/Accept, etc.
  res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  // Methods you support
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  // Some CDNs/proxies cache per-origin; this helps them vary correctly
  res.set("Vary", "Origin");

  // Short-circuit preflight
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/ping", (_req, res) => res.type("text").send("ok"));

// ===== Secrets =====
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const DEFAULT_VOICE_ID = process.env.VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Rachel

if (!ELEVEN_API_KEY) {
  console.warn("[WARN] ELEVEN_API_KEY is missing. Add it in Replit Secrets.");
}
console.log("[INFO] Default VOICE_ID:", DEFAULT_VOICE_ID);

// Simple in-memory cache
const cache = new Map(); // key: voice|stability|similarity|text

// ===== TTS relay =====
app.post("/tts", async (req, res) => {
  try {
    const {
      text,
      voice_id,
      stability = 0.5,
      similarity_boost = 0.75
    } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "Missing 'text'." });
    }
    if (!ELEVEN_API_KEY) {
      return res.status(500).json({ error: "Missing ELEVEN_API_KEY on server" });
    }

    const voiceId = (voice_id && String(voice_id).trim()) || DEFAULT_VOICE_ID;
    const safeText = String(text).slice(0, 500);
    const key = `${voiceId}|${stability}|${similarity_boost}|${safeText}`;

    if (cache.has(key)) {
      res.set("Content-Type", "audio/mpeg");
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(cache.get(key));
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "User-Agent": "ucw-tts-relay/1.0"
      },
      body: JSON.stringify({
        text: safeText,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability, similarity_boost }
      })
    });

    const ct = upstream.headers.get("content-type") || "";
    if (!upstream.ok) {
      const errTxt = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({ error: "TTS provider error", details: errTxt });
    }
    if (!ct.includes("audio")) {
      const body = await upstream.text().catch(() => "");
      return res.status(502).json({ error: "Non-audio response from provider", contentType: ct, body: body.slice(0, 200) });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    cache.set(key, buf);

    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.send(buf);
  } catch (e) {
    console.error("[TTS] server error:", e);
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TTS proxy running on http://localhost:${PORT}`));
