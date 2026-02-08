// Aquí solo dejo el “gancho” listo.
// Para transcribir de verdad: Whisper local, OpenAI Whisper, Google STT, Azure, etc.

async function transcribeTelegramVoiceIfAny(bot, voice) {
  try {
    // voice tiene file_id
    // const fileLink = await bot.getFileLink(voice.file_id);
    // 1) descargas el audio (ogg)
    // 2) lo conviertes si ocupas (ffmpeg)
    // 3) lo transcribes
    // return "texto transcrito";
    return ""; // por ahora vacío (no rompe nada)
  } catch {
    return "";
  }
}

module.exports = { transcribeTelegramVoiceIfAny };
