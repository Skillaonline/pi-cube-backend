// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const prisma = new PrismaClient();

// Health-check
app.get("/", (_req, res) => res.send("Pi-Куб API is running"));

// Сценарии
app.post("/api/scenarios", async (req: Request<{}, {}, { title?: string }>, res, next) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Missing title" });
    const scenario = await prisma.scenario.create({
      data: {
        title,
        author: {
          connectOrCreate: {
            where: { id: "anonymous" },
            create: { id: "anonymous", email: "anon@pi-kub", password: "", role: "USER" },
          },
        },
      },
    });
    res.status(201).json({ scenario });
  } catch (e) { next(e) }
});
app.get("/api/scenarios", async (_req, res, next) => {
  try {
    const scenarios = await prisma.scenario.findMany({ include: { steps: true }, orderBy: { createdAt: "asc" } });
    res.json({ scenarios });
  } catch (e) { next(e) }
});
app.get("/api/scenarios/:id", async (req: Request<{id:string}>, res, next) => {
  try {
    const s = await prisma.scenario.findUnique({ where: { id: req.params.id }, include: { steps: true } });
    if (!s) return res.status(404).json({ error: "Not found" });
    res.json({ scenario: s });
  } catch (e) { next(e) }
});

// Шаги
app.post("/api/scenarios/:id/steps", async (req: Request<{id:string}, {}, {content?:string}>, res, next) => {
  try {
    const { id } = req.params, { content } = req.body;
    if (!content) return res.status(400).json({ error: "Missing content" });
    if (!(await prisma.scenario.count({ where: { id } }))) return res.status(404).json({ error: "Scenario not found" });
    const step = await prisma.step.create({ data: { content, scenario: { connect: { id } } } });
    res.status(201).json({ step });
  } catch (e) { next(e) }
});

app.post("/api/scenarios/:id/generate-step", async (req: Request<{id:string}>, res, next) => {
  try {
    const { id } = req.params;
    const scen = await prisma.scenario.findUnique({ where: { id } });
    if (!scen) return res.status(404).json({ error: "Scenario not found" });
    const history = await prisma.step.findMany({ where: { scenarioId: id }, orderBy: { createdAt: "asc" } });
    const prompt = `Сценарий "${scen.title}". Предыдущие шаги:\n` +
      history.map((s,i)=>`${i+1}. ${s.content}`).join("\n") +
      `\nСгенерируй следующий шаг одним предложением.`;
    let aiText = "Тестовый шаг (AI-заглушка).";
    try {
      const c = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{role:"user",content:prompt}], max_tokens:100 });
      aiText = c.choices[0].message?.content?.trim() || aiText;
    } catch { /* fallback */ }
    const step = await prisma.step.create({ data: { content: aiText, scenario: { connect: { id } } } });
    await prisma.pointTransaction.create({ data: { userId:"anonymous", type:"AI_STEP", amount:5 } });
    res.status(201).json({ step });
  } catch (e) { next(e) }
});

// Завершение шага
app.post("/api/scenarios/:id/complete-step", async (req: Request<{}, {}, {stepId?:string}>, res, next) => {
  try {
    const { stepId } = req.body;
    if (!stepId) return res.status(400).json({ error:"Missing stepId" });
    if (!(await prisma.step.count({ where:{ id:stepId } }))) return res.status(404).json({ error:"Step not found" });
    await prisma.pointTransaction.create({ data:{ userId:"anonymous", type:"COMPLETE_STEP", amount:10 } });
    const agg = await prisma.pointTransaction.aggregate({ where:{ userId:"anonymous" }, _sum:{ amount:true } });
    res.json({ points: agg._sum.amount||0 });
  } catch (e) { next(e) }
});

// IDP
app.post("/api/idp", async (_req, res, next) => {
  try {
    const agg = await prisma.pointTransaction.aggregate({ where:{ userId:"anonymous" }, _sum:{ amount:true } });
    const points = agg._sum.amount||0;
    const total = await prisma.step.count({ where:{ scenario:{ authorId:"anonymous" } } });
    const prompt = `У участника ${points} очков и ${total} шагов. Дай 3 рекомендации.`;
    let idp: string[];
    try {
      const c = await openai.chat.completions.create({ model:"gpt-3.5-turbo", messages:[{role:"user",content:prompt}], max_tokens:200 });
      idp = c.choices[0].message?.content?.split(/\r?\n/).map(l=>l.replace(/^\d+\.\s*/,"").trim()).filter(Boolean) as string[];
    } catch {
      idp = ["Практикуйте активное слушание.","Развивайте тайм-менеджмент.","Улучшайте эмоциональный интеллект."];
    }
    res.json({ idp });
  } catch (e) { next(e) }
});

// Ошибки
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message||"Server error" });
});

// Старт
app.listen(PORT, () => console.log(`Server is up on http://localhost:${PORT}`));
