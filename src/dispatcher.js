const { exec, query } = require("./db");

async function enqueueText(chatId, text) {
  await exec(
    "INSERT INTO outbox (user_id, type, payload) VALUES (?, 'text', ?)",
    [String(chatId), JSON.stringify({ chatId, text })]
  );
}

async function enqueueDocument(chatId, url, filename, caption = "") {
  await exec(
    "INSERT INTO outbox (user_id, type, payload) VALUES (?, 'document', ?)",
    [String(chatId), JSON.stringify({ chatId, url, filename, caption })]
  );
}

async function dispatchOutbox(bot) {
  const items = await query(
    "SELECT * FROM outbox WHERE status='PENDING' ORDER BY created_at ASC LIMIT 30"
  );

  for (const item of items) {
    try {
      const payload = (typeof item.payload === "string")
        ? JSON.parse(item.payload)
        : item.payload;

      if (item.type === "text") {
        await bot.sendMessage(payload.chatId, payload.text, { parse_mode: "Markdown" });
      } else if (item.type === "document") {
        await bot.sendDocument(
          payload.chatId,
          payload.url,
          { caption: payload.caption || "" },
          { filename: payload.filename || "documento.pdf" }
        );
      }

      await exec("UPDATE outbox SET status='SENT', sent_at=NOW() WHERE id=?", [item.id]);
    } catch (err) {
      const msg = (err && err.message) ? err.message.slice(0, 250) : "send error";
      await exec(
        "UPDATE outbox SET status='ERROR', attempts=attempts+1, last_error=? WHERE id=?",
        [msg, item.id]
      );
    }
  }
}

module.exports = { enqueueText, enqueueDocument, dispatchOutbox };
