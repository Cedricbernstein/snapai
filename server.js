const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/analyze", async (req, res) => {
  const { refs, prod, style } = req.body;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt auf dem Server." });

  const styleHints = {
    auto:      "Detect and replicate the style ENTIRELY from the reference images.",
    minimal:   "Style: clean white studio background, soft diffused overhead light, minimal composition.",
    nature:    "Style: tropical leaves, natural stones, warm sunlight, organic botanical atmosphere.",
    luxury:    "Style: dark moody black background, marble surface, dramatic warm spotlight, deep shadows.",
    lifestyle: "Style: bathroom counter, soft window light, authentic everyday lifestyle environment.",
  };

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
        model: "claude-opus-4-5",
        max_tokens: 1500,
        system: `You are an expert product photography prompt engineer.
Analyze the reference images and the product image, then output ONLY this JSON (no markdown, no explanation):
{"styleAnalysis":"2 sentences about the reference style","prompts":{"front":"90+ word prompt","three4":"90+ word prompt","flatlay":"90+ word prompt","detail":"90+ word prompt"}}

Rules for each prompt:
- Reproduce the reference scene/style exactly around the product
- Keep the product shape, label, colors, design 100% identical
- Only change: background, lighting, environment, props
- Be very detailed so an AI image generator can reproduce it perfectly`,
        messages: [{
          role: "user",
          content: [
            ...refParts,
            { type: "image", source: { type: "base64", media_type: prod.mime, data: prod.data } },
            { type: "text", text: `First ${refs.length} image(s) = reference style. Last image = product to style.\n${styleHints[style] || styleHints.auto}\nReturn ONLY the JSON object.` }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || "Claude Fehler" });

    const raw = data.content[0].text.trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    if (start === -1) return res.status(500).json({ error: "Kein JSON in Antwort" });
    const parsed = JSON.parse(raw.slice(start, end));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SnapAI running on port " + PORT));
