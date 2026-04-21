import { Bot, webhookCallback } from "grammy"
import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, Firestore } from "firebase-admin/firestore"
import { createServer, IncomingMessage, ServerResponse } from "http"

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "")
const OPENROUTER_KEYS = JSON.parse(process.env.OPENROUTER_KEYS || "[]")
const MODELS = ["google/gemini-2.0-flash-001", "minimax/minimax-m2.5:free"]
const WHISPER_KEY = process.env.WHISPER_KEY || ""
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_OWNER = process.env.GITHUB_OWNER || "promarket08-source"
const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const SHEETS_KEY = process.env.SHEETS_KEY
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "8754625349")
const TAVILY_KEY = process.env.TAVILY_KEY

async function think(prompt: string, context: string): Promise<string> {
  const thoughtPrompt = `Eres CLAUDIA. Antes de responder, PIENSA en voz baja en formato XML:
<pensamiento>
1. Analizar: ${prompt}
2. Verificar: permisos y contexto
3. Elegir: qué herramienta usar
4. Ejecutar: acción + verificar resultado
5. Responder: síntesis para el usuario
</pensamiento>
Contexto actual: ${context}
Tu respuesta:`
  return await askLLM(thoughtPrompt, SYSTEM)
}

async function saveKnowledge(nombre: string, categoria: string, datos: Record<string, any>, metadata?: string) {
  if (!db) return
  await db.collection("boveda_maestro").doc(nombre.toLowerCase().replace(/\s+/g, "_")).set({
    nombre, categoria, datos, metadata, createdAt: new Date(), updatedAt: new Date()
  })
  await bot.api.sendMessage(ADMIN_ID, `🧠 *Nuevo Conocimiento guardado:* ${nombre}`, { parse_mode: "Markdown" })
}

async function getKnowledge(nombre: string): Promise<any> {
  if (!db) return null
  const doc = await db.collection("boveda_maestro").doc(nombre.toLowerCase().replace(/\s+/g, "_")).get()
  return doc.exists ? doc.data() : null
}

async function searchKnowledge(categoria: string): Promise<string> {
  if (!db) return ""
  const snap = await db.collection("boveda_maestro").where("categoria", "==", categoria).get()
  if (!snap.empty) return snap.docs.map(d => `${d.id}: ${JSON.stringify(d.data().datos)}`).join("\n")
  return ""
}

async function extractFromImage(imageUrl: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_KEYS[0]}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe esta imagen en detail. Si es un documento, extrae los datos importantes (nombres, números, fechas)." },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }]
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || "No pude procesar la imagen."
  } catch (e) { return "Error al procesar imagen." }
}

async function processDocument(fileUrl: string, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop()
  if (ext === "pdf") {
    return "PDF recibido. Guárdalo en memoria? Escribe 'guarda en memoria'."
  }
  if (["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
    return await extractFromImage(fileUrl)
  }
  return "Documento recibido. ¿Qué hago con él?"
}

async function orchestrate(task: string): Promise<string> {
  const steps: string[] = []
  if (task.includes("crear") && task.includes("landing")) {
    steps.push("1. Verificar permisos de GitHub")
    steps.push("2. Seleccionar plantilla apropiada")
    steps.push("3. Crear archivo en GitHub")
    steps.push("4. Notificar deployment")
  } else if (task.includes("tarea") || task.includes("asignar")) {
    steps.push("1. Verificar usuario en Firebase")
    steps.push("2. Crear documento en tareas")
    steps.push("3. Notificar al asignado")
    steps.push("4. Reportar a Roberto")
  } else if (task.includes("investig") || task.includes("buscar")) {
    steps.push("1. Buscar en memoria local")
    steps.push("2. Consultar Tavily API")
    steps.push("3. Compilar resultados")
    steps.push("4. Presentar al usuario")
  }
  steps.push(`5. Ejecutando: ${task}`)
  return `🔄 *Orquestación:*\n${steps.join("\n")}`
}

async function webSearch(query: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, api_key: TAVILY_KEY })
    })
    const data = await res.json()
    if (!data.results?.length) return "No encontré información."
    const top = data.results.slice(0, 5)
    return top.map((r: any) => `• ${r.title}\n  ${r.url}`).join("\n")
  } catch (e) { return "Búsqueda no disponible." }
}

async function saveToMemory(tipo: string, titulo: string, contenido: string, url?: string) {
  if (!db) return
  await db.collection("memoria_maestra").add({
    tipo, titulo, contenido, url, createdAt: new Date()
  })
}

async function searchMemory(query: string): Promise<string> {
  if (!db) return "";
  const snap = await db.collection("memoria_maestra").get();
  const filteredDocs = snap.docs.filter(doc => {
    const record = doc.data();
    return record.titulo?.toLowerCase().includes(query.toLowerCase()) ||
           record.contenido?.toLowerCase().includes(query.toLowerCase());
  });
  if (!filteredDocs.length) return "";
  return filteredDocs.slice(0, 3).map(res => `• ${res.data().titulo}: ${res.data().contenido?.slice(0, 100)}...`).join("\n");
}

async function assignTask(assignedTo: string, titulo: string, descripcion: string) {
  if (!db) return
  await db.collection("tareas").add({
    titulo, descripcion, assignedTo, status: "pendiente", createdAt: new Date()
  })
}

async function checkTeamProgress(usuario: string) {
  if (!db) return "📡 Sin DB."
  const snap = await db.collection("tareas").where("assignedTo", "==", usuario).get()
  const pendientes = snap.docs.filter(d => d.data().status === "pendiente").length
  const completadas = snap.docs.filter(d => d.data().status === "completada").length
  return `👤 ${usuario}:\n• Pendientes: ${pendientes}\n• Completadas: ${completadas}`
}

const TEMPLATES: Record<string, string> = {
  inmobiliaria: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{{TITULO}} | TIEMPO PROPIEDADES</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff}
.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px}
.card{max-width:600px;background:rgba(255,255,255,0.05);border-radius:20px;padding:40px;border:1px solid rgba(255,255,255,0.1)}
h1{font-size:2.5rem;margin-bottom:20px;background:linear-gradient(90deg,#00ff88,#00ccff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.price{font-size:2rem;color:#00ff88;margin:20px 0}
.btn{display:inline-block;padding:15px 40px;background:linear-gradient(90deg,#00ff88,#00ccff);color:#000;text-decoration:none;border-radius:30px;font-weight:bold;margin-top:20px}
.features{list-style:none;padding:0}.features li{padding:8px 0}
</style></head>
<body><div class="hero"><div class="card">
<h1>{{TITULO}}</h1><p>{{DESCRIPCION}}</p>
<div class="price">{{PRECIO}}</div>
<ul class="features">{{FEATURES}}</ul>
<a href="https://wa.me/56964681874" class="btn">¡Contáctanos!</a>
</div></div></body></html>`,
  
  agencia: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{{TITULO}} | PROMARKET</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff}
.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px}
.card{max-width:600px;background:rgba(255,255,255,0.05);border-radius:20px;padding:40px;border:1px solid rgba(255,255,255,0.1)}
h1{font-size:2.5rem;margin-bottom:20px;background:linear-gradient(90deg,#ff6b6b,#ffd93d);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.services{list-style:none;padding:0;margin:20px 0}.services li{padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1)}
.btn{display:inline-block;padding:15px 40px;background:linear-gradient(90deg,#ff6b6b,#ffd93d);color:#000;text-decoration:none;border-radius:30px;font-weight:bold;margin-top:20px}
</style></head>
<body><div class="hero"><div class="card">
<h1>{{TITULO}}</h1><p>{{DESCRIPCION}}</p>
<ul class="services">{{SERVICES}}</ul>
<a href="https://wa.me/56964681874" class="btn">¡Hablemos!</a>
</div></div></body></html>`,
  
  gym: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{{TITULO}} | BIOQUANTUM</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff}
.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#0f3460);padding:40px}
.card{max-width:600px;background:rgba(255,255,255,0.05);border-radius:20px;padding:40px;border:1px solid rgba(255,255,255,0.1)}
h1{font-size:2.5rem;margin-bottom:20px;background:linear-gradient(90deg,#e94560,#0f3460);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.price{font-size:2rem;color:#e94560;margin:20px 0}
.btn{display:inline-block;padding:15px 40px;background:linear-gradient(90deg,#e94560,#ff6b6b);color:#fff;text-decoration:none;border-radius:30px;font-weight:bold;margin-top:20px}
.features{list-style:none;padding:0}.features li{padding:8px 0}
</style></head>
<body><div class="hero"><div class="card">
<h1>{{TITULO}}</h1><p>{{DESCRIPCION}}</p>
<div class="price">{{PRECIO}}</div>
<ul class="features">{{FEATURES}}</ul>
<a href="https://wa.me/56964681874" class="btn">¡Transforma tu Vida!</a>
</div></div></body></html>`
}
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
- En lugar de "Te agendo en WhatsApp": "Quedo atenta a su próxima instrucción, Roberto"
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

async function actualizar_inventario(): Promise<string> {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Inventario!A2:F?key=${SHEETS_KEY}`)
    const data = await res.json()
    if (!data.values || data.values.length === 0) return ""
    let inv = "\n--- INVENTARIO ACTUALIZADO ---\n"
    data.values.forEach((row: any[]) => {
      inv += `• ${row[0]} - ${row[1]} - ${row[2]}\n`
    })
    return inv
  } catch (e) { return "" }
}

async function crear_landing(project: string): Promise<string> {
  const content = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${project} | PROMARKET</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff}
.hero{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px}
.card{max-width:600px;background:rgba(255,255,255,0.05);border-radius:20px;padding:40px;border:1px solid rgba(255,255,255,0.1)}
h1{font-size:2.5rem;margin-bottom:20px;background:linear-gradient(90deg,#00ff88,#00ccff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.price{font-size:2rem;color:#00ff88;margin:20px 0}
.btn{display:inline-block;padding:15px 40px;background:linear-gradient(90deg,#00ff88,#00ccff);color:#000;text-decoration:none;border-radius:30px;font-weight:bold;margin-top:20px}
</style></head>
<body><div class="hero"><div class="card">
<h1>${project}</h1><p>Parcela premium en Villarrica.</p>
<div class="price">$45MM</div>
<ul><li>✅ Vista Volcán</li><li>✅ Agua y Luz</li><li>✅ Inversión segura</li></ul>
<a href="https://wa.me/56964681874" class="btn">¡Invierte Ahora!</a>
</div></div></body></html>`

  try {
    const filename = project.toLowerCase().replace(/\s+/g, "-")
    await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/claudia-core-v3/contents/lands/${filename}.html`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Auto: ${project}`,
        content: Buffer.from(content).toString("base64")
      })
    })
    return `✅ Landing de '${project}' creada!`
  } catch (e) { return "❌ Error: " + e }
}

async function getTemplate(tipo: string): string {
  const tipoMap: Record<string, string> = {
    propiedades: "inmobiliaria", parcela: "inmobiliaria", casa: "inmobiliaria", terreno: "inmobiliaria",
    marketing: "agencia", agencia: "agencia", publicidad: "agencia",
    gym: "gym", fitness: "gym", bioquantum: "gym", entrenamiento: "gym"
  }
  const template = TEMPLATES[tipoMap[tipo.toLowerCase()] || "inmobiliaria"]
  return template || TEMPLATES.inmobiliaria
}

async function deploying_landing(args: {
  nombre: string
  tipo: string
  titulo?: string
  descripcion?: string
  precio?: string
  features?: string
  services?: string
}): Promise<string> {
  const template = await getTemplate(args.tipo)
  let content = template
    .replace(/{{TITULO}}/g, args.titulo || args.nombre)
    .replace(/{{DESCRIPCION}}/g, args.descripcion || "")
    .replace(/{{PRECIO}}/g, args.precio || "")
    .replace(/{{FEATURES}}/g, args.features || "")
    .replace(/{{SERVICES}}/g, args.services || "")
  
  const repoName = `landing-${args.nombre.toLowerCase().replace(/\s+/g, "-")}`
  const filename = `${repoName}.html`
  
  try {
    await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/claudia-core-v3/contents/lands/${filename}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Auto landing: ${args.nombre}`,
        content: Buffer.from(content).toString("base64")
      })
    })
    
    try {
      await fetch(`https://api.vercel.com/v6/deployments`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${VERCEL_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          files: [{ file: "index.html", data: Buffer.from(content).toString("base64") }],
          name: repoName,
          project: "claudia-core-v3",
          settings: { outputDirectory: "/" }
        })
      })
    } catch (e) {}
    
    return `🚀 *${args.nombre}* desplegado!\n\n` +
      `📁 Repo: promarket08-source/claudia-core-v3/lands/${filename}\n` +
      `🔗 Live: https://claudia-core-v3.vercel.app/lands/${repoName}.html`
  } catch (e) { return `❌ Error: ${e}` }
}

async function registra_proyecto(name: string, tipo: string, link: string) {
  if (!db) return
  await db.collection("proyectos").doc(name.toLowerCase().replace(/\s+/g, "_")).set({
    name, tipo, link, status: "creado", createdAt: new Date()
  })
}

async function askLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const system = systemPrompt || SYSTEM
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
    snapshot.docs.forEach(d => { const p = d.data(); text += `• ${p.name} (${p.tipo})\n` })
    await ctx.reply(text, { parse_mode: "Markdown" })
  } catch (e) { await ctx.reply("❌ Error.") }
})

bot.command("genera", async (ctx) => {
  await ctx.reply("💡 Escribe: 'genera landing de [proyecto]'\nEj: genera landing de Chesque")
})

bot.command("nuevo_sistema", async (ctx) => {
  const args = ctx.message?.text?.replace("/nuevo_sistema", "").trim().split(" ")
  if (!args || args.length < 2) {
    await ctx.reply("📋 Uso: /nuevo_sistema [Nombre] [Rubro]\nEj: /nuevo_sistema Gimnasio fitness")
    return
  }
  const nombre = args[0]
  const tipo = args.slice(1).join(" ")
  await ctx.reply(`🚀 Creando *${nombre}* (${tipo})...`)
  const result = await deploying_landing({ nombre, tipo })
  await ctx.reply(result, { parse_mode: "Markdown" })
})

bot.command("plantillas", async (ctx) => {
  await ctx.reply("📋 *PLANTILLAS DISPONIBLES:*\n\n" +
    "🏡 inmobiliaria - Parcelas/Casas\n" +
    "📢 agencia - Marketing\n" +
    "💪 gym - Fitness\n\n" +
    "Usa: /nuevo_sistema [Nombre] [Tipo]", { parse_mode: "Markdown" })
})

bot.command("usuarios", async (ctx) => {
  if (ctx.message?.chat?.id !== ADMIN_ID) { await ctx.reply("🔒 Solo Roberto."); return }
  if (!db) { await ctx.reply("📡 Offline."); return }
  const snapshot = await db.collection("usuarios").get()
  if (snapshot.empty) { await ctx.reply("👥 No hay usuarios."); return }
  let text = "👥 *USUARIOS:*\n\n"
  snapshot.docs.forEach(d => {
    const u = d.data()
    text += `• ${u.nombre} (${u.rol})\n  ID: ${u.telegram_id}\n`
  })
  await ctx.reply(text, { parse_mode: "Markdown" })
})

bot.command("invitar", async (ctx) => {
  if (ctx.message?.chat?.id !== ADMIN_ID) { await ctx.reply("🔒 Solo Roberto."); return }
  const args = ctx.message?.text?.replace("/invitar", "").trim().split(" ")
  if (!args || args.length < 3) {
    await ctx.reply("📋 Uso: /invitar [Nombre] [ID_Telegram] [Rol]\nEj: /invitar Julian 123456789 Vendedor")
    return
  }
  const nombre = args[0]
  const telegram_id = parseInt(args[1])
  const rol = args.slice(2).join(" ").toLowerCase()
  if (!db) { await ctx.reply("📡 Error: Sin DB."); return }
  await db.collection("usuarios").doc(String(telegram_id)).set({
    telegram_id, nombre, rol, proyectos_autorizados: [], createdAt: new Date()
  })
  await ctx.reply(`✅ *Usuario añadido:*\n\n• Nombre: ${nombre}\n• ID: ${telegram_id}\n• Rol: ${rol}`, { parse_mode: "Markdown" })
})

bot.command("inventario", async (ctx) => {
  if (ctx.message?.chat?.id !== ADMIN_ID) { await ctx.reply("🔒 Solo Roberto."); return }
  const args = ctx.message?.text?.replace("/inventario", "").trim()
  if (!args) {
    await ctx.reply("📋 Uso: /inventario [tipo] [datos]\nEj: /inventario parcelas Chesque - 5000m2 - $45MM")
    return
  }
  const lines = args.split("\n")
  let saved = 0
  for (const line of lines) {
    const parts = line.split(" - ")
    if (parts.length >= 2) {
      const [nombre, ...rest] = parts
      await db?.collection("inventario").doc(nombre.trim()).set({
        nombre: nombre.trim(),
        detalle: rest.join(" - ").trim(),
        updatedAt: new Date()
      })
      saved++
    }
  }
  await ctx.reply(`✅ *Inventario actualizado:* ${saved} items guardados en el Dashboard.`, { parse_mode: "Markdown" })
})

bot.command("ayuda", async (ctx) => {
  await ctx.reply("📋 *COMANDOS:*\n\n" +
    "🏡 /parcelas - Inventario\n" +
    "🚗 /autos - Vehículos\n" +
    "📢 /promarket - Agencia\n" +
    "💪 /bioquantum - Fitness\n" +
    "📋 /proyectos\n" +
    "🤖 /genera - Landing简单\n" +
    "🚀 /nuevo_sistema - Landing completa\n" +
    "📁 /plantillas\n" +
    "👥 /usuarios\n" +
    "📊 /equipo - Progreso del equipo\n" +
    "🔍 /buscar - Investigar en web\n" +
    "🧠 /memoria - Ver memoria\n" +
    "🧠 /boveda - Ver conocimiento\n\n💡 *ACCIONES:*\n" +
    "• genera landing de Chesque\n" +
    "• /nuevo_sistema Gimnasio gym\n" +
    "• anota tarea Llamar a cliente\n" +
    "• asigna tarea a Julian\n" +
    "• guarda en memoria (con imagen/pdf)", { parse_mode: "Markdown" })
})

bot.command("equipo", async (ctx) => {
  if (!db) { await ctx.reply("📡 Offline."); return }
  const usuarios = await db.collection("usuarios").where("rol", "!=", "admin").get()
  let text = "👥 *EQUIPO:*\n\n"
  for (const d of usuarios.docs) {
    const u = d.data()
    const tareas = await db.collection("tareas").where("assignedTo", "==", u.nombre).get()
    const pend = tareas.docs.filter(t => t.data().status === "pendiente").length
    text += `• ${u.nombre}: ${pend} tareas pendientes\n`
  }
  await ctx.reply(text, { parse_mode: "Markdown" })
})

bot.command("buscar", async (ctx) => {
  const args = ctx.message?.text?.replace("/buscar", "").trim()
  if (!args) { await ctx.reply("🔍 Uso: /buscar [tema]"); return }
  await ctx.reply(`🔎 Investigando: ${args}...`)
  const results = await webSearch(args)
  await ctx.reply(`🔍 *Resultados:*\n\n${results}`, { parse_mode: "Markdown" })
})

bot.command("memoria", async (ctx) => {
  const args = ctx.message?.text?.replace("/memoria", "").trim()
  if (!args) {
    if (!db) { await ctx.reply("📡 Offline."); return }
    const snap = await db.collection("memoria_maestra").get()
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 10)
    await ctx.reply(`🧠 *MEMORIA MAESTRA:*\n\n${data.map((x: any) => `• ${x.titulo} (${x.tipo})`).join("\n")}`, { parse_mode: "Markdown" })
    return
  }
  const results = await searchMemory(args)
  await ctx.reply(`🧠 *Resultados:*\n\n${results || "No encontré nada."}`, { parse_mode: "Markdown" })
})

bot.command("boveda", async (ctx) => {
  const args = ctx.message?.text?.replace("/boveda", "").trim()
  const args2 = ctx.message?.text?.replace("/boveda", "").trim().split(" ")
  if (!args) {
    if (!db) { await ctx.reply("📡 Offline."); return }
    const snap = await db.collection("boveda_maestro").get()
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 10)
    await ctx.reply(`🧠 *BÓVEDA MAESTRA:*\n\n${data.map((x: any) => `• ${x.nombre} (${x.categoria})`).join("\n")}`, { parse_mode: "Markdown" })
    return
  }
  const cat = args2[0]
  if (args2.length > 1) {
    const results = await searchKnowledge(cat)
    await ctx.reply(`🧠 *${cat}:*\n\n${results || "No hay conocimiento en esta categoría."}`, { parse_mode: "Markdown" })
  } else {
    const know = await getKnowledge(args)
    await ctx.reply(`🧠 *${args}:*\n\n${know ? JSON.stringify(know.datos, null, 2) : "No encontrado."}`, { parse_mode: "Markdown" })
  }
})

bot.command("orquesta", async (ctx) => {
  const args = ctx.message?.text?.replace("/orquesta", "").trim()
  if (!args) { await ctx.reply("📋 Uso: /orquesta [tarea]\nEj: /orquesta crear landing para Julian"); return }
  const plan = await orchestate(args)
  await ctx.reply(plan, { parse_mode: "Markdown" })
})

async function transcribeAudio(fileUrl: string): Promise<string> {
  try {
    const audioRes = await fetch(fileUrl)
    const audioBuffer = await audioRes.arrayBuffer()
    const base64 = Buffer.from(audioBuffer).toString("base64")
    const res = await fetch("https://api.openai.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHISPER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ file: base64, model: "whisper-1" })
    })
    const data = await res.json()
    return data.text || "No pude transcribir el audio."
  } catch (e) { return "Audio recibido. Transcríbelo por favor." }
}

bot.on("message:voice", async (ctx) => {
  await ctx.reply("🎤 Procesando audio...")
  const file = await ctx.api.getFile(ctx.message?.voice?.file_id || "")
  const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
  const text = await transcribeAudio(fileUrl)
  const response = await askLLM(text)
  await ctx.reply(response)
})

bot.on("message:photo", async (ctx) => {
  if (ctx.message?.chat?.id !== ADMIN_ID) return
  await ctx.reply("🖼️ Procesando imagen...")
  const file = await ctx.api.getFile(ctx.message?.photo?.[ctx.message.photo.length - 1]?.file_id || "")
  const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
  const extracted = await extractFromImage(fileUrl)
  await ctx.reply(`🖼️ *Extracción:*\n\n${extracted}`, { parse_mode: "Markdown" })
})

bot.on("message:document", async (ctx) => {
  if (ctx.message?.chat?.id !== ADMIN_ID) return
  await ctx.reply("📄 Procesando documento...")
  const file = await ctx.api.getFile(ctx.message?.document?.file_id || "")
  const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
  const fileName = ctx.message?.document?.file_name || "documento"
  const processed = await processDocument(fileUrl, fileName)
  await ctx.reply(processed)
})

function getUser(chatId: number) {
  if (!db) return null
  return db.collection("usuarios").doc(String(chatId)).get().then(d => d.exists ? d.data() : null)
}

async function checkAccess(chatId: number): Promise<{allowed: boolean, user?: any}> {
  if (chatId === ADMIN_ID) return { allowed: true, user: { nombre: "Roberto", rol: "admin" } }
  const user = await getUser(chatId)
  if (!user) return { allowed: false }
  return { allowed: true, user }
}

bot.on("message:text", async (ctx) => {
  const txt = ctx.message?.text || ""
  const chatId = ctx.message?.chat?.id
  if (!txt || txt.startsWith("/")) return
  
  const fbError = checkFirebase()
  if (fbError && chatId !== ADMIN_ID) {
    await ctx.reply("⚠️ " + fbError)
    return
  }
  
  if (chatId && firebaseReady) await saveClient(chatId, ctx.message?.chat?.first_name || "Usuario", txt)
  const isGenera = txt.toLowerCase().match(/genera (landing )?de (.+)/)
  if (isGenera) {
    const project = isGenera[2].trim()
    await ctx.reply("🛠️ Generando landing...")
    const result = await crear_landing(project)
    await ctx.reply(result)
  } else {
    const isTarea = txt.toLowerCase().match(/(?:anota|registra|nueva) tarea? (.+)/)
    if (isTarea) {
      if (!firebaseReady) {
        await ctx.reply("⚠️ " + fbError)
        return
      }
      const title = isTarea[1].trim()
      await addTask(title)
      await ctx.reply(`✅ *Tarea registrada:* ${title}`, { parse_mode: "Markdown" })
    } else {
      const isNuevo = txt.toLowerCase().match(/nuevo sistema? (.+)/)
      if (isNuevo) {
        const nombre = isNuevo[1].trim()
        await ctx.reply(`🚀 Creando sistema ${nombre}...`)
        const result = await deploying_landing({ nombre, tipo: "inmobiliaria" })
        await ctx.reply(result, { parse_mode: "Markdown" })
      } else {
        if (!firebaseReady) {
          const response = await askLLM(txt)
          await ctx.reply(response)
          return
        }
        const { allowed, user: usuario } = await checkAccess(chatId!)
        if (!allowed) {
          await ctx.reply("🔒 *Acceso Denegado*\n\nNo tienes acceso autorizado.\nContacta a Roberto en el Dashboard.", { parse_mode: "Markdown" })
          return
        }
        const systemDinamico = usuario.rol === "admin" ? SYSTEM : 
          `${SYSTEM}\n\n--- CONFIGURACIÓN ---\nUsuario: ${usuario.nombre}\nRol: ${usuario.rol}\nProyectos: ${usuario.proyectos_autorizados?.join(", ") || "Todos"}\n\nLimitación: Solo puedes hablar de los proyectos autorizados.`
        const response = await askLLM(txt, systemDinamico)
        await ctx.reply(response)
      }
    }
  }
})

const API_PORT = parseInt(process.env.PORT || "3000")

async function saveClient(chatId: number, name: string, query: string) {
  if (!db) return
  await db.collection("clientes").doc(String(chatId)).set({
    chatId, name, query, updatedAt: new Date()
  }, { merge: true })
}

async function addTask(title: string, client?: string) {
  if (!db) return
  const taskRef = db.collection("tareas").doc()
  await taskRef.set({
    title, client, status: "pendiente", createdAt: new Date()
  })
  return taskRef.id
}

async function updateIngresos(monto: number, descripcion: string) {
  if (!db) return
  const statsRef = db.collection("stats").doc("ingresos")
  const d = await statsRef.get()
  const current = d.exists ? (d.data()?.total || 0) : 0
  await statsRef.set({ total: current + monto, updatedAt: new Date() })
  await db.collection("historial_ingresos").add({
    monto, descripcion, createdAt: new Date()
  })
}

const apiServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url || "/"
  const pathname = url.split("?")[0]
  
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "Claudia alive", firebase: firebaseReady, time: new Date().toISOString() }))
    return
  }
  
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") {
    res.writeHead(200)
    res.end()
    return
  }
  
  try {
    if (pathname === "/api/clientes") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      const snapshot = await db.collection("clientes").get()
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
      return
    }
    
    if (pathname === "/api/proyectos") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      const snapshot = await db.collection("proyectos").get()
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
      return
    }
    
    if (pathname === "/api/tareas") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      const snapshot = await db.collection("tareas").get()
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
      return
    }
    
    if (pathname === "/api/stats") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      const d = await db.collection("stats").doc("ingresos").get()
      const data = d.exists ? d.data() : { total: 0 }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
      return
    }

    if (pathname === "/api/usuarios") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      if (req.method === "GET") {
        const snapshot = await db.collection("usuarios").get()
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(data))
        return
      }
      if (req.method === "POST") {
        let body = ""
        req.on("data", chunk => body += chunk)
        req.on("end", async () => {
          const { telegram_id, nombre, rol, proyectos_autorizados } = JSON.parse(body)
          await db.collection("usuarios").doc(String(telegram_id)).set({
            telegram_id: Number(telegram_id), nombre, rol, proyectos_autorizados: proyectos_autorizados || [], createdAt: new Date()
          })
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ success: true }))
        })
        return
      }
      if (req.method === "DELETE") {
        const id = url.split("?")[1]?.split("=")[1]
        if (id) await db.collection("usuarios").doc(id).delete()
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true }))
        return
      }
    }

    if (pathname === "/api/memoria") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      if (req.method === "GET") {
        const q = new URL(url, "http://localhost").searchParams.get("q") || ""
        const snapshot = await db.collection("memoria_maestra").get()
        let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        if (q) data = data.filter((x: any) => x.titulo?.toLowerCase().includes(q.toLowerCase()))
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(data.slice(0, 20)))
        return
      }
      if (req.method === "POST") {
        let body = ""
        req.on("data", chunk => body += chunk)
        req.on("end", async () => {
          const { tipo, titulo, contenido, url } = JSON.parse(body)
          await db.collection("memoria_maestra").add({ tipo, titulo, contenido, url, createdAt: new Date() })
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ success: true }))
        })
        return
      }
    }

    if (pathname === "/api/buscar") {
      const q = new URL(url, "http://localhost").searchParams.get("q")
      if (q) {
        const results = await webSearch(q)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ results }))
        return
      }
    }

    if (pathname === "/api/boveda") {
      if (!db) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "NoDB" })); return }
      if (req.method === "GET") {
        const nombre = new URL(url, "http://localhost").searchParams.get("nombre")
        if (nombre) {
          const d = await db.collection("boveda_maestro").doc(nombre.toLowerCase().replace(/\s+/g, "_")).get()
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(d.exists ? d.data() : { error: "No encontrado" }))
          return
        }
        const snapshot = await db.collection("boveda_maestro").get()
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(data))
        return
      }
      if (req.method === "POST") {
        let body = ""
        req.on("data", chunk => body += chunk)
        req.on("end", async () => {
          const { nombre, categoria, datos, metadata } = JSON.parse(body)
          await saveKnowledge(nombre, categoria, datos, metadata)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ success: true }))
        })
        return
      }
    }

    if (pathname === "/api/think") {
      const p = new URL(url, "http://localhost").searchParams.get("p")
      const c = new URL(url, "http://localhost").searchParams.get("c") || ""
      if (p) {
        const thought = await think(p, c)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ thought }))
        return
      }
    }

    if (pathname === "/api/orquesta") {
      const t = new URL(url, "http://localhost").searchParams.get("t")
      if (t) {
        const plan = await orchestate(t)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ plan }))
        return
      }
    }
    
    if (pathname === "/api/telegram") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", async () => {
        try {
          const { action, chatId, message } = JSON.parse(body)
          if (action === "send") {
            await bot.api.sendMessage(chatId, message)
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ success: true }))
          } else {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "Invalid action" }))
          }
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
      return
    }
    
    if (pathname === "/api/task" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", async () => {
        const { title, client } = JSON.parse(body)
        const id = await addTask(title, client)
        if (db) {
          await bot.api.sendMessage(8754625349, `📝 *Nueva Tarea:* ${title}${client ? ` (${client})` : ""}`, { parse_mode: "Markdown" })
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true, id }))
      })
      return
    }
    
    if (pathname === "/api/ingreso" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", async () => {
        const { monto, descripcion } = JSON.parse(body)
        await updateIngresos(monto, descripcion)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true }))
      })
      return
    }
    
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: String(e) }))
  }
})

export default webhookCallback(bot, "http")