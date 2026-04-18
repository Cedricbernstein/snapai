const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname)));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const styleHints = {
  auto:      "Detect and replicate the style ENTIRELY from the reference images.",
  minimal:   "Style: clean white studio background, soft diffused overhead light, minimal composition.",
  nature:    "Style: tropical leaves, natural stones, warm sunlight, organic botanical atmosphere.",
  luxury:    "Style: dark moody black background, marble surface, dramatic warm spotlight, deep shadows.",
  lifestyle: "Style: bathroom counter, soft window light, authentic everyday lifestyle environment.",
};

function extractJSON(text) {
  // Find outermost { } and parse
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (start === -1 || end === -1) throw new Error("Kein JSON in Antwort gefunden");
  return JSON.parse(text.slice(start, end + 1));
}

app.post("/api/analyze", async (req, res) => {
  const { refs, prod, style } = req.body;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt." });

  const refParts = refs.map(r => ({
    type: "image",
    source: { type: "base64", media_type: r.mime, data: r.data }
  }));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: `You are a product photography prompt engineer. Output ONLY raw JSON, no markdown, no backticks, no explanation:
{"styleAnalysis":"one sentence","prompt":"150-word detailed scene description matching the reference photo style exactly. Describe background material, lighting angle and quality, color palette, props, shadows, mood. End with: Place the product shown in the last input image into this exact scene, keeping every detail of the product identical."}`,
        messages: [{
          role: "user",
          content: [
            ...refParts,
            { type: "image", source: { type: "base64", media_type: prod.mime, data: prod.data } },
            { type: "text", text: `Reference style images: first ${refs.length}. Product image: last. ${styleHints[style] || styleHints.auto} Reply with raw JSON only.` }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || "Claude Fehler" });

    const raw = data.content[0].text;
    console.log("Claude raw:", raw.substring(0, 200));

    try {
      const parsed = extractJSON(raw);
      if (!parsed.prompt) throw new Error("Kein Prompt im JSON");
      res.json(parsed);
    } catch (parseErr) {
      console.error("Parse error:", parseErr.message, "Raw:", raw.substring(0, 500));
      res.status(500).json({ error: "JSON Parse Fehler: " + parseErr.message });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  const { prompt, productImageBase64, productImageMime, angle } = req.body;
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY fehlt in Railway Variables." });

  const fullPrompt = `${prompt} Camera angle: ${angle || "front view, centered"}. Photorealistic commercial product photography, 8k quality.`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: fullPrompt,
        n: 1,
        size: "1024x1536"
      })
    });

    const openaiData = await openaiRes.json();
    console.log("OpenAI status:", openaiRes.status);

    if (!openaiRes.ok) {
      return res.status(500).json({ error: openaiData.error?.message || "OpenAI Fehler" });
    }

    const b64 = openaiData.data?.[0]?.b64_json;
    const url = openaiData.data?.[0]?.url;

    if (b64) return res.json({ imageUrl: `data:image/png;base64,${b64}` });
    if (url) return res.json({ imageUrl: url });

    return res.status(500).json({ error: "Kein Bild von OpenAI erhalten" });

  } catch (e) {
    console.error("Generate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log("SnapAI running on port " + PORT));
