function pick(arr, seedKey = "") {
  // simple random; si luego quieres evitar repetición por usuario, lo hacemos con historial
  return arr[Math.floor(Math.random() * arr.length)];
}
tiposConstancia =[
  {nombre:"Ver ultimo Pago",code:89},
  {nombre:"Constancia para prestamo",code:1},
  {nombre:"Vaucher",code:2},
  {nombre:"Embajada",code:3},
  {nombre:"Sin deduccion",code:4},
  {nombre:"Historica",code:5},
  {nombre:"Tribunal",code:6},
  {nombre:"Cuando me toca pago de vacaciones",code:88}

]

const T = {
   menu: [
    `Hola, Tipo de constancias disponible.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `Que tal que servicio deseas.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `Estos son los servicios disponibles.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `En que puedo ayudarte.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,

   
  ],
  saludo: [
    `Hola, Tipo de constancias disponible.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `Que tal que servicio deseas.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `Estos son los servicios disponibles.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,
    `En que puedo ayudarte.\n ${tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n')}`,

   
  ],
  enCola: (pos) => pick([
    `Listo ✅ quedaste en fila. Tu posición actual es: ${pos}. Te aviso cuando sea tu turno.`,
    `Perfecto, te dejé en espera. Posición: ${pos}. Apenas se libere un cupo seguimos.`,
    `Ya estás en cola ✅ (posición ${pos}). Por favor mantente pendiente.`
  ]),
  tuTurno: [
    "Ya es tu turno ✅. Responde en máximo 2 minutos para no perder el cupo.",
    "Te toca ahora 🙌. Si no respondes en 2 minutos, el sistema libera tu turno.",
    "Listo, seguimos contigo ✅. Contesta en 2 minutos para continuar."
  ],
  timeout: [
    "Se venció el tiempo de respuesta ⏱️ y liberé tu turno. Si aún necesitas la constancia, escribe *INICIAR*.",
    "No recibí respuesta a tiempo, así que cancelé tu turno. Para reintentar, escribe *INICIAR*.",
    "Tu turno expiró por inactividad. Si deseas volver a iniciar, envía *INICIAR*."
  ],
  pedirTipo: [
    "¿Qué tipo de constancia necesitas?\n\nA) Constancia laboral\nB) Constancia de servicio\nC) Otra (escribe el tipo)",
    "Indícame el tipo de constancia 📄:\n\nA) Laboral\nB) Tiempo de servicio\nC) Otra (escríbela)",
    "Para continuar, dime el tipo de constancia:\nA) Laboral\nB) Servicio\nC) Otra"
  ],
  pedirIdentidad: [
    "Ahora envíame tu identidad/DNI (solo números, sin guiones).",
    "Por favor escribe tu identidad/DNI (solo números).",
    "Necesito tu identidad/DNI para validar. Envíala en números, por favor."
  ],
  resumen: (ctx) => {
    const tipo = ctx.tipo || "(no definido)";
    const dni = ctx.identidad || "(no definido)";
    return `Resumen ✅\n- Tipo: ${tipo}\n- Identidad: ${dni}\n\nResponde:\n1) Confirmar\n2) Cancelar`;
  },
  confirmado: [
    "Perfecto ✅ Tu solicitud fue registrada. En breve te notifico cuando esté lista.",
    "Listo 🙌 Solicitud creada. Te avisaré cuando la constancia esté lista.",
    "Hecho ✅ Ya registré tu solicitud. Te informaré el resultado."
  ],
  cancelado: [
    "Entendido. Cancelé tu trámite ✅. Si deseas iniciar nuevamente, escribe *INICIAR*.",
    "De acuerdo, quedó cancelado. Para empezar otra vez: *INICIAR*.",
    "Listo, cancelado. Si luego lo ocupas, escribe *INICIAR*."
  ],
  noEntendi: [
    "Perdón, no logré entender. Responde con el número/opción indicada, por favor.",
    "No capté la respuesta 😅. Intenta con 1, 2, 3 o con el texto de la opción.",
    "¿Me lo repites? Usa la opción del menú para avanzar."
  ],

  pedirUsuario: [
    "Cual es tu usario de SIAPFFAA",
    "Ingresa tu usuario de SIAPFFAA",
    "Ingrese usuario de SIAPFFAA"
  ],
   pedirToken: [
    "Ingresa el token que enviamos a tu correo",
    "Ingresa el token que enviamos a tu correo",
    "Ingresa el token que enviamos a tu correo"
  ],
};

module.exports = { T, pick };
