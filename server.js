const express = require("express");
const cors = require("cors");
const path = require("path");
const FormData = require("form-data");

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
        max_tokens: 1000,
        system: `You are a product photography prompt engineer. Analyze reference images and product image.
Output ONLY this JSON:
{"styleAnalysis":"one sentence describing the reference style","prompt":"Write a 150-word ultra-detailed prompt describing: exact background, surface, lighting, colors, props, shadows, atmosphere from the reference images. End with: The product from the input image must appear exactly as-is, preserving every detail of its shape, label, colors and design."}`,
        messages: [{
          role: "user",
          content: [
            ...refParts,
            { type: "image", source: { type: "base64", media_type: prod.mime, data: prod.data } },
            { type: "text", text: `First ${refs.length} image(s) = reference style. Last image = product. ${styleHints[style] || styleHints.auto} Output ONLY JSON.` }
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
  const { prompt, productImageBase64, productImageMime, angle } = req.body;
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY fehlt in Railway Variables." });

  const fullPrompt = `${prompt} Camera angle: ${angle || "front view, centered"}. Photorealistic commercial product photography, 8k quality.`;

  try {
    const imgBuffer = Buffer.from(productImageBase64, "base64");

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", fullPrompt);
    form.append("n", "1");
    form.append("size", "1024x1536");
    form.append("image[]", imgBuffer, { filename: "product.jpg", contentType: productImageMime || "image/jpeg" });

    const openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    const openaiData = await openaiRes.json();
    console.log("OpenAI status:", openaiRes.status);

    if (!openaiRes.ok) {
      console.error("OpenAI error:", JSON.stringify(openaiData));
      return res.status(500).json({ error: openaiData.error?.message || "OpenAI Fehler" });
    }

    const b64 = openaiData.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "Kein Bild von OpenAI erhalten" });

    res.json({ imageUrl: `data:image/png;base64,${b64}` });

  } catch (e) {
    console.error("Generate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log("SnapAI running on port " + PORT));
