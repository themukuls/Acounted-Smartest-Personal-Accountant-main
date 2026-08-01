import type { MyDB } from '../db';
import { getAllByIndex, put } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

export type SalaryRestructuringData = Omit<MyDB['salary_restructuring']['value'], 'id' | 'user_id' | 'updated_at'>;

const DEFAULTS: SalaryRestructuringData = {
  gross_ctc:          1200000,
  basic:              480000,
  hra:                240000,
  lta:                30000,
  special_allowance:  350000,
  nps_employer:       0,
  other_allowances:   100000,
  regime:             'new',
  rent_paid_annual:   0,
  city:               'metro',
  sec80c:             150000,
  sec80d:             25000,
  sec80ccd1b:         0,
  home_loan_interest: 0,
  other_deductions:   0,
};

export async function getSalaryRestructuring(
  userId: string,
): Promise<MyDB['salary_restructuring']['value'] | null> {
  try {
    const all = await getAllByIndex<MyDB['salary_restructuring']['value']>(
      'salary_restructuring', 'user_id', userId,
    );
    return all[0] ?? null;
  } catch {
    return null;
  }
}

export async function saveSalaryRestructuring(
  userId: string,
  data: SalaryRestructuringData,
): Promise<void> {
  try {
    const all = await getAllByIndex<MyDB['salary_restructuring']['value']>(
      'salary_restructuring', 'user_id', userId,
    );
    const now = new Date().toISOString();

    if (all[0]) {
      await put('salary_restructuring', { ...all[0], ...data, user_id: userId, updated_at: now });
    } else {
      await put('salary_restructuring', { id: uuidv4(), user_id: userId, ...data, updated_at: now });
    }
  } catch (e) {
    console.warn('[salaryRestructuringService] save failed:', e);
  }
}

export { DEFAULTS as SALARY_DEFAULTS };
