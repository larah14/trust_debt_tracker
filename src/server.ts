import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// Parse JSON payloads
app.use(express.json());

// Lazy initializer for GoogleGenAI to safely handle key updates in dev and production
let aiInstance: GoogleGenAI | null = null;
let lastApiKey: string | undefined = undefined;

function getGenAI(): GoogleGenAI | null {
  const currentKey = process.env['GEMINI_API_KEY'];
  if (!currentKey) {
    return null;
  }
  if (!aiInstance || lastApiKey !== currentKey) {
    aiInstance = new GoogleGenAI({
      apiKey: currentKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    lastApiKey = currentKey;
  }
  return aiInstance;
}

/**
 * Smart Debt Assistant Endpoint
 * Takes debts list, budget, and selected formula logic to return structured JSON.
 */
app.post('/api/analyze-debts', async (req, res) => {
  try {
    const { debts, monthlyBudget, strategy } = req.body;

    if (!debts || !Array.isArray(debts)) {
      res.status(400).json({ error: 'Debts list array is required.' });
      return;
    }

    const budget = Number(monthlyBudget) || 1000;
    const ai = getGenAI();

    if (ai) {
      const prompt = `
        You are an elite, practical, and empathetic personal finance analyst for the "Trust Debt Tracker" app.
        Analyze the following user debts and produce a mathematically optimized repayment plan utilizing a maximum monthly budget of ₱${budget}.
        
        Selected Strategy: "${strategy}" 
        - avalanche: target high interest rate debt with all surplus cash while keeping others current.
        - snowball: target smallest remaining balance deck to build early psychological momentum while keeping others current.
        - urgent-priority: target overdue accounts and short-term OLA (Online Lending Apps) with punishing compounding penalty hazards.
        
        User Debts Data:
        ${JSON.stringify(debts, null, 2)}
        
        Specific Instructions:
        1. Calculate summary analytics (Total Debt, Total Remaining, Estimated Interest Payable, etc.).
        2. Identify risk hazards (OLA, overdue payments, near deadlines).
        3. Formulate custom, realistic suggested payment amounts for each debt from the ₱${budget} budget, allocating exactly ₱${budget} (or less if the total remaining debt is less than the budget). Ensure you provide a specific numerical payment for each.
        4. State the main focus debt as "isPrimaryFocus: true" with a logical reason.
        5. Return ONLY a valid JSON response strictly complying with the specified schema, without markdown boundaries, comments, or external text. Set riskLevel to Critical, High, Medium, or Low. RiskScore is a number from 0 to 100.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction: 'You are the core computation agent for the Trust Debt Tracker. You calculate optimal repayments, assign localized financial risk indexes, and return valid JSON.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.OBJECT,
                properties: {
                  totalDebt: { type: Type.NUMBER },
                  totalRemaining: { type: Type.NUMBER },
                  debtToIncomeRatio: { type: Type.NUMBER },
                  monthlyInterestEstimate: { type: Type.NUMBER },
                  estimatedMonthsToDebtFree: { type: Type.NUMBER }
                },
                required: ["totalDebt", "totalRemaining", "debtToIncomeRatio", "monthlyInterestEstimate", "estimatedMonthsToDebtFree"]
              },
              riskLevel: { type: Type.STRING },
              riskScore: { type: Type.NUMBER },
              alerts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING },
                    message: { type: Type.STRING },
                    debtId: { type: Type.STRING }
                  },
                  required: ["severity", "message", "debtId"]
                }
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING }
                  },
                  required: ["title", "description"]
                }
              },
              paymentStrategyAllocation: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    debtId: { type: Type.STRING },
                    debtName: { type: Type.STRING },
                    suggestedPayment: { type: Type.NUMBER },
                    isPrimaryFocus: { type: Type.BOOLEAN },
                    reason: { type: Type.STRING }
                  },
                  required: ["debtId", "debtName", "suggestedPayment", "isPrimaryFocus", "reason"]
                }
              },
              motivationalMessage: { type: Type.STRING }
            },
            required: ["summary", "riskLevel", "riskScore", "alerts", "recommendations", "paymentStrategyAllocation", "motivationalMessage"]
          }
        }
      });

      const responseText = response.text || '{}';
      res.json(JSON.parse(responseText.trim()));
    } else {
      // Fallback model computation
      const totalDebt = debts.reduce((sum, d) => sum + Number(d.totalAmount || 0), 0);
      const totalRemaining = debts.reduce((sum, d) => sum + Number(d.remainingBalance || 0), 0);
      const dti = budget > 0 ? parseFloat((totalRemaining / (budget * 12)).toFixed(2)) : 0;
      
      const monthlyInterestEstimate = debts.reduce((sum, d) => {
        const rate = (Number(d.interestRate || 0) / 100);
        return sum + (Number(d.remainingBalance || 0) * (rate / 12));
      }, 0);

      const sorted = [...debts];
      if (strategy === 'avalanche') {
        sorted.sort((a, b) => Number(b.interestRate || 0) - Number(a.interestRate || 0));
      } else if (strategy === 'snowball') {
        sorted.sort((a, b) => Number(a.remainingBalance || 0) - Number(b.remainingBalance || 0));
      } else {
        const getPriority = (d: { status: string; type: string }) => {
          let score = 0;
          if (d.status === 'Overdue') score += 50;
          if (d.status === 'Grace Period') score += 25;
          if (d.type === 'OLA') score += 20;
          if (d.type === 'GCash') score += 10;
          return score;
        };
        sorted.sort((a, b) => getPriority(b) - getPriority(a));
      }

      let remaining = budget;
      const paymentStrategyAllocation = sorted.map((d) => {
        // Minimum payment is 10% of remaining balance or remaining budget, whichever is smaller.
        let pay = Math.min(Number(d.remainingBalance || 0), Math.ceil(Number(d.remainingBalance || 0) * 0.1));
        if (pay < 500 && d.remainingBalance > 0) pay = Math.min(Number(d.remainingBalance), 500);
        if (pay > remaining) pay = remaining;
        remaining -= pay;
        return {
          debtId: d.id,
          debtName: d.name,
          suggestedPayment: pay,
          isPrimaryFocus: false,
          reason: `Monthly survival payment allocated to maintain standard stand-by status.`
        };
      });

      // Distribute any leftover budget to the top prioritized debt
      if (remaining > 0 && paymentStrategyAllocation.length > 0) {
        const primary = sorted[0];
        const idx = paymentStrategyAllocation.findIndex(a => a.debtId === primary.id);
        if (idx !== -1) {
          const added = Math.min(remaining, Number(primary.remainingBalance || 0) - paymentStrategyAllocation[idx].suggestedPayment);
          paymentStrategyAllocation[idx].suggestedPayment += added;
          paymentStrategyAllocation[idx].isPrimaryFocus = true;
          paymentStrategyAllocation[idx].reason = `Primary focus target under "${strategy}" strategy. Received surplus budget to accelerate pay down.`;
        }
      }

      const containsOverdue = debts.some(d => d.status === 'Overdue');
      const containsOLA = debts.some(d => d.type === 'OLA');
      let riskLevel = "Low";
      let riskScore = 15;
      if (containsOverdue && containsOLA) {
        riskLevel = "Critical";
        riskScore = 92;
      } else if (containsOverdue || containsOLA) {
        riskLevel = "High";
        riskScore = 70;
      } else if (totalRemaining > budget * 10) {
        riskLevel = "Medium";
        riskScore = 48;
      }

      const alerts = [];
      if (containsOLA) {
        alerts.push({
          severity: "high",
          message: "Online Lending Apps (OLA) detected. Beware of exorbitant rolling fees and strict collection strategies.",
          debtId: debts.find(d => d.type === 'OLA')?.id || ""
        });
      }
      if (containsOverdue) {
        alerts.push({
          severity: "critical",
          message: "Overdue debt identified. Compounding penalties are actively ballooning your total remaining balance.",
          debtId: debts.find(d => d.status === 'Overdue')?.id || ""
        });
      }
      if (alerts.length === 0) {
        alerts.push({
          severity: "info",
          message: "All monitored debts are currently in current standing. Stay vigilant with due dates.",
          debtId: ""
        });
      }

      const recommendations = [
        {
          title: "Prioritize High Interest Overbalances",
          description: "Target micro-loans like short-term OLAs first, which consistently hold extreme penalty ratios."
        },
        {
          title: "Automate Calendar Warnings",
          description: "Schedule reminders at least 48 hours prior to due dates to bypass surprise transaction friction."
        },
        {
          title: "Initiate Restructuring Dialogues",
          description: "For long-due obligations, negotiate principal-only settlement plans directly with the loan officer."
        }
      ];

      res.json({
        summary: {
          totalDebt,
          totalRemaining,
          debtToIncomeRatio: dti,
          monthlyInterestEstimate: parseFloat(monthlyInterestEstimate.toFixed(2)),
          estimatedMonthsToDebtFree: budget > 0 ? Math.ceil(totalRemaining / budget) : 99
        },
        riskLevel,
        riskScore,
        alerts,
        recommendations,
        paymentStrategyAllocation,
        motivationalMessage: "💡 Ready to take full control! To unlock customized strategic AI briefings and automatic penalty protection insights, configure your GEMINI_API_KEY in the AI Studio Secrets panel."
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Error of analyze-debts:', err);
    res.status(500).json({ error: 'Failed to perform smart analysis: ' + errMsg });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

