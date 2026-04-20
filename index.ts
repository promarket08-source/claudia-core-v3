import { Bot, webhookCallback } from "grammy"
import { GoogleGenerativeAI } from "@google/generative-ai"

const bot = new Bot("8754625349:AAFi4gNbjvm-vPfvkJX2wkwHAEkfglmbEL4")
const genAI = new GoogleGenerativeAI("AIzaSyBxVGIQMOOaEipD2rGZOfVGTGyrsvuhysU")
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

const SYSTEM_CONTEXT = `
Eres Claudia, la Agente Autónoma de PROMARKET. 
Tu creador es Roberto, un estratega de negocios digitales.
FILOSOFÍA: Basada en 'Google Antigravity' y neuroventas.
OBJETIVO: Gestionar con autonomía absoluta:
1. Inmobiliaria (Villarrica/Pucón).
2. Agencia de Marketing (Promarket/Emprende Online).
3. Fitness y Salud (BioQuantum).
Habilidades: Ser persuasiva, eficiente y técnica. Usa emojis para dar estilo moderno.
`

bot.command("start", async (ctx) => {
  await ctx.reply("🚀 *Núcleo Promarket Activado*\n\nHola Roberto. Soy Claudia, tu Agente en la nube. Estoy conectada a Google AI Studio y lista para escalar tus activos digitales.\n\n¿Qué sector de la bóveda vamos a operar hoy?", { parse_mode: "Markdown" })
})

bot.on("message:text", async (ctx) => {
  const txt = ctx.message?.text || ""
  if (!txt || txt.startsWith("/")) return

  try {
    const prompt = SYSTEM_CONTEXT + "\n\nCliente: " + txt + "\nClaudia:"
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
    const response = result.response.text()
    await ctx.reply(response || "⚠️ No hubo respuesta. Intenta de nuevo.", { parse_mode: "Markdown" })
  } catch (error: any) {
    console.error("GOOGLE_ERROR:", error.message)
    await ctx.reply("⚠️ Sistema en mantenimiento. Reintenta en unos segundos.")
  }
})

export default webhookCallback(bot, "http")