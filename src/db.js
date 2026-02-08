const mysql = require("mysql2/promise");
const { DB } = require("./config");

const pool = mysql.createPool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  port: DB.port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function exec(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

module.exports = { pool, query, exec };
