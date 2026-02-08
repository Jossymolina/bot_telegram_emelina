const { getExpiredTurns, cancelTurn, assignIfPossible, setWaiting } = require("./queue");
const { enqueueText } = require("./dispatcher");
const { T, pick } = require("./templates");

async function runTimeoutWorker() {
  const expired = await getExpiredTurns();
  for (const t of expired) {
    // cancelar por timeout
    await cancelTurn(t.id, "TIMEOUT_NO_RESPUESTA", `Paso: ${t.step || ""}`);
    await enqueueText(t.user_id, pick(T.timeout));
  }
}

async function runAssignWorker() {
  const assigned = await assignIfPossible();
  for (const t of assigned) {
    // al asignar, le avisamos y lo ponemos esperando en MENU
    await enqueueText(t.user_id, pick(T.tuTurno));
    await enqueueText(t.user_id, pick(T.saludo));
    await setWaiting(t.id, true, "MENU");
  }
}

module.exports = { runTimeoutWorker, runAssignWorker };
