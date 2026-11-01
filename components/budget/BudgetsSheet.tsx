'use client';
// Shared / Eren / Amy budgets (plan §7.5.0). Each optional; empty = 0 = "No budget set".
import { useState } from 'react';
import { useDraft } from '@/components/checklist/useDraft';
import { Button, Field, SaveStatus, SegmentedControl, Sheet, TextInput, type SaveState } from '@/components/ui';
import { useBudget } from '@/lib/data';
import { toMinor } from '@/lib/money';
import type { BudgetScope, Currency, TripBudget } from '@/lib/types';
import { S } from '@/lib/strings';
import form from '@/components/checklist/Form.module.css';

const SCOPES: BudgetScope[] = ['shared', 'eren', 'amy'];
type Row = { amount: string; currency: Currency };
type Draft = Record<BudgetScope, Row>;

function toDraft(budgets: TripBudget[]): Draft {
  const row = (scope: BudgetScope): Row => {
    const b = budgets.find((x) => x.scope === scope);
    if (!b || !b.amountMinor) return { amount: '', currency: b?.currency ?? 'AUD' };
    return { amount: b.currency === 'AUD' ? (b.amountMinor / 100).toFixed(2) : String(b.amountMinor), currency: b.currency };
  };
  return { shared: row('shared'), eren: row('eren'), amy: row('amy') };
}

function parse(r: Row): number | null {
  if (!r.amount.trim()) return 0;
  try {
    const v = toMinor(r.amount, r.currency);
    return v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export function BudgetsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const budget = useBudget();
  const budgets = budget.status === 'ready' ? budget.data.budgets : [];
  const [draft, patch] = useDraft<Draft>(open, 'budgets', () => toDraft(budgets));
  const [state, setState] = useState<SaveState>('idle');
  const [tried, setTried] = useState(false);
  const errors = Object.fromEntries(SCOPES.map((s) => [s, parse(draft[s]) === null ? S.budget.amountInvalid : null])) as Record<BudgetScope, string | null>;

  const submit = async () => {
    setTried(true);
    if (SCOPES.some((s) => errors[s])) return;
    setState('saving');
    for (const scope of SCOPES) {
      const amountMinor = parse(draft[scope]) ?? 0;
      const current = budgets.find((b) => b.scope === scope);
      if (current ? current.amountMinor === amountMinor && current.currency === draft[scope].currency : amountMinor === 0) continue;
      const r = await budget.setBudget({ scope, amountMinor, currency: draft[scope].currency });
      if (!r.ok) {
        setState('error');
        return;
      }
    }
    setState('saved');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={S.budget.budgetsTitle}
      description={S.budget.budgetsHint}
      headerExtra={<SaveStatus state={state} />}
      footer={
        <div className={form.footer}>
          <div className={form.footerEnd}>
            <Button variant="ghost" onClick={onClose}>
              {S.actions.cancel}
            </Button>
            <Button variant="primary" busy={state === 'saving'} onClick={submit}>
              {S.actions.save}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className={form.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {SCOPES.map((scope) => (
          <fieldset key={scope} className={form.fieldset}>
            <legend className={form.legend}>{S.budget.budgetFor(S.budgetWords.scopes[scope])}</legend>
            <div className={form.grid2}>
              <Field label={S.fields.amount} optional hideLabel error={tried ? (errors[scope] ?? undefined) : undefined}>
                <TextInput
                  inputMode="decimal"
                  value={draft[scope].amount}
                  placeholder={S.overview.noBudget}
                  onChange={(e) => {
                    patch({ [scope]: { ...draft[scope], amount: e.target.value } } as Partial<Draft>);
                    setState('dirty');
                  }}
                />
              </Field>
              <SegmentedControl<Currency>
                label={`${S.budget.budgetFor(S.budgetWords.scopes[scope])} · ${S.fields.currency}`}
                fill
                size="sm"
                value={draft[scope].currency}
                onChange={(c) => {
                  patch({ [scope]: { ...draft[scope], currency: c } } as Partial<Draft>);
                  setState('dirty');
                }}
                options={[
                  { value: 'AUD', label: 'AUD' },
                  { value: 'KRW', label: 'KRW' },
                ]}
              />
            </div>
          </fieldset>
        ))}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
