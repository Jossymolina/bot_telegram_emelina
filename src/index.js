const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, API_PORT } = require("./config");
const { getOrCreateTurn, getQueuePosition, setWaiting } = require("./queue");
const { enqueueText, dispatchOutbox } = require("./dispatcher");
const { T } = require("./templates");
const { handleIncoming, applyTurnResult } = require("./flow");
const { runTimeoutWorker, runAssignWorker } = require("./workers");
const { buildApi } = require("./api");

if (!BOT_TOKEN) {
  console.error("Falta TELEGRAM_BOT_TOKEN en .env");
  process.exit(1);
}

console.log("Bot Telegram iniciado ✅", "PID:", process.pid);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// API gateway
const apiApp = buildApi();
apiApp.listen(API_PORT, () => console.log("API escuchando en puerto", API_PORT));

/* =========================
   DEDUPE: evita procesar el mismo message_id 2 veces
   (Telegram a veces reintenta / reconexiones / reinicios)
========================= */
const seen = new Map(); // key -> timestamp

function alreadySeen(key, ttlMs = 60_000) {
  const now = Date.now();
  // limpia viejos
  for (const [k, t] of seen) {
    if (now - t > ttlMs) seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

// Mensajes entrantes
bot.on("message", async (m) => {
  try {
    const chatId = m.chat?.id;
    const userId = String(m.from?.id || "");
    const msgId = m.message_id;

    if (!chatId || !userId || !msgId) return;

    // Dedupe por chatId+message_id
    const dedupeKey = `${chatId}:${msgId}`;
    if (alreadySeen(dedupeKey)) return;

    console.log("MENSAJE RECIBIDO:", m.text, "from:", userId, "msgId:", msgId);

    // Crear/recuperar turno
    const turn = await getOrCreateTurn(userId);

    // Si está EN_COLA, solo informar posición y listo
    if (turn.status === "EN_COLA") {
      const pos = await getQueuePosition(turn.id);
      await enqueueText(chatId, T.enCola(pos));
      return;
    }

    // Si está ATENDIENDO, procesamos flujo
    if (turn.status === "ATENDIENDO") {
      // marcar que el usuario respondió (para cortar timeout)
      await setWaiting(turn.id, false, turn.step || "MENU", { incoming: true });

      const result = await handleIncoming({
        bot,
        userId,
        chatId,
        text: m.text || "",
        voice: m.voice || null,
      });

      await applyTurnResult({ turn, chatId, result });
      return;
    }

    // Si estaba FINALIZADO/CANCELADO, permitir reiniciar
    await enqueueText(chatId, "Escribe *INICIAR* para comenzar de nuevo ✅");
  } catch (err) {
    console.error("Error message handler:", err);
  }
});

bot.on("polling_error", (err) => {
  console.error("POLLING_ERROR:", err?.message || err);
});

bot.on("webhook_error", (err) => {
  console.error("WEBHOOK_ERROR:", err?.message || err);
});

bot.on("error", (err) => {
  console.error("BOT_ERROR:", err?.message || err);
});

bot
  .getMe()
  .then((me) => console.log("BOT ME:", me.username, me.id))
  .catch(console.error);

/* =========================
   Workers (timeout + asignación + outbox)
   BLINDAJE: evita solapamiento de intervalos
   (si un ciclo tarda > 1200ms, no se ejecuta otro encima)
========================= */
let workerRunning = false;

setInterval(async () => {
  if (workerRunning) return;
  workerRunning = true;

  try {
    await runTimeoutWorker();
    await runAssignWorker();
    await dispatchOutbox(bot);
  } catch (e) {
    console.error("WORKER_LOOP_ERROR:", e);
  } finally {
    workerRunning = false;
  }
}, 1200);
