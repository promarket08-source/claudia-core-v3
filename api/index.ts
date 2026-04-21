import { Bot, webhookCallback } from "grammy"
import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, Firestore } from "firebase-admin/firestore"

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "")
const GROQ_API_KEY = process.env.GROQ_API_KEY || ""
const XAI_API_KEY = process.env.XAI_API_KEY || ""
const OPENROUTER_KEYS = JSON.parse(process.env.OPENROUTER_KEYS || "[]")
const MODELS = ["google/gemini-2.0-flash-001", "minimax/minimax-m2.5:free"]
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "1811224365")

const SHEET_ID = "1Nda_f9eoD3c8GmIjDbpfQCqBiZyLeaE3lMMTQuOxQoM"
let db: Firestore | null = null
let firebaseReady = false

function initFirebase() {
  try {
    const configStr = process.env.FIREBASE_CONFIG || ""
    if (!configStr || configStr === "{}") {
      console.log("⚠️ Firebase: Sin configuración")
      return
    }
    const serviceAccount = JSON.parse(configStr)
    if (serviceAccount.private_key) {
      initializeApp({ credential: cert(serviceAccount) })
      db = getFirestore()
      firebaseReady = true
      console.log("✅ Firebase conectado")
    }
  } catch (e) {
    console.log("⚠️ Firebase error:", e)
  }
}
initFirebase()

function checkFirebase(): string | null {
  if (!firebaseReady) return "Jefe, estoy viva pero me faltan mis llaves de Firebase en Vercel."
  return null
}

const PARCELAS_DATA = `
INVENTARIO PROMARKET - TIEMPO PROPIEDADES:

Parcelas (Villarrica/Pucón):
1. Chesque - 5.000m² - $45MM - Vista Volcán, Agua, Luz
2. Cudico KM 20 - 10.000m² - $85MM - Frente río, Bosque nativo
3. Rodolfo y Jessica - 3.500m² - $38MM - Cerca centro
4. Conquil - 4.200m² - $42MM - Vista lago, Acceso privado

Casas:
- Los Volcanes - 180m² + 500m² terreno - $185MM - 3 dorm, 2 baños
- Manuel Antonio (Saturnino Epulef) - 280m² - $450MM - 2 casas, 7 dorm

VEHÍCULOS EN VENTA:
- Toyota Yaris 2017: $5.900.000 - Automático - 299.000 km - Excelente estado

Contacto: +56964681874 | @tiempopropiedades | @tuwebpro360
`

const SHEET_LINK = "https://docs.google.com/spreadsheets/d/1Nda_f9eoD3c8GmIjDbpfQCqBiZyLeaE3lMMTQuOxQoM"

const SYSTEM = `Eres CLAUDIA, Agente IA de Roberto - ASISTENTE PERSONAL.

Creador y JEFE: Roberto.

${PARCELAS_DATA}

--- CEREBRO_CLAUDIA ---
Base de datos: ${SHEET_LINK}

--- REGLAS DE ASISTENTE ---

TRATO: Roberto es tu jefe. Tono eficiente, leal, proactivo.
- NO le hagas pitches de venta
- NO te presentes ("Soy Claudia, soy experta en...")
- DA reportes, soluciones, sugerencias

MENOS PITCH, MÁS ACCIÓN:
- En lugar de "Soy experta en...", dice: "Jefe, ya hice esto, ¿qué sigue?"
- Ve directo al grano
- Entrega resultados, no discursos

FILTRO DE DUEÑO:
- Cuando Roberto habla, asume que ya sabes quién es
- No te presentes cada vez
- Ve al grano: "Jefe,最新的 cliente es..."

CIERRE CON ROBERTO:
- En lugar de "Te agendo en WhatsApp": "Quedo atenta a tu próxima instrucción, Roberto"
- Si necesitas confirmación: "Confirmado, Roberto. Quedo esperando instrucciones."

PARA CLIENTES (NO para Roberto):
- 🏡 INMOBILIARIO: "Te agendo una visita esta semana?"
- 📢 PROMARKET: "Agendamos tu auditoría?"
- 💪 BIOQUANTUM: "Empezamos mañana?"

_FUNCiones_: crear_landing, registra_proyecto, guardar_cliente, actualizar_inventario, webSearch, saveToMemory, searchMemory, assignTask.

MEMORIA: Firebase (memoria_maestra). ANTES de responder sobre proyectos, busca en memoria_maestra.
INVESTIGACIÓN: Si necesitas info actualizada (hoteles, competencia, tendencias), usa webSearch().
HABILIDAD PROACTIVA:
- Decide automáticamente qué herramienta usar
- Investiga antes de sugerir estrategias
- Asigna tareas a colaboradores automáticamente
- Registra documentos importantes en memoria_maestra`

async function askLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const system = systemPrompt || SYSTEM
  
  if (GROQ_API_KEY) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-70b-versatile",
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          temperature: 0.7
        })
      })
      const data = await res.json()
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content
    } catch (e) { console.error("Groq error:", e) }
  }
  
  if (XAI_API_KEY) {
    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${XAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
        })
      })
      const data = await res.json()
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content
    } catch (e) { console.error("xAI error:", e) }
  }
  
  for (const key of OPENROUTER_KEYS) {
    for (const model of MODELS) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://claudia-core-v3.vercel.app",
            "X-Title": "Claudia"
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
            temperature: 0.7
          })
        })
        const data = await res.json()
        if (data.choices?.[0]?.message?.content) return data.choices[0].message.content
      } catch (e) { continue }
    }
  }
  return "⚡ Intenta de nuevo."
}

bot.command("start", async (ctx) => {
  await ctx.reply("🚀 *CLAUDIA v3.3 - PROMARKET*\n\n" +
    "🏡 /parcelas - Tiempo Propiedades\n" +
    "🚗 /autos - Vehículos\n" +
    "📢 /promarket - Agencia\n" +
    "💪 /bioquantum - Fitness\n" +
    "📋 /proyectos\n" +
    "🤖 /genera\n\n📱 +56964681874", { parse_mode: "Markdown" })
})

bot.command("parcelas", async (ctx) => {
  await ctx.reply("🏡 *INVENTARIO TIEMPO PROPIEDADES*\n\n" +
    "• Chesque - 5.000m² - $45MM\n" +
    "• Cudico KM 20 - 10.000m² - $85MM\n" +
    "• Rodolfo y Jessica - 3.500m² - $38MM\n" +
    "• Conquil - 4.200m² - $42MM\n\n" +
    "🏠 Casa Los Volcanes - $185MM\n" +
    "🏠 Manuel Antonio - $450MM\n\n" +
    "📱 +56964681874", { parse_mode: "Markdown" })
})

bot.command("autos", async (ctx) => {
  await ctx.reply("🚗 *VEHÍCULOS EN VENTA*\n\n" +
    "• Toyota Yaris 2017\n" +
    "  - $5.900.000 (conversable)\n" +
    "  - Automático\n" +
    "  - 299.000 km\n" +
    "  - 1 owner • Título limpio\n" +
    "  - Excelente estado\n\n" +
    "⚠️ Detalles:\n" +
    "  • Óptico derecho roto\n" +
    "  • Bolladura parachoques\n\n" +
    "📍 Villarrica\n" +
    "📱 +56964681874", { parse_mode: "Markdown" })
})

bot.command("promarket", async (ctx) => {
  await ctx.reply("📢 *AGENCIA PROMARKET*\n\n" +
    "🎯 *Auditoría Gratuita:*\n" +
    "Revisamos tu Instagram y te damos plan de acción.\n\n" +
    "🛠 *Servicios:*\n" +
    "• Bots de Atención 24/7\n" +
    "• Automatizaciones n8n\n" +
    "• Desarrollo Web (Vercel)\n" +
    "• Agentes IA Personalizados\n\n" +
    "📞 *Agendamos tu auditoría?*\n" +
    "📱 +56964681874", { parse_mode: "Markdown" })
})

bot.command("bioquantum", async (ctx) => {
  await ctx.reply("💪 *BIOQUANTUM*\n\n" +
    "🎯 *Programa 90 días:*\n" +
    "• Entrenamiento personalizado\n" +
    "• Biofeedback cuántico\n" +
    "• Nutrición de precisión\n" +
    "• Recuperación avanzada\n\n" +
    "💬 *Tu transformación comienza ahora.*\n\n" +
    "📱 +56964681874", { parse_mode: "Markdown" })
})

bot.command("proyectos", async (ctx) => {
  const fbError = checkFirebase()
  if (fbError) { await ctx.reply("⚠️ " + fbError); return }
  try {
    const snapshot = await db!.collection("proyectos").get()
    if (snapshot.empty) { await ctx.reply("📋 No hay proyectos."); return }
    let text = "📋 *PROYECTOS:*\n\n"
    snapshot.docs.forEach(doc => { const p = doc.data(); text += `• ${p.name} (${p.tipo})\n` })
    await ctx.reply(text, { parse_mode: "Markdown" })
  } catch (e) { await ctx.reply("❌ Error.") }
})

bot.command("genera", async (ctx) => {
  await ctx.reply("💡 Escribe: 'genera landing de [proyecto]'\nEj: genera landing de Chesque")
})

bot.command("ayuda", async (ctx) => {
  await ctx.reply("📋 *COMANDOS:*\n\n" +
    "🏡 /parcelas - Inventario\n" +
    "🚗 /autos - Vehículos\n" +
    "📢 /promarket - Agencia\n" +
    "💪 /bioquantum - Fitness\n" +
    "📋 /proyectos\n" +
    "🤖 /genera - Landing\n" +
    "🔍 /buscar - Investigar\n" +
    "🧠 /memoria - Ver memoria\n" +
    "🧠 /boveda - Ver conocimiento\n\n💡 Escribe tu consulta y te respondo!", { parse_mode: "Markdown" })
})

bot.on("message:text", async (ctx) => {
  const txt = ctx.message?.text || ""
  const chatId = ctx.message?.chat?.id
  if (!txt || txt.startsWith("/")) return
  
  const fbError = checkFirebase()
  if (fbError && chatId !== ADMIN_ID) {
    await ctx.reply("⚠️ " + fbError)
    return
  }
  
  const response = await askLLM(txt)
  await ctx.reply(response)
})

const handleUpdate = webhookCallback(bot, "http")

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") {
    res.writeHead(200)
    res.end()
    return
  }
  
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "Claudia alive", firebase: firebaseReady, time: new Date().toISOString() }))
    return
  }
  
  if (req.method === "POST") {
    try {
      await handleUpdate(req, res)
      return
    } catch (e) {
      console.error("Webhook error:", e)
    }
  }
  
  res.writeHead(200)
  res.end("Claudia Bot Running")
}
