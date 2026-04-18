const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname)));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_API_KEY;

const styleHints = {
  auto:      "Detect and replicate the style ENTIRELY from the reference images.",
  minimal:   "Style: clean white studio background, soft diffused overhead light, minimal composition.",
  nature:    "Style: tropical leaves, natural stones, warm sunlight, organic botanical atmosphere.",
  luxury:    "Style: dark moody black background, marble surface, dramatic warm spotlight, deep shadows.",
  lifestyle: "Style: bathroom counter, soft window light, authentic everyday lifestyle environment.",
};

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
        max_tokens: 800,
        system: `You are a product photography prompt engineer. Output ONLY this JSON:
{"styleAnalysis":"one sentence","prompt":"120-word image generation prompt. Place the product from the last image into a scene matching the reference photos exactly. Keep product shape label colors design 100% identical. Only change background lighting environment props. Start with: Professional product photograph,"}`,
        messages: [{
          role: "user",
          content: [
            ...refParts,
            { type: "image", source: { type: "base64", media_type: prod.mime, data: prod.data } },
            { type: "text", text: `References: first ${refs.length} image(s). Product: last image. ${styleHints[style] || styleHints.auto} Output ONLY JSON.` }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || "Claude Fehler" });

    const raw = data.content[0].text.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    if (start === -1) return res.status(500).json({ error: "Kein JSON" });
    res.json(JSON.parse(raw.slice(start, end)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  const { prompt, productImageBase64, productImageMime } = req.body;
  if (!FAL_KEY) return res.status(500).json({ error: "FAL_API_KEY fehlt in Railway Variables." });

  try {
    const falRes = await fetch("https://fal.run/fal-ai/flux/dev/image-to-image", {
      method: "POST",
      headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        image_url: `data:${productImageMime};base64,${productImageBase64}`,
        strength: 0.80,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        image_size: "portrait_4_3"
      })
    });

    const falData = await falRes.json();
    if (!falRes.ok) return res.status(500).json({ error: falData.detail || falData.message || "fal.ai Fehler" });
    const imageUrl = falData.images?.[0]?.url;
    if (!imageUrl) return res.status(500).json({ error: "Kein Bild generiert" });
    res.json({ imageUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log("SnapAI running on port " + PORT));
