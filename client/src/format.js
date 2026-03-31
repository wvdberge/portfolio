import { format, parseISO } from 'date-fns';

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

export function fmtEur(amount) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function fmtNum(n, decimals = 2) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function fmtShares(qty) {
  if (qty === null || qty === undefined) return '—';
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(qty);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
