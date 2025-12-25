import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Global CORS for mobile/browser
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/ping", (_req, res) => res.type("text").send("ok"));

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const DEFAULT_VOICE_ID = process.env.VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Rachel
if (!ELEVEN_API_KEY) console.warn("[WARN] ELEVEN_API_KEY is missing");

const cache = new Map(); // key: voice|stability|similarity|text

app.post("/tts", async (req, res) => {
  try {
    const { text, voice_id, stability = 0.5, similarity_boost = 0.75 } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "Missing 'text'." });
    if (!ELEVEN_API_KEY) return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });

    const voiceId = (voice_id && String(voice_id).trim()) || DEFAULT_VOICE_ID;
    const safeText = String(text).slice(0, 500);

    const key = `${voiceId}|${stability}|${similarity_boost}|${safeText}`;
    if (cache.has(key)) {
      res.set("Content-Type", "audio/mpeg");
      return res.send(cache.get(key));
    }

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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

    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("audio")) {
      const errTxt = await r.text().catch(() => "");
      return res.status(502).json({ error: "TTS provider error", details: errTxt });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    cache.set(key, buf);
    res.set("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (e) {
    console.error("[TTS] server error:", e);
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TTS relay running on port ${PORT}`));
