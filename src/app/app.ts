import { ChangeDetectionStrategy, Component, signal, computed, effect, inject, PLATFORM_ID, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormGroup, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

export interface Debt {
  id: string;
  name: string;
  type: 'OLA' | 'GCash' | 'Bank' | 'Credit Card' | 'Personal' | 'Other';
  totalAmount: number;
  remainingBalance: number;
  dueDate: string;
  interestRate: number; // monthly or annual interest %
  status: 'Current' | 'Grace Period' | 'Overdue' | 'Paid';
}

export interface AnalysisSummary {
  totalDebt: number;
  totalRemaining: number;
  debtToIncomeRatio: number;
  monthlyInterestEstimate: number;
  estimatedMonthsToDebtFree: number;
}

export interface AnalysisAlert {
  severity: 'info' | 'warning' | 'high' | 'critical';
  message: string;
  debtId?: string;
}

export interface StrategyAllocation {
  debtId: string;
  debtName: string;
  suggestedPayment: number;
  isPrimaryFocus: boolean;
  reason: string;
}

export interface TooltipHelp {
  title: string;
  description: string;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  riskLevel: string;
  riskScore: number;
  alerts: AnalysisAlert[];
  recommendations: TooltipHelp[];
  paymentStrategyAllocation: StrategyAllocation[];
  motivationalMessage: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  // Template utilities
  protected Math = Math;
  protected Number = Number;

  // Core Signals
  debts = signal<Debt[]>([]);
  monthlyBudget = signal<number>(8000);
  selectedStrategy = signal<'avalanche' | 'snowball' | 'urgent-priority'>('urgent-priority');
  
  // AI Analysis States
  isAnalyzing = signal<boolean>(false);
  analysisResult = signal<AnalysisResult | null>(null);
  analysisError = signal<string | null>(null);
  aiStateMessage = signal<string>('');

  // UI Flow Control States
  activeFormMode = signal<'add' | 'edit' | 'none'>('none');
  editingDebtId = signal<string | null>(null);
  showPaymentQuickAction = signal<string | null>(null); // holds debt ID for payment modal
  quickPaymentAmount = signal<number>(0);

  // Reactive Form
  debtForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(40)]),
    type: new FormControl<'OLA' | 'GCash' | 'Bank' | 'Credit Card' | 'Personal' | 'Other'>('OLA', [Validators.required]),
    totalAmount: new FormControl<number>(10000, [Validators.required, Validators.min(1)]),
    remainingBalance: new FormControl<number>(8000, [Validators.required, Validators.min(0)]),
    dueDate: new FormControl('', [Validators.required]),
    interestRate: new FormControl<number>(12, [Validators.required, Validators.min(0)]),
    status: new FormControl<'Current' | 'Grace Period' | 'Overdue' | 'Paid'>('Current', [Validators.required]),
  });

  // Local helper calculations computed signals
  totalBorrowedValue = computed(() => {
    return this.debts().reduce((acc, d) => acc + d.totalAmount, 0);
  });

  totalRemainingValue = computed(() => {
    return this.debts().reduce((acc, d) => acc + d.remainingBalance, 0);
  });

  overallProgressPercent = computed(() => {
    const total = this.totalBorrowedValue();
    if (total === 0) return 100;
    const remaining = this.totalRemainingValue();
    return Math.max(0, Math.min(100, Math.round(((total - remaining) / total) * 100)));
  });

  localRiskMetrics = computed(() => {
    const debtsList = this.debts();
    let score = 10;
    let classification = 'Low';

    if (debtsList.length === 0) return { score: 0, level: 'None' };

    const containsOverdue = debtsList.some(d => d.status === 'Overdue');
    const containsOLA = debtsList.some(d => d.type === 'OLA');
    const totalRemaining = this.totalRemainingValue();
    const budget = this.monthlyBudget();

    if (containsOverdue) score += 40;
    if (containsOLA) score += 25;
    if (totalRemaining > budget * 10) score += 25;
    
    score = Math.min(100, score);

    if (score >= 80) classification = 'Critical';
    else if (score >= 55) classification = 'High';
    else if (score >= 30) classification = 'Medium';

    return { score, level: classification };
  });

  constructor() {
    // Sync state to localStorage of browser whenever debts or budget alters
    if (this.isBrowser) {
      effect(() => {
        localStorage.setItem('trust_debts', JSON.stringify(this.debts()));
      });
      effect(() => {
        localStorage.setItem('trust_budget', this.monthlyBudget().toString());
      });
      effect(() => {
        localStorage.setItem('trust_strategy', this.selectedStrategy());
      });
    }
  }

  ngOnInit() {
    if (this.isBrowser) {
      // Load saved debts or bootstrap realistic presets
      const savedDebts = localStorage.getItem('trust_debts');
      if (savedDebts) {
        try {
          this.debts.set(JSON.parse(savedDebts));
        } catch {
          this.bootstrapDefaultDebts();
        }
      } else {
        this.bootstrapDefaultDebts();
      }

      // Load saved budget setting
      const savedBudget = localStorage.getItem('trust_budget');
      if (savedBudget) {
        const val = Number(savedBudget);
        if (!isNaN(val) && val > 0) {
          this.monthlyBudget.set(val);
        }
      }

      // Load strategy preference
      const savedStrategy = localStorage.getItem('trust_strategy');
      if (savedStrategy) {
        const strat = savedStrategy as 'avalanche' | 'snowball' | 'urgent-priority';
        if (['avalanche', 'snowball', 'urgent-priority'].includes(strat)) {
          this.selectedStrategy.set(strat);
        }
      }
    }
  }

  bootstrapDefaultDebts() {
    const defaults: Debt[] = [
      {
        id: '1',
        name: 'FCash Express OLA',
        type: 'OLA',
        totalAmount: 8500,
        remainingBalance: 8500,
        interestRate: 48, // 48% annual/compounding
        dueDate: '2026-06-18',
        status: 'Overdue'
      },
      {
        id: '2',
        name: 'GCash GGives Loan',
        type: 'GCash',
        totalAmount: 18000,
        remainingBalance: 12400,
        interestRate: 24, // 24% annual
        dueDate: '2026-06-25',
        status: 'Current'
      },
      {
        id: '3',
        name: 'Card Bank Personal',
        type: 'Bank',
        totalAmount: 45000,
        remainingBalance: 28000,
        interestRate: 14,
        dueDate: '2026-07-03',
        status: 'Current'
      },
      {
        id: '4',
        name: 'Kuya Ronald (Grocery)',
        type: 'Personal',
        totalAmount: 4000,
        remainingBalance: 2500,
        interestRate: 0,
        dueDate: '2026-07-15',
        status: 'Current'
      }
    ];
    this.debts.set(defaults);
  }

  // Update Monthly Budget
  updateBudget(val: string) {
    const num = Number(val);
    if (!isNaN(num) && num >= 0) {
      this.monthlyBudget.set(num);
    }
  }

  // Quick Strategy Toggle
  setStrategy(strat: 'avalanche' | 'snowball' | 'urgent-priority') {
    this.selectedStrategy.set(strat);
  }

  // Form Openers
  openAddForm() {
    this.editingDebtId.set(null);
    this.activeFormMode.set('add');
    this.debtForm.reset({
      name: '',
      type: 'OLA',
      totalAmount: 5000,
      remainingBalance: 5000,
      dueDate: this.getTodayDateString(),
      interestRate: 15,
      status: 'Current'
    });
  }

  openEditForm(debt: Debt) {
    this.editingDebtId.set(debt.id);
    this.activeFormMode.set('edit');
    this.debtForm.patchValue({
      name: debt.name,
      type: debt.type,
      totalAmount: debt.totalAmount,
      remainingBalance: debt.remainingBalance,
      dueDate: debt.dueDate,
      interestRate: debt.interestRate,
      status: debt.status
    });
  }

  closeForm() {
    this.activeFormMode.set('none');
    this.editingDebtId.set(null);
  }

  // Submit Handler
  saveDebt() {
    if (this.debtForm.invalid) {
      return;
    }

    const formValues = this.debtForm.value;
    const currentId = this.editingDebtId();

    if (this.activeFormMode() === 'add') {
      const newDebt: Debt = {
        id: Date.now().toString(),
        name: formValues.name || 'Unnamed Debt',
        type: formValues.type || 'Other',
        totalAmount: Math.max(0, Number(formValues.totalAmount ?? 0)),
        remainingBalance: Math.max(0, Number(formValues.remainingBalance ?? 0)),
        dueDate: formValues.dueDate || this.getTodayDateString(),
        interestRate: Math.max(0, Number(formValues.interestRate ?? 0)),
        status: formValues.status || 'Current'
      };

      // Cap remaining balance to total amount as business rule
      if (newDebt.remainingBalance > newDebt.totalAmount) {
        newDebt.remainingBalance = newDebt.totalAmount;
      }
      if (newDebt.remainingBalance <= 0) {
        newDebt.status = 'Paid';
      }

      this.debts.update(list => [...list, newDebt]);
    } else if (this.activeFormMode() === 'edit' && currentId) {
      this.debts.update(list => list.map(d => {
        if (d.id === currentId) {
          const updatedDebt: Debt = {
            ...d,
            name: formValues.name || d.name,
            type: formValues.type || d.type,
            totalAmount: Math.max(0, Number(formValues.totalAmount ?? d.totalAmount)),
            remainingBalance: Math.max(0, Number(formValues.remainingBalance ?? d.remainingBalance)),
            dueDate: formValues.dueDate || d.dueDate,
            interestRate: Math.max(0, Number(formValues.interestRate ?? d.interestRate)),
            status: formValues.status || d.status
          };

          if (updatedDebt.remainingBalance > updatedDebt.totalAmount) {
            updatedDebt.remainingBalance = updatedDebt.totalAmount;
          }
          if (updatedDebt.remainingBalance <= 0) {
            updatedDebt.status = 'Paid';
          }
          return updatedDebt;
        }
        return d;
      }));
    }

    // Force clear of any stale AI allocations as the debt state has changed
    this.analysisResult.set(null);
    this.closeForm();
  }

  deleteDebt(id: string) {
    if (confirm('Are you sure you want to remove this debt obligation?')) {
      this.debts.update(list => list.filter(d => d.id !== id));
      // Reset AI result because values modified
      this.analysisResult.set(null);
    }
  }

  // Quick payment popup controller
  openQuickPayment(debt: Debt) {
    this.showPaymentQuickAction.set(debt.id);
    this.quickPaymentAmount.set(Math.min(1000, debt.remainingBalance));
  }

  closePaymentModal() {
    this.showPaymentQuickAction.set(null);
  }

  submitQuickPayment() {
    const id = this.showPaymentQuickAction();
    const amountToDeduct = Math.max(0, this.quickPaymentAmount());
    if (id && amountToDeduct > 0) {
      this.debts.update(list => list.map(d => {
        if (d.id === id) {
          const newRemaining = Math.max(0, d.remainingBalance - amountToDeduct);
          return {
            ...d,
            remainingBalance: newRemaining,
            status: newRemaining === 0 ? 'Paid' : d.status
          };
        }
        return d;
      }));
      this.analysisResult.set(null);
      this.closePaymentModal();
    }
  }

  // Dynamic status styling helpers
  getStatusClass(status: string): string {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100 border';
      case 'Overdue':
        return 'bg-rose-50 text-rose-700 border-rose-100 border animate-pulse';
      case 'Grace Period':
        return 'bg-amber-50 text-amber-700 border-amber-100 border';
      default:
        return 'bg-sky-50 text-sky-700 border-sky-100 border';
    }
  }

  getTypeBadgeClass(type: string): string {
    switch (type) {
      case 'OLA':
        return 'bg-purple-100 text-purple-800';
      case 'GCash':
        return 'bg-sky-100 text-sky-800';
      case 'Bank':
        return 'bg-indigo-100 text-indigo-800';
      case 'Credit Card':
        return 'bg-pink-100 text-pink-800';
      case 'Personal':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-zinc-100 text-zinc-800';
    }
  }

  // Trigger server-side AI debt analysis pipeline
  async triggerStrategyAnalysis() {
    const activeDebts = this.debts().filter(d => d.remainingBalance > 0);
    if (activeDebts.length === 0) {
      this.analysisError.set("You don't have any outstanding borrowings to analyze. Enjoy the debt-free life!");
      return;
    }

    this.isAnalyzing.set(true);
    this.analysisError.set(null);

    // Stagger loading messages for ultimate high fidelity micro-interaction feel
    const stages = [
      'Establishing connection to Trust Smart Assistant...',
      'Mapping individual compound loan factors...',
      'Projecting snowball and avalanche timeline simulations...',
      'Formulating optimal budget allocations & interest cushions...',
      'Assembling actionable strategic localized guidelines...'
    ];

    let currentStage = 0;
    this.aiStateMessage.set(stages[currentStage]);

    const timer = setInterval(() => {
      if (currentStage < stages.length - 1) {
        currentStage++;
        this.aiStateMessage.set(stages[currentStage]);
      }
    }, 1100);

    try {
      const response = await fetch('/api/analyze-debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debts: activeDebts,
          monthlyBudget: this.monthlyBudget(),
          strategy: this.selectedStrategy()
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP error status ${response.status}`);
      }

      const result: AnalysisResult = await response.json();
      this.analysisResult.set(result);
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.analysisError.set(`Coupled integration issue: ${errMsg}`);
    } finally {
      clearInterval(timer);
      this.isAnalyzing.set(false);
    }
  }

  // Quick form utilities
  getTodayDateString(): string {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

