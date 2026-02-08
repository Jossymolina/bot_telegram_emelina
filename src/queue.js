const { query, exec } = require("./db");
const { CONCURRENCY, TURN_TIMEOUT_SECONDS } = require("./config");

async function getOrCreateTurn(userId) {
  // Si ya está ATENDIENDO o EN_COLA, lo retornamos
  const existing = await query(
    "SELECT * FROM queue_turns WHERE user_id=? AND status IN ('EN_COLA','ATENDIENDO') ORDER BY id DESC LIMIT 1",
    [userId]
  );
  if (existing.length) return existing[0];

  const res = await exec(
    "INSERT INTO queue_turns (user_id, status, step) VALUES (?, 'EN_COLA', 'START')",
    [userId]
  );
  const rows = await query("SELECT * FROM queue_turns WHERE id=?", [res.insertId]);
  await logEvent(rows[0].id, "CREATED", { userId });
  return rows[0];
}

async function getServingCount() {
  const rows = await query("SELECT COUNT(*) AS c FROM queue_turns WHERE status='ATENDIENDO'");
  return Number(rows[0].c || 0);
}

async function getQueuePosition(turnId) {
  // posición entre EN_COLA por created_at
  const rows = await query(
    `
    SELECT 1 + COUNT(*) AS pos
    FROM queue_turns q
    WHERE q.status='EN_COLA'
      AND q.created_at < (SELECT created_at FROM queue_turns WHERE id=?)
    `,
    [turnId]
  );
  return Number(rows[0].pos || 1);
}

async function assignIfPossible() {
  const serving = await getServingCount();
  const free = CONCURRENCY - serving;
  if (free <= 0) return [];

  // Tomar los primeros N en cola
  const candidates = await query(
    "SELECT * FROM queue_turns WHERE status='EN_COLA' ORDER BY created_at ASC LIMIT ?",
    [free]
  );

  const assigned = [];
  for (const t of candidates) {
    await exec(
      `UPDATE queue_turns
       SET status='ATENDIENDO', assigned_at=NOW(), started_at=IFNULL(started_at, NOW())
       WHERE id=? AND status='EN_COLA'`,
      [t.id]
    );
    await logEvent(t.id, "ASSIGNED", {});
    const updated = await query("SELECT * FROM queue_turns WHERE id=?", [t.id]);
    assigned.push(updated[0]);
  }
  return assigned;
}

async function setWaiting(turnId, waiting, step, detail = {}) {
  if (waiting) {
    await exec(
      `UPDATE queue_turns
       SET waiting_for_user=1, step=?, last_bot_message_at=NOW(),
           deadline_at=DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id=?`,
      [step, TURN_TIMEOUT_SECONDS, turnId]
    );
  } else {
    await exec(
      `UPDATE queue_turns
       SET waiting_for_user=0, step=?, last_user_message_at=NOW()
       WHERE id=?`,
      [step, turnId]
    );
  }
  await logEvent(turnId, waiting ? "BOT_WAITING" : "USER_REPLY", { step, ...detail });
}

async function cancelTurn(turnId, reason, detail = "") {
  await exec(
    `UPDATE queue_turns
     SET status='CANCELADO', finished_at=NOW(), cancel_reason=?, cancel_detail=?, waiting_for_user=0
     WHERE id=? AND status IN ('EN_COLA','ATENDIENDO')`,
    [reason, detail, turnId]
  );
  await logEvent(turnId, "CANCELLED", { reason, detail });
}

async function finishTurn(turnId) {
  await exec(
    `UPDATE queue_turns
     SET status='FINALIZADO', finished_at=NOW(), waiting_for_user=0
     WHERE id=? AND status='ATENDIENDO'`,
    [turnId]
  );
  await logEvent(turnId, "FINISHED", {});
}

async function getExpiredTurns() {
  return query(
    `SELECT * FROM queue_turns
     WHERE status='ATENDIENDO' AND waiting_for_user=1
       AND deadline_at IS NOT NULL AND deadline_at < NOW()`
  );
}

async function logEvent(turnId, event, data) {
  await exec(
    "INSERT INTO queue_events (turn_id, event, data) VALUES (?,?,?)",
    [turnId, event, JSON.stringify(data || {})]
  );
}

module.exports = {
  getOrCreateTurn,
  getQueuePosition,
  assignIfPossible,
  setWaiting,
  cancelTurn,
  finishTurn,
  getExpiredTurns,
};
