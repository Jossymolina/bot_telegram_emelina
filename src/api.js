const express = require("express");
const { API_SHARED_SECRET } = require("./config");
const { enqueueText, enqueueDocument } = require("./dispatcher");

function buildApi() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // auth simple por header
  app.use((req, res, next) => {
    const key = req.headers["x-api-key"];
    if (!key || key !== API_SHARED_SECRET) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    next();
  });

  app.post("/api/bot/send", async (req, res) => {
    try {
      const { chatId, type, text, url, filename, caption } = req.body || {};
      if (!chatId) return res.status(400).json({ ok: false, message: "chatId requerido" });

      if (type === "document") {
        if (!url) return res.status(400).json({ ok: false, message: "url requerido" });
        await enqueueDocument(String(chatId), url, filename || "documento.pdf", caption || "");
      } else {
        if (!text) return res.status(400).json({ ok: false, message: "text requerido" });
        await enqueueText(String(chatId), String(text));
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || "error" });
    }
  });

  return app;
}

module.exports = { buildApi };
