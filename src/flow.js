/**
 * FLOW Telegram - SIAPFFAA
 * Compactado (sin cambiar lógica de negocio) + blindajes y mensajes más claros.
 * NOTA: Dejé credenciales tal cual pediste (pero recomendación: mover a .env luego).
 */

const { query, exec } = require("./db"); // DB #1 (sessions / tu capa)
const { T, pick } = require("./templates");
const { normalizeText, isDigits } = require("./utils");
const { setWaiting, finishTurn, cancelTurn } = require("./queue");
const { enqueueText } = require("./dispatcher");
const { transcribeTelegramVoiceIfAny } = require("./stt");
const nodemailer = require("nodemailer");

const random = require("random-string-generator");
const mysql = require("mysql2");

// DB #2 (dbsiapffaa + planilla) - SE DEJA porque son 2 bases distintas (según tu explicación)
var db = mysql.createPool({
  host: "172.21.4.25",
  user: "jmelgar",
  password: "Motocierra051051*",
  database: "dbsiapffaa",
});

/* =========================
   Sessions (DB #1: ./db)
========================= */

async function getSession(userId) {
  const rows = await query("SELECT * FROM sessions WHERE user_id=?", [userId]);
  if (rows.length) return rows[0];

  await exec(
    "INSERT INTO sessions (user_id, state, context) VALUES (?, 'START', JSON_OBJECT())",
    [userId]
  );
  const created = await query("SELECT * FROM sessions WHERE user_id=?", [userId]);
  return created[0];
}

async function setSession(userId, state, context) {
  await exec("UPDATE sessions SET state=?, context=? WHERE user_id=?", [
    state,
    JSON.stringify(context || {}),
    userId,
  ]);
}

function parseContext(sessionRow) {
  try {
    if (!sessionRow.context) return {};
    return typeof sessionRow.context === "string"
      ? JSON.parse(sessionRow.context)
      : sessionRow.context;
  } catch {
    return {};
  }
}

/* =========================
   Helpers (compactación)
========================= */

function renderMenuConstancias(tiposConstancia) {
  if (!Array.isArray(tiposConstancia) || !tiposConstancia.length) return "";
  return tiposConstancia.map((x, i) => `${i + 1}. ${x.nombre}`).join("\n");
}

function msgMenu(tiposConstancia) {
  // Si no existe tiposConstancia aquí (global), usamos T.menu[0] como fallback
  const listado =
    renderMenuConstancias(tiposConstancia) ||
    (T?.menu?.[0] ? String(T.menu[0]) : "⚠️ Menú no disponible.");

  return `Hola 👋\n*Tipos de constancias disponibles:*\n\n${listado}\n\n✍️ Escribe el *número* de la opción:`;
}

function getUserLabel(ctx) {
  return (
    ctx?.usuario?.nombre_persona ||
    ctx?.usuario?.usario ||
    ctx?.usuario?.usuario ||
    "usuario"
  );
}

function incIntentosToken(ctx) {
  ctx.intentosToken = (ctx.intentosToken || 0) + 1;
  return ctx.intentosToken;
}

function incIntentosData(ctx) {
  ctx.intentosData = (ctx.intentosData || 0) + 1;
  return ctx.intentosData;
}

async function tooManyIntentos(chatId, userId) {
  await enqueueText(
    chatId,
    "🚫 Demasiados intentos. Escribe /menu para iniciar de nuevo."
  );
  await setSession(userId, "START", {});
  return { endTurn: true, cancel: true, reason: "INTENTOS_EXCEDIDOS" };
}

/**
 * Paso genérico:
 * pedir usuario -> validarUsuario() -> enviar token -> setSession(tokenState)
 * Mantiene tu estilo: si falla, vuelve al menú.
 */
async function stepPedirUsuarioGenerico({
  text,
  chatId,
  userId,
  ctx,
  tokenState,
  promptUsuario = "Ingresa el usuario de SIAPFFAA",
}) {
  const usuario = (text || "").trim();

  if (!usuario) {
    await enqueueText(chatId, `❌ ${promptUsuario}`);
    return { nextWait: true, nextStep: tokenState.replace("PEDIR_TOKEN", "PEDIR_USUARIO") };
  }

  // Reset token intentos
  ctx.intentosToken = 0;

  const generartoken = await validarUsuario(usuario);

  if (!generartoken.ok) {
    await enqueueText(chatId, "⏳ Espera un momento, estoy validando tu información...");
    await setSession(userId, "MENU_CONSTANCIAS", {});
    await enqueueText(chatId, generartoken.mensaje);
    await enqueueText(chatId, msgMenu(global.tiposConstancia || tiposConstancia));
    return { nextWait: true, nextStep: "MENU_CONSTANCIAS" };
  }

  ctx.usuario = generartoken.usuario;

  await setSession(userId, tokenState, ctx);
  await enqueueText(chatId, `🔐 Token enviado ✅\nEscríbelo aquí:`);
  return { nextWait: true, nextStep: tokenState };
}

/**
 * Paso genérico:
 * pedir token -> verificar -> si OK ejecuta onSuccess()
 */
async function stepPedirTokenGenerico({
  text,
  chatId,
  userId,
  ctx,
  tokenState,
  onSuccess,
}) {
  const tokenIngresado = (text || "").trim();

  if (!tokenIngresado) {
    await enqueueText(chatId, "❌ Escribe el token, por favor:");
    return { nextWait: true, nextStep: tokenState };
  }

  if (incIntentosToken(ctx) > 3) {
    return await tooManyIntentos(chatId, userId);
  }

  const validarToken = await varificarTokenIngresado(
    ctx.usuario.identidadusuario,
    tokenIngresado
  );

  if (!validarToken.ok) {
    await setSession(userId, tokenState, ctx);
    await enqueueText(chatId, "❌ Token inválido. Intenta de nuevo:");
    return { nextWait: true, nextStep: tokenState };
  }

  // Éxito: ejecuta la acción específica
  const r = await onSuccess();

  if (r?.mensaje) await enqueueText(chatId, r.mensaje);

  await setSession(userId, "START", {});
  return { endTurn: true };
}

/* =========================
   FLOW principal
========================= */

async function handleIncoming({ bot, userId, chatId, text, voice }) {
  if (!text && voice) {
    const transcribed = await transcribeTelegramVoiceIfAny(bot, voice);
    text = transcribed || "";
  }

  const session = await getSession(userId);
  const ctx = parseContext(session);
  const msg = normalizeText(text);

  // start
  if (msg === "/menu" || msg === "iniciar") {
    await setSession(userId, "MENU_CONSTANCIAS", {});
    await enqueueText(chatId, msgMenu(global.tiposConstancia || tiposConstancia));
    return { nextWait: true, nextStep: "MENU_CONSTANCIAS" };
  }

  switch (session.state) {
    // 1) MENÚ
    case "START":
    case "MENU_CONSTANCIAS": {
      const lista = global.tiposConstancia || tiposConstancia;

      if (!Array.isArray(lista) || !lista.length) {
        await enqueueText(chatId, "⚠️ No hay constancias configuradas por el momento.");
        await setSession(userId, "START", {});
        return { endTurn: true };
      }

      const opcion = parseInt((text || "").trim(), 10);

      if (isNaN(opcion)) {
        await enqueueText(
          chatId,
          `❌ Escribe *solo el número*.\n\n${renderMenuConstancias(lista)}`
        );
        return { nextWait: true, nextStep: "MENU_CONSTANCIAS" };
      }

      if (opcion < 1 || opcion > lista.length) {
        await enqueueText(
          chatId,
          `❌ Opción inválida.\n\n${renderMenuConstancias(lista)}`
        );
        return { nextWait: true, nextStep: "MENU_CONSTANCIAS" };
      }

      const seleccionado = lista[opcion - 1];

      if (seleccionado.code === 99) {
        await enqueueText(chatId, "🚫 Cancelado. Escribe /menu para iniciar de nuevo.");
        await setSession(userId, "START", {});
        return { endTurn: true, cancel: true, reason: "USUARIO_CANCELO" };
      }

      // Guardar selección
      ctx.tipo = seleccionado.code;

      // Ver último pago
      if (seleccionado.code === 89) {
        await setSession(userId, "PEDIR_USUARIO", ctx);
        await enqueueText(chatId, "✅ Elegiste: Ver último pago.\nAhora envíame tu usuario:");
        return { nextWait: true, nextStep: "PEDIR_USUARIO" };
      }

      // Constancia para préstamo
      if (seleccionado.code === 1) {
        await setSession(userId, "PEDIR_NOMBRE_EMPRESA_2", ctx);
        await enqueueText(
          chatId,
          `✅ Elegiste: Constancia para préstamo.\n\n🏢 Ingresa el *nombre de la empresa* a la que irá dirigida:`
        );
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMPRESA_2" };
      }

      // Vaucher
      if (seleccionado.code === 2) {
        ctx.intentosData = 0;
        await setSession(userId, "PEDIR_ANO_3", ctx);
        await enqueueText(chatId, `✅ Elegiste: Vaucher.\n📅 Indica el año (ej: 2026):`);
        return { nextWait: true, nextStep: "PEDIR_ANO_3" };
      }

      // Embajada
      if (seleccionado.code === 3) {
        await setSession(userId, "PEDIR_NOMBRE_EMBAJADA_4", ctx);
        await enqueueText(chatId, `✅ Constancia para embajada.\n🏛️ Ingrese el *nombre de la embajada*:`);
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMBAJADA_4" };
      }

      // Sin deducción
      if (seleccionado.code === 4) {
        await setSession(userId, "PEDIR_NOMBRE_EMPRESA_SIN_DEDUCCION_5", ctx);
        await enqueueText(
          chatId,
          `✅ Constancia sin deducciones.\n🏢 Ingrese el *nombre de la empresa* a la que irá dirigida:`
        );
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMPRESA_SIN_DEDUCCION_5" };
      }

      // Histórica
      if (seleccionado.code === 5) {
        if (!empresasHistorica.length) await sacarEmpresasParaHistorica();

        await setSession(userId, "PEDIR_CONSTANCIA_HISTORICA_EMPRESA_6", ctx);
        await enqueueText(
          chatId,
          `✅ Constancia histórica.\n\nSeleccione la empresa:\n${empresasHistorica
            .map((x, i) => `${i + 1}. ${x.nombre}`)
            .join("\n")}`
        );
        return { nextWait: true, nextStep: "PEDIR_CONSTANCIA_HISTORICA_EMPRESA_6" };
      }

      // Vacaciones
      if (seleccionado.code === 88) {
        await setSession(userId, "PEDIR_USUARIO_7", ctx);
        await enqueueText(
          chatId,
          `✅ Consulta de vacaciones.\n👤 Ingresa el usuario de SIAPFFAA:`
        );
        return { nextWait: true, nextStep: "PEDIR_USUARIO_7" };
      }


       if (seleccionado.code === 6) {
        await setSession(userId, "PEDIR_USUARIO_8", ctx);
        await enqueueText(
          chatId,
          `✅ Solicitud de constancia para el tribunal.\n👤 Ingresa el usuario de SIAPFFAA:`
        );
        return { nextWait: true, nextStep: "PEDIR_USUARIO_8" };
      }

      // Si no coincide con nada
      await enqueueText(chatId, "⚠️ Opción aún no implementada. Escribe /menu para ver opciones.");
      await setSession(userId, "START", {});
      return { endTurn: true };
    }

    /* =========================
       VER ÚLTIMO PAGO (89)
    ========================= */
    case "PEDIR_USUARIO": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN",
        promptUsuario: "Ahora envíame tu usuario:",
      });
    }

    case "PEDIR_TOKEN": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN",
        onSuccess: async () => {
          const buscarDatos = await sacarDatosUltimomPago(ctx.usuario.identidadusuario);

          if (!buscarDatos.ok) {
            return { mensaje: buscarDatos.mensaje || "❌ No se encontraron datos para el período anterior." };
          }

          const nombre = getUserLabel(ctx);
          await enqueueText(
            chatId,
            `✅ Token correcto.\nProcesando constancia para: *${escapeMarkdown(nombre)}* ...`
          );
          await enqueueText(chatId, buscarDatos.cadena);

          return { mensaje: "" };
        },
      });
    }

    /* =========================
       PRÉSTAMO (code 1)
    ========================= */
    case "PEDIR_NOMBRE_EMPRESA_2": {
      const nombre_empresa = (text || "").trim();
      if (!nombre_empresa) {
        await enqueueText(chatId, "❌ Ingresa el nombre de la empresa:");
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMPRESA_2" };
      }

      ctx.nombre_empresa = nombre_empresa;
      ctx.intentosToken = 0;

      await setSession(userId, "PEDIR_USUARIO_2", ctx);
      await enqueueText(chatId, `👤 Ingresa el usuario de SIAPFFAA:`);
      return { nextWait: true, nextStep: "PEDIR_USUARIO_2" };
    }

    case "PEDIR_USUARIO_2": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_2",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_2": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_2",
        onSuccess: async () => {
          const mes = obtenerMesFiltro();
          const ano = obtenerAnioFiltro();
          const fecha = `${ano}-${mes}-1`;

          const p = ctx.usuario;
          const inserta_solicitud = await guardarConstanciaConDeduccion(
            p.identidadusuario,
            p.nombre_persona,
            userId,
            ctx.nombre_empresa,
            1,
            fecha,
            "Telegram",p.grado,p.idgrados,p.categoria,p.idcategoria
          );



          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ No se pudo registrar la solicitud. Intenta más tarde." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    /* =========================
       VAUCHER (code 2)
    ========================= */
    case "PEDIR_ANO_3": {
      const ano_ = (text || "").trim();

      if (!validarAnio4Digitos(ano_)) {
        if (incIntentosData(ctx) > 3) return await tooManyIntentos(chatId, userId);
        await enqueueText(chatId, "❌ Ingrese el año en 4 dígitos (ej: 2026):");
        return { nextWait: true, nextStep: "PEDIR_ANO_3" };
      }

      ctx.ano = ano_;
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_MES_3", ctx);
      await enqueueText(chatId, `📅 Ingresa el mes (1 a 12):`);
      return { nextWait: true, nextStep: "PEDIR_MES_3" };
    }

    case "PEDIR_MES_3": {
      const mes = (text || "").trim();

      if (!validarMes(mes)) {
        if (incIntentosData(ctx) > 3) return await tooManyIntentos(chatId, userId);
        await enqueueText(chatId, "❌ Ingrese un mes válido (1 a 12). Ej: 1, 2, 12");
        return { nextWait: true, nextStep: "PEDIR_MES_3" };
      }

      ctx.mes = mes;
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_OBJETO_3", ctx);
      await enqueueText(chatId, `📌 ¿De qué objeto desea?\n${objetos().map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`);
      return { nextWait: true, nextStep: "PEDIR_OBJETO_3" };
    }

    case "PEDIR_OBJETO_3": {
      const objeto_numero = (text || "").trim();

      if (!validarNumeroEnRango(objeto_numero, 1, objetos().length)) {
        if (incIntentosData(ctx) > 3) return await tooManyIntentos(chatId, userId);
        await enqueueText(chatId, `❌ Número inválido.\n${objetos().map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`);
        return { nextWait: true, nextStep: "PEDIR_OBJETO_3" };
      }

      ctx.numero_objeto = objetos()[Number(objeto_numero) - 1].code;
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_USUARIO_3", ctx);
      await enqueueText(chatId, `👤 Ingresa el usuario de SIAPFFAA:`);
      return { nextWait: true, nextStep: "PEDIR_USUARIO_3" };
    }

    case "PEDIR_USUARIO_3": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_3",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_3": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_3",
        onSuccess: async () => {
          const p = ctx.usuario;
          const fecha_inicio = `${ctx.ano}-${ctx.mes}-1`;

          const inserta_solicitud = await guardarConstanciaVaucher(
            p.identidadusuario,
            p.nombre_persona,
            userId,
            fecha_inicio,
            p.grado,
            p.idgrados,
            p.categoria,
            p.idcategoria,
            ctx.numero_objeto
          );

          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ Solicitud cancelada por un error en su perfil o en la base de datos." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    /* =========================
       EMBAJADA (code 3)
    ========================= */
    case "PEDIR_NOMBRE_EMBAJADA_4": {
      const nombre_embajada = (text || "").trim();
      if (!nombre_embajada) {
        await enqueueText(chatId, "❌ Ingresa el nombre de la embajada:");
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMBAJADA_4" };
      }

      ctx.nombre_embajada = nombre_embajada;
      ctx.intentosToken = 0;

      await setSession(userId, "PEDIR_USUARIO_4", ctx);
      await enqueueText(chatId, `👤 Ingresa el usuario de SIAPFFAA:`);
      return { nextWait: true, nextStep: "PEDIR_USUARIO_4" };
    }

    case "PEDIR_USUARIO_4": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_4",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_4": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_4",
        onSuccess: async () => {
          const mes = obtenerMesFiltro();
          const ano = obtenerAnioFiltro();
          const fecha = `${ano}-${mes}-1`;

          const p = ctx.usuario;
          const inserta_solicitud = await guardarConstanciaConDeduccion(
            p.identidadusuario,
            p.nombre_persona,
            userId,
            ctx.nombre_embajada,
            3,
            fecha,
            "Telegram",p.grado,p.idgrados,p.categoria,p.idcategoria
          );

          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ Error al solicitar constancia de embajada. Tu perfil podría tener un problema." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    /* =========================
       SIN DEDUCCIÓN (code 4)
    ========================= */
    case "PEDIR_NOMBRE_EMPRESA_SIN_DEDUCCION_5": {
      const nombre_empresa = (text || "").trim();
      if (!nombre_empresa) {
        await enqueueText(chatId, "❌ Ingresa el nombre de la empresa a la que irá dirigida la constancia:");
        return { nextWait: true, nextStep: "PEDIR_NOMBRE_EMPRESA_SIN_DEDUCCION_5" };
      }

      ctx.nombre_empresa = nombre_empresa;
      ctx.intentosToken = 0;

      await setSession(userId, "PEDIR_USUARIO_5", ctx);
      await enqueueText(chatId, `👤 Ingresa el usuario de SIAPFFAA:`);
      return { nextWait: true, nextStep: "PEDIR_USUARIO_5" };
    }

    case "PEDIR_USUARIO_5": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_5",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_5": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_5",
        onSuccess: async () => {
          const mes = obtenerMesFiltro();
          const ano = obtenerAnioFiltro();
          const fecha = `${ano}-${mes}-1`;

          const p = ctx.usuario;
          const inserta_solicitud = await guardarConstanciaSinDeduccion(
            p.identidadusuario,
            p.nombre_persona,
            userId,
            ctx.nombre_empresa,
            4,
            fecha,
            "Telegram",p.grado,p.idgrados,p.categoria,p.idcategoria
          );

         
          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ Error al solicitar constancia sin deducción. Intenta más tarde." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    /* =========================
       HISTÓRICA (code 5)
    ========================= */
    case "PEDIR_CONSTANCIA_HISTORICA_EMPRESA_6": {
      if (!empresasHistorica.length) await sacarEmpresasParaHistorica();

      const numero_empresa = (text || "").trim();
      if (!numero_empresa) {
        await enqueueText(
          chatId,
          `Seleccione la empresa:\n${empresasHistorica.map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`
        );
        return { nextWait: true, nextStep: "PEDIR_CONSTANCIA_HISTORICA_EMPRESA_6" };
      }

      if (!validarNumeroEnRango(numero_empresa, 1, empresasHistorica.length)) {
        await enqueueText(
          chatId,
          `❌ Número inválido.\n${empresasHistorica.map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`
        );
        return { nextWait: true, nextStep: "PEDIR_CONSTANCIA_HISTORICA_EMPRESA_6" };
      }

      ctx.empresa = empresasHistorica[Number(numero_empresa) - 1];
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_OBJETO_6", ctx);
      await enqueueText(chatId, `Ingrese el número del objeto:\n${objetos().map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`);
      return { nextWait: true, nextStep: "PEDIR_OBJETO_6" };
    }

    case "PEDIR_OBJETO_6": {
      const objeto_numero = (text || "").trim();

      if (!validarNumeroEnRango(objeto_numero, 1, objetos().length)) {
        if (incIntentosData(ctx) > 3) return await tooManyIntentos(chatId, userId);
        await enqueueText(chatId, `❌ Número inválido.\n${objetos().map((x, i) => `${i + 1}. ${x.nombre}`).join("\n")}`);
        return { nextWait: true, nextStep: "PEDIR_OBJETO_6" };
      }

      ctx.numero_objeto = objetos()[Number(objeto_numero) - 1].code;
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_ANO_HISTORICA_6", ctx);
      await enqueueText(chatId, `📅 Ingresa el año que deseas consultar (ej: 2024):`);
      return { nextWait: true, nextStep: "PEDIR_ANO_HISTORICA_6" };
    }

    case "PEDIR_ANO_HISTORICA_6": {
      const ano_ = (text || "").trim();

      if (!validarAnio4Digitos(ano_)) {
        if (incIntentosData(ctx) > 3) return await tooManyIntentos(chatId, userId);
        await enqueueText(chatId, "❌ Ingrese el año en 4 dígitos (ej: 2026):");
        return { nextWait: true, nextStep: "PEDIR_ANO_HISTORICA_6" };
      }

      ctx.ano = ano_;
      ctx.intentosData = 0;

      await setSession(userId, "PEDIR_USUARIO_6", ctx);
      await enqueueText(chatId, `👤 Ingresa el usuario de SIAPFFAA:`);
      return { nextWait: true, nextStep: "PEDIR_USUARIO_6" };
    }

    case "PEDIR_USUARIO_6": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_6",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_6": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_6",
        onSuccess: async () => {
          const fecha = `${ctx.ano}-01-01`;

          const p = ctx.usuario;
          const inserta_solicitud = await guardarConstanciaHistorica(
            p.identidadusuario,
            p.nombre_persona,
            userId,
            ctx.empresa.nombre,
            5,
            fecha,
            ctx.empresa.idempresa,
            p.grado,
            p.idgrados,
            p.categoria,
            p.idcategoria,
            ctx.numero_objeto,
            ctx.ano
          );

          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ Error al solicitar la constancia histórica. Tu perfil podría tener un problema." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    /* =========================
       VACACIONES (88)
    ========================= */
    case "PEDIR_USUARIO_7": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_7",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

    case "PEDIR_TOKEN_7": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_7",
        onSuccess: async () => {
          const p = ctx.usuario;
          const solicitud = await buscarMes_de_pago_vacaciones(p.identidadusuario);

          if (!solicitud.ok) {
            return { mensaje: "❌ No se pudo consultar tu fecha de vacaciones. Tu perfil podría tener un problema." };
          }

          return { mensaje: solicitud.cadena };
        },
      });
    }


     case "PEDIR_USUARIO_8": {
      return await stepPedirUsuarioGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_8",
        promptUsuario: "Ingresa el usuario de SIAPFFAA:",
      });
    }

     case "PEDIR_TOKEN_8": {
      return await stepPedirTokenGenerico({
        text,
        chatId,
        userId,
        ctx,
        tokenState: "PEDIR_TOKEN_8",
        onSuccess: async () => {
          const mes = obtenerMesFiltro();
          const ano = obtenerAnioFiltro();
          const fecha = `${ano}-${mes}-1`;

          const p = ctx.usuario;
          const inserta_solicitud = await guardarConstanciaTribunal(
           p.identidadusuario,p.nombre_persona,userId,fecha,'Telegram',p.grado,p.idgrados,p.categoria,p.idcategoria
          );

     

          if (!inserta_solicitud.ok) {
            return { mensaje: "❌ No se pudo registrar la solicitud. Intenta más tarde." };
          }

          return {
            mensaje:
              "✅ Solicitud realizada exitosamente.\n📩 Tu constancia será enviada al correo registrado en SIAPFFAA.",
          };
        },
      });
    }

    default: {
      await setSession(userId, "MENU_CONSTANCIAS", {});
      await enqueueText(chatId, msgMenu(global.tiposConstancia || tiposConstancia));
      return { nextWait: true, nextStep: "MENU_CONSTANCIAS" };
    }
  }
}

/* =========================
   Objetos / Validaciones
========================= */

function objetos() {
  return [{ nombre: "Sueldo", code: 1 }];
}

function validarNumeroEnRango(valor, min, max) {
  if (valor === null || valor === undefined) return false;
  const texto = String(valor).trim();
  if (!/^[0-9]+$/.test(texto)) return false;
  const numero = Number(texto);
  if (Number.isNaN(numero)) return false;
  return numero >= min && numero <= max;
}

function validarMes(valor) {
  if (valor === null || valor === undefined) return false;
  const texto = String(valor).trim();
  if (!/^[0-9]{1,2}$/.test(texto)) return false;
  const mes = Number(texto);
  return mes >= 1 && mes <= 12;
}

function validarAnio4Digitos(valor) {
  if (valor === null || valor === undefined) return false;
  const texto = String(valor).trim();
  return /^[0-9]{4}$/.test(texto);
}

/* =========================
   Turn control
========================= */

async function applyTurnResult({ turn, chatId, result }) {
  if (!result) return;

  if (result.endTurn) {
    if (result.cancel) {
      await cancelTurn(turn.id, result.reason || "USUARIO_CANCELO", "Cancelado desde flujo");
    } else {
      await finishTurn(turn.id);
    }
  } else if (result.nextWait) {
    await setWaiting(turn.id, true, result.nextStep || turn.step);
  }
}

/* =========================
   Filtro mes/año
========================= */

function obtenerAnioFiltro(fecha = new Date()) {
  const mes = fecha.getMonth() + 1; // 1–12
  const dia = fecha.getDate();
  const anio = fecha.getFullYear();
  return mes === 1 && dia <= 19 ? anio - 1 : anio;
}

function obtenerMesFiltro(fecha = new Date()) {
  const mesActual = fecha.getMonth() + 1; // 1–12
  const diaActual = fecha.getDate();

  if (mesActual === 1 && diaActual <= 19) return 12;
  if (mesActual === 1 && diaActual > 19) return mesActual;
  return mesActual - 1;
}

/* =========================
   DB helpers (db pool #2)
========================= */

async function validarUsuario(params) {
  let sql = `select identidadusuario,usario,fecha as fecha_ingreso,fechaPrimerIngreso as fecha_ultimo_ascenso,
fecha_planilla, if(ingreso_ascenso.idfuerza=2,equivalente,nombre_grado) as grado,categoria,
concat(nombres," ",apellidos) as nombre_persona,categoria.idcategoria,grados.idgrados FROM dbsiapffaa.usuariotemporal 
join dbsiapffaa.ingreso_ascenso on ingreso_ascenso.personal_idpersonal =  usuariotemporal.identidadusuario and activo=1
join  dbsiapffaa.grados on grados.idgrados = ingreso_ascenso.grado
join  dbsiapffaa.categoria on categoria.idcategoria = ingreso_ascenso.categoria_idcategoria 
join  dbsiapffaa.personal on personal.identidad = ingreso_ascenso.personal_idpersonal  where usario="${params}"`;

  let us = await new Promise((resolve) => {
    db.query(sql, (error, result) => {
      if (error) return resolve({ mensaje: "Ocurrio un error en el usuario", ok: false });
      if (result.length === 0) return resolve({ mensaje: "Algo anda mal en tu perfil", ok: false });
      return resolve({ mensaje: "Usuario encontrado", resultado: result, ok: true });
    });
  });

  if (!us.ok) return { mensaje: us.mensaje, ok: false };

  let usuario = us.resultado;

  let telefono = `SELECT * FROM dbsiapffaa.telefono where idpersona="${usuario[0].identidadusuario}"`;
  let tel = await new Promise((resolve) => {
    db.query(telefono, (error, result) => {
      if (error) return resolve({ mensaje: "Ocurrio un error en el usuario", ok: false });
      if (result.length === 0) return resolve({ mensaje: "No tiene telefono en siapffaa", ok: false });
      return resolve({ mensaje: "Telefonos encontrado", resultado: result, ok: true });
    });
  });
  if (!tel.ok) return { mensaje: tel.mensaje, ok: false };

  let correo = `SELECT * FROM dbsiapffaa.CorreosPersonales where identidad="${usuario[0].identidadusuario}"`;
  let corre = await new Promise((resolve) => {
    db.query(correo, (error, result) => {
      if (error) return resolve({ mensaje: "Ocurrio un error en el usuario", ok: false });
      if (result.length === 0) return resolve({ mensaje: "No tiene correo en siapffaa", ok: false });
      return resolve({ mensaje: "Correos encontrados", resultado: result, ok: true });
    });
  });
  if (!corre.ok) return { mensaje: corre.mensaje, ok: false };

  let token = random(6, "alphanumeric");
  let generarToken = `UPDATE dbsiapffaa.usuariotemporal SET otp = '${token}' WHERE (identidadusuario = '${usuario[0].identidadusuario}');`;
  let tokenupdate = await new Promise((resolve) => {
    db.query(generarToken, (error, result) => {
      if (error) return resolve({ mensaje: "Ocurrio un error al generar el token", ok: false });
      return resolve({ mensaje: "Token generado", resultado: result, ok: true });
    });
  });
  if (!tokenupdate.ok) return { mensaje: tokenupdate.mensaje, ok: false };

  let enviar = await enviar_correo(token, usuario[0].identidadusuario);
  if (!enviar.ok) return { mensaje: enviar.mensaje, ok: false };

  return { mensaje: "Token generado exitosamente", ok: true, usuario: usuario[0] };
}

async function varificarTokenIngresado(identidad, tokenIngresado) {
  let sql = `SELECT * FROM dbsiapffaa.usuariotemporal 
where identidadusuario="${identidad}" and otp ='${tokenIngresado}'`;
  let validad = await new Promise((resolve) => {
    db.query(sql, (error, result) => {
      if (error) return resolve({ mensaje: "Ocurrio un error en el usuario", ok: false });
      if (result.length === 0) return resolve({ mensaje: "Token invalido....", ok: false });
      return resolve({ mensaje: "Token valido", resultado: result, ok: true });
    });
  });
  return { ok: validad.ok };
}

/* =========================
   Markdown escape + identidad
========================= */

function escapeMarkdown(text = "") {
  return String(text)
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/`/g, "\\`");
}

function validarIdentidad(identidad) {
  const id = String(identidad ?? "").trim();
  if (!id) return { ok: false, msg: "Debés ingresar tu número de identidad." };
  if (!/^\d{8,20}$/.test(id)) return { ok: false, msg: "La identidad debe contener solo números (8 a 20 dígitos)." };
  return { ok: true, value: id };
}

function queryAsync(sql, params = []) {
  return new Promise((resolve) => {
    db.query(sql, params, (error, result) => {
      if (error) return resolve({ ok: false, error });
      return resolve({ ok: true, result: Array.isArray(result) ? result : [] });
    });
  });
}

/* =========================
   Último pago (ya lo tenías muy bien)
========================= */

async function sacarDatosUltimomPago(identidad) {
  const v = validarIdentidad(identidad);
  if (!v.ok) return { mensaje: v.msg, ok: false };
  const id = v.value;

  try {
    const sql = `
      SELECT
        deduccion.iddetalle_planilla,
        deduccion.identidad,
        T.nombre,
        T.fecha_ingreso,
        FORMAT(ROUND(SUM(ROUND(monto,2)),2),2) AS Total_deduccion,
        FORMAT(ROUND((ROUND(sueldo_base,2) - ROUND(SUM(ROUND(monto,2)),2)),2),2) AS sueldo_neto,
        FORMAT(ROUND(T.sueldo_base,2),2) AS sueldo_base,
        T.idplanilla,
        T.nombre_categoria,
        (SELECT planilla.sacar_puesto_persona(?)) AS puesto,
        (SELECT planilla.verificar_negativo(?)) AS negativo,
        CONCAT(T.fechaPago,"") AS fechaPago
      FROM (
        SELECT
          iddetalle_planilla,
          identidad,
          nombre,
          encab_planilla.idplanilla AS idplanilla,
          nombre_categoria,
          DATE_FORMAT(fecha_ingreso,"%d/%m/%Y") AS fecha_ingreso,
          sueldo_base,
          encab_planilla.fechaPago
        FROM planilla.detalle_planilla
        JOIN planilla.encab_planilla ON encab_planilla.idplanilla = detalle_planilla.encab_planilla
        JOIN planilla.categoria ON categoria.idcategoria = encab_planilla.idcategoria
          AND encab_planilla.idestado_planilla = 4
        WHERE
          YEAR(encab_planilla.fecha) = IF(MONTH(NOW())=1 AND DAY(NOW())<=19, YEAR(NOW())-1, YEAR(NOW()))
          AND MONTH(encab_planilla.fecha) = IF(
            MONTH(NOW()) = 1 AND DAY(NOW()) <= 19,
            12,
            IF(MONTH(NOW()) = 1 AND DAY(NOW()) > 19, MONTH(NOW()), MONTH(NOW()) - 1)
          )
          AND identidad = ?
          AND idobjetode_gasto = 1
      ) AS T
      JOIN planilla.deduccion ON deduccion.iddetalle_planilla = T.iddetalle_planilla
      GROUP BY deduccion.iddetalle_planilla, deduccion.identidad
    `;

    const q1 = await queryAsync(sql, [id, id, id]);

    if (!q1.ok) return { mensaje: "Ocurrió un error al consultar la planilla. Intenta nuevamente.", ok: false };
    if (q1.result.length === 0) return { mensaje: "No se encontraron datos de planilla para el período anterior.", ok: false };

    const datosplanillas = q1.result;
    const iddetalle = datosplanillas[0].iddetalle_planilla;
    const idplanilla = datosplanillas[0].idplanilla;

    const deducSql = `
      SELECT
        empresa.nombre,
        FORMAT(ROUND(SUM(ROUND(monto,2)),2),2) AS monto
      FROM planilla.detalle_planilla
      JOIN planilla.deduccion ON deduccion.iddetalle_planilla = detalle_planilla.iddetalle_planilla
      JOIN planilla.tipo_deduccion ON tipo_deduccion.idtipo_deduccion = deduccion.idtipo_deduccion
        AND (tipo_deduccion.idtipo_deduccion <> 4 AND tipo_deduccion.idtipo_deduccion <> 5)
      JOIN planilla.empresa ON empresa.idempresa = tipo_deduccion.idempresa
      WHERE detalle_planilla.iddetalle_planilla = ?
        AND detalle_planilla.identidad = ?
      GROUP BY empresa.idempresa
    `;

    const q2 = await queryAsync(deducSql, [iddetalle, id]);
    if (!q2.ok) return { mensaje: "Ocurrió un error al consultar deducciones.", ok: false };
    if (q2.result.length === 0) return { mensaje: "No se encontraron deducciones en la planilla.", ok: false };

    const soloHM_IPm = `
      SELECT
        tipo_deduccion.nombre,
        FORMAT(ROUND(SUM(ROUND(monto,2)),2),2) AS monto
      FROM planilla.detalle_planilla
      JOIN planilla.deduccion ON deduccion.iddetalle_planilla = detalle_planilla.iddetalle_planilla
      JOIN planilla.tipo_deduccion ON tipo_deduccion.idtipo_deduccion = deduccion.idtipo_deduccion
        AND (tipo_deduccion.idtipo_deduccion = 5 OR tipo_deduccion.idtipo_deduccion = 4)
      WHERE detalle_planilla.identidad = ?
        AND encab_planilla = ?
      GROUP BY tipo_deduccion.nombre
    `;

    const q3 = await queryAsync(soloHM_IPm, [id, idplanilla]);
    if (!q3.ok) return { mensaje: "Ocurrió un error al consultar HM/IPM.", ok: false };
    if (q3.result.length === 0) return { mensaje: "No se encontraron deducciones HM/IPM.", ok: false };

    let deduccionesCa = "";
    for (const it of q2.result) deduccionesCa += `• ${escapeMarkdown(it.nombre)}: *${escapeMarkdown(it.monto)}*\n`;
    for (const it of q3.result) deduccionesCa += `• ${escapeMarkdown(it.nombre)}: *${escapeMarkdown(it.monto)}*\n`;

    const nombre = escapeMarkdown(datosplanillas[0].nombre);
    const identidadTxt = escapeMarkdown(datosplanillas[0].identidad);
    const sueldoBase = escapeMarkdown(datosplanillas[0].sueldo_base);
    const totalDed = escapeMarkdown(datosplanillas[0].Total_deduccion);
    const sueldoNeto = escapeMarkdown(datosplanillas[0].sueldo_neto);
    const fechaPago = escapeMarkdown(datosplanillas[0].fechaPago ?? "");
    const categoria = escapeMarkdown(datosplanillas[0].nombre_categoria ?? "");
    const puesto = escapeMarkdown(datosplanillas[0].puesto ?? "");

    const cadena = `
✅ *Pago encontrado*
👤 *Nombre:* ${nombre}
🪪 *Identidad:* ${identidadTxt}
🏷️ *Categoría:* ${categoria}
📅 *Fecha de pago:* ${fechaPago}

💰 *Sueldo nominal:* ${sueldoBase}
➖ *Total deducciones:* ${totalDed}
✅ *Sueldo neto:* ${sueldoNeto}

📌 *Detalle de deducciones:*
${deduccionesCa}`.trim();

    return { mensaje: "✅ Listo. Aquí está tu resumen del último pago:", cadena, ok: true };
  } catch (e) {
    return { mensaje: "Ocurrió un error inesperado al procesar tu solicitud.", ok: false };
  }
}

/* =========================
   Email (se deja igual)
========================= */

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: "constancias.computo@sedena.gob.hn",
    pass: "Honducons1234",
  },
  tls: { ciphers: "SSLv3" },
});

async function enviar_correo(token, identidad) {
  const id = String(identidad ?? "").trim();
  const tok = String(token ?? "").trim();

  if (!id) return { mensaje: "Identidad requerida", ok: false };
  if (!/^\d{8,20}$/.test(id)) return { mensaje: "Identidad inválida", ok: false };
  if (!tok) return { mensaje: "Token requerido", ok: false };

  const sqlcorreos = `SELECT correo FROM dbsiapffaa.CorreosPersonales WHERE identidad = ?`;

  const correos = await new Promise((resolve) => {
    db.query(sqlcorreos, [id], (error, resultado) => {
      if (error) return resolve({ ok: false, mensaje: "Error de base de datos" });
      if (!resultado || resultado.length === 0) return resolve({ ok: false, mensaje: "No existen correos registrados" });

      const lista = resultado.map((r) => String(r.correo ?? "").trim()).filter(Boolean);
      if (!lista.length) return resolve({ ok: false, mensaje: "No existen correos válidos" });

      return resolve({ ok: true, to: lista.join(",") });
    });
  });

  if (!correos.ok) return { mensaje: correos.mensaje, ok: false };

  const mailOption = {
    from: "constancias.computo@sedena.gob.hn",
    to: correos.to,
    subject: "Token OTP Emelina",
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; background:#f6f6f6; padding:20px;">
          <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:8px;padding:20px;">
            <h3 style="margin:0 0 10px;">Código de verificación</h3>
            <p>Su código es: <strong style="font-size:18px;">${tok}</strong></p>
            <p style="margin:15px 0 0;color:#555;">Soporte técnico: 22763400 ext: 2405</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;text-align:center;">
              Sistema de Personal de Fuerzas Armadas (SIAPFFAA) — Estado Mayor Conjunto, Tegucigalpa M.D.C.<br>
              Dirección de Comunicaciones e Informática (C-6)
            </p>
          </div>
        </body>
      </html>
    `,
  };

  const envio = await new Promise((resolve) => {
    transporter.sendMail(mailOption, (error, info) => {
      if (error) return resolve({ ok: false, mensaje: "Error al enviar código por correo", error });
      return resolve({ ok: true, mensaje: "Correo enviado con éxito", info });
    });
  });

  if (!envio.ok) return { mensaje: envio.mensaje, ok: false };
  return { mensaje: envio.mensaje, ok: true };
}

/* =========================
   Guardados (se dejan iguales)
========================= */

async function guardarConstanciaConDeduccion(
  identidad,
  nombre,
  numero,
  empresa,
  idtipo_solicitud,
  fecha_inicio,
  por_donde_solicito,
  grado,idgrado,categoria,idcategoria
) {
  let sql = `INSERT INTO planilla.whatsapp_solicitudes
   (identidad, nombres, numero, empresa_constancia, idestado_whatssap,
    fecha_sistema, idtipo_solicitud, fecha_inicio,
     por_donde_solicito,grado,idgrado,categoria,idcategoria) VALUES 
     ('${identidad}', '${nombre}', '${numero}', '${empresa}', 1,now(),
      '${idtipo_solicitud}', '${fecha_inicio}',
      '${por_donde_solicito}','${grado}','${idgrado}','${categoria}','${idcategoria}');
`;
console.log(sql)
  let espera = await new Promise((resolve) => {
    db.query(sql, (error) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "Registrado de manera excelente", ok: true });
    });
  });
  return espera;
}

async function guardarConstanciaVaucher(
  identidad,
  nombre,
  numero,
  fecha_inicio,
  grado,
  idgrado,
  categoria,
  idcategoria,
  idobjeto
) {
  let sql = ` 
  INSERT INTO planilla.whatsapp_solicitudes
   (identidad, nombres, numero, empresa_constancia, idestado_whatssap,
    fecha_sistema, idtipo_solicitud, fecha_inicio, grado, idgrado, 
    categoria, idcategoria, por_donde_solicito, idobjeto_gasto) VALUES 
    ('${identidad}', '${nombre}', '${numero}', 'Vaucher', '1', now(), '2', 
    '${fecha_inicio}', '${grado}', '${idgrado}', '${categoria}', '${idcategoria}', 'telegram', '${idobjeto}');
`;
  let espera = await new Promise((resolve) => {
    db.query(sql, (error) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "Registrado de manera excelente", ok: true });
    });
  });
  return espera;
}

async function guardarConstanciaSinDeduccion(
  identidad,
  nombre,
  numero,
  empresa,
  idtipo_solicitud,
  fecha_inicio,
  por_donde_solicito,
  grado,idgrado,categoria,idcategoria
) {
  let sql = `INSERT INTO planilla.whatsapp_solicitudes
   (identidad, nombres, numero, empresa_constancia, idestado_whatssap,
    fecha_sistema, idtipo_solicitud, fecha_inicio,
     por_donde_solicito,grado,idgrado,categoria,idcategoria) VALUES 
     ('${identidad}', '${nombre}', '${numero}', '${empresa}', 1,now(),
      '${idtipo_solicitud}', '${fecha_inicio}',
      '${por_donde_solicito}','${grado}','${idgrado}','${categoria}','${idcategoria}');
`;
  let espera = await new Promise((resolve) => {
    db.query(sql, (error) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "Registrado de manera excelente", ok: true });
    });
  });
  return espera;
}

/* =========================
   Histórica: empresas
========================= */

let empresasHistorica = [];
sacarEmpresasParaHistorica();

async function sacarEmpresasParaHistorica() {
  let sql = `SELECT idempresa,nombre FROM planilla.empresa order by nombre`;
  let espera = await new Promise((resolve) => {
    db.query(sql, (error, result) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "OK", resultado: result, ok: true });
    });
  });

  if (espera.ok && Array.isArray(espera.resultado)) empresasHistorica = espera.resultado;
}

/* =========================
   Guardar histórica
========================= */

async function guardarConstanciaHistorica(
  identidad,
  nombre,
  numero,
  empresa,
  idtipo_solicitud,
  fecha_inicio,
  idempresa,
  grado,
  idgrado,
  categoria,
  idcategoria,
  idobjeto,
  ano_historico
) {
  let sql = `
  INSERT INTO planilla.whatsapp_solicitudes 
  (identidad, nombres, numero, empresa_constancia, idestado_whatssap,
   fecha_sistema, idtipo_solicitud, fecha_inicio, idempresa_deduccion, 
   grado, idgrado, categoria, idcategoria, por_donde_solicito, idobjeto_gasto, ano_historico)
    VALUES
     ('${identidad}', '${nombre}', '${numero}', '${empresa}', '1',now(), '${idtipo_solicitud}', '${fecha_inicio}',
      '${idempresa}', '${grado}', '${idgrado}', '${categoria}', '${idcategoria}', 'Telegram', '${idobjeto}', '${ano_historico}');
  `;
  let espera = await new Promise((resolve) => {
    db.query(sql, (error) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "Registrado de manera excelente", ok: true });
    });
  });
  return espera;
}

/* =========================
   Vacaciones
========================= */

async function buscarMes_de_pago_vacaciones(identidad) {
  let sql = `call planilla.whatsap_vacaciones('${identidad}');`;

  let re = await new Promise((resolve) => {
    db.query(sql, (error, resultado) => {
      if (error) return resolve({ mensaje: "Error de base de datos", ok: false });
      if (!resultado || resultado.length === 0) return resolve({ mensaje: "Error: no se encontraron datos", ok: false });
      return resolve({ mensaje: "Datos encontrados", resultado: resultado[0], ok: true });
    });
  });

  if (!re.ok) return { mensaje: re.mensaje, ok: false };

  return {
    mensaje: re.mensaje,
    ok: true,
    cadena: `Grado: *${re.resultado[0].grado}*\nNombre: *${re.resultado[0].nombre}*\nMes: *${re.resultado[0].fecha_vacaciones}*`,
  };
}


async function guardarConstanciaTribunal(
  identidad,
  nombre,
  numero,
  fecha_inicio,
  por_donde_solicito,
  grado,idgrado,categoria,idcategoria
) {
  let sql = `INSERT INTO planilla.whatsapp_solicitudes
   (identidad, nombres, numero, empresa_constancia, idestado_whatssap,
    fecha_sistema, idtipo_solicitud, fecha_inicio,
     por_donde_solicito,grado,idgrado,categoria,idcategoria) VALUES 
     ('${identidad}', '${nombre}', '${numero}', 'Tribunal', 1,now(),
      6, '${fecha_inicio}',
      '${por_donde_solicito}','${grado}','${idgrado}','${categoria}','${idcategoria}');
`;
console.log(sql)
  let espera = await new Promise((resolve) => {
    db.query(sql, (error) => {
      if (error) return resolve({ mensaje: "Error en la db", ok: false });
      return resolve({ mensaje: "Registrado de manera excelente", ok: true });
    });
  });
  return espera;
}

/* =========================
   Exports
========================= */

module.exports = { handleIncoming, applyTurnResult };
