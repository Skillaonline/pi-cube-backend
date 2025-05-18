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

// ——— Health-check ———
app.get("/", (_req, res) => {
  res.send("Pi-Куб API is running");
});

// ——— Сценарии ———

// Создать новый сценарий
app.post<{}, {}, { title?: string }>(
  "/api/scenarios",
  async (req, res, next) => {
    try {
      const { title } = req.body;
      if (!title) {
        res.status(400).json({ error: "Missing title" });
        return;
      }
      const scenario = await prisma.scenario.create({
        data: {
          title,
          author: {
            connectOrCreate: {
              where: { id: "anonymous" },
              create: {
                id: "anonymous",
                email: "anon@pi-kub",
                password: "",
                role: "USER",
              },
            },
          },
        },
      });
      res.status(201).json({ scenario });
    } catch (err) {
      next(err);
    }
  }
);

// Список сценариев
app.get<{}, {}, {}>(
  "/api/scenarios",
  async (_req, res, next) => {
    try {
      const scenarios = await prisma.scenario.findMany({
        include: { steps: true },
        orderBy: { createdAt: "asc" },
      });
      res.json({ scenarios });
    } catch (err) {
      next(err);
    }
  }
);

// Конкретный сценарий
app.get<{ id: string }, {}, {}>(
  "/api/scenarios/:id",
  async (req, res, next) => {
    try {
      const scenario = await prisma.scenario.findUnique({
        where: { id: req.params.id },
        include: { steps: true },
      });
      if (!scenario) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json({ scenario });
    } catch (err) {
      next(err);
    }
  }
);

// ——— Шаги ———

// Добавить шаг вручную
app.post<{ id: string }, {}, { content?: string }>(
  "/api/scenarios/:id/steps",
  async (req, res, next) => {
    try {
      const { content } = req.body;
      if (!content) {
        res.status(400).json({ error: "Missing content" });
        return;
      }
      const exists = await prisma.scenario.count({
        where: { id: req.params.id },
      });
      if (!exists) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const step = await prisma.step.create({
        data: { content, scenario: { connect: { id: req.params.id } } },
      });
      res.status(201).json({ step });
    } catch (err) {
      next(err);
    }
  }
);

// Сгенерировать шаг через AI
app.post<{ id: string }, {}, {}>(
  "/api/scenarios/:id/generate-step",
  async (req, res, next) => {
    try {
      const scen = await prisma.scenario.findUnique({
        where: { id: req.params.id },
      });
      if (!scen) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      const history = await prisma.step.findMany({
        where: { scenarioId: req.params.id },
        orderBy: { createdAt: "asc" },
      });
      const prompt =
        `Сценарий "${scen.title}". Предыдущие шаги:\n` +
        history.map((s, i) => `${i + 1}. ${s.content}`).join("\n") +
        `\nСгенерируй следующий шаг одним предложением.`;
      let aiText = "Тестовый шаг (AI-заглушка).";
      try {
        const c = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 100,
        });
        aiText = c.choices[0].message?.content?.trim() || aiText;
      } catch {
        // fallback
      }
      const step = await prisma.step.create({
        data: { content: aiText, scenario: { connect: { id: req.params.id } } },
      });
      await prisma.pointTransaction.create({
        data: { userId: "anonymous", type: "AI_STEP", amount: 5 },
      });
      res.status(201).json({ step });
    } catch (err) {
      next(err);
    }
  }
);

// Завершить шаг
app.post<{}, {}, { stepId?: string }>(
  "/api/scenarios/:id/complete-step",
  async (req, res, next) => {
    try {
      const { stepId } = req.body;
      if (!stepId) {
        res.status(400).json({ error: "Missing stepId" });
        return;
      }
      const exists = await prisma.step.count({
        where: { id: stepId },
      });
      if (!exists) {
        res.status(404).json({ error: "Step not found" });
        return;
      }
      await prisma.pointTransaction.create({
        data: {
          userId: "anonymous",
          type: "COMPLETE_STEP",
          amount: 10,
        },
      });
      const agg = await prisma.pointTransaction.aggregate({
        where: { userId: "anonymous" },
        _sum: { amount: true },
      });
      res.json({ points: agg._sum.amount || 0 });
    } catch (err) {
      next(err);
    }
  }
);

// ——— Assessment & IDP ———
app.post<{}, {}, {}>(
  "/api/assessment-complete",
  async (_req, res, next) => {
    try {
      await prisma.pointTransaction.create({
        data: { userId: "anonymous", type: "ASSESSMENT", amount: 30 },
      });
      const agg = await prisma.pointTransaction.aggregate({
        where: { userId: "anonymous" },
        _sum: { amount: true },
      });
      res.json({ points: agg._sum.amount || 0 });
    } catch (err) {
      next(err);
    }
  }
);

app.get<{}, {}, {}>(
  "/api/points",
  async (_req, res, next) => {
    try {
      const agg = await prisma.pointTransaction.aggregate({
        where: { userId: "anonymous" },
        _sum: { amount: true },
      });
      const points = agg._sum.amount || 0;
      const level = Math.floor(points / 100);
      res.json({ points, level });
    } catch (err) {
      next(err);
    }
  }
);

app.post<{}, {}, {}>(
  "/api/idp",
  async (_req, res, next) => {
    try {
      // Собираем суммарные очки
      const agg = await prisma.pointTransaction.aggregate({
        where: { userId: "anonymous" },
        _sum: { amount: true },
      });
      const points = agg._sum.amount || 0;

      // Считаем все шаги
      const totalSteps = await prisma.step.count({
        where: { scenario: { authorId: "anonymous" } },
      });

      // Запрос к OpenAI и безопасная обработка nullable content
      const raw =
        (
          await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "user",
                content: `У участника ${points} очков и ${totalSteps} шагов. Дай 3 рекомендации по развитию soft-skills.`,
              },
            ],
            max_tokens: 200,
          })
        ).choices[0].message?.content || "";

      // Разбиваем по строкам, обрезаем цифры и пустые строки
      const idp = raw
        .split(/\r?\n/)
        .map((line: string) => line.replace(/^\d+\.\s*/, "").trim())
        .filter((line): line is string => line.length > 0);

      res.json({ idp });
    } catch (err) {
      next(err);
    }
  }
);

// ——— Error Handler ———
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

// ——— Start Server ———
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
