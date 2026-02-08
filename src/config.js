require("dotenv").config();

module.exports = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  DB: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  },
  CONCURRENCY: Number(process.env.CONCURRENCY || 4),
  TURN_TIMEOUT_SECONDS: Number(process.env.TURN_TIMEOUT_SECONDS || 120),
  API_PORT: Number(process.env.API_PORT || 3000),
  API_SHARED_SECRET: process.env.API_SHARED_SECRET || "CHANGE_ME",
};
