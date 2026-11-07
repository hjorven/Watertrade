import type { MapDef } from '../data/maps/valley.ts';
import {
  BANK_POPULATION,
  bankTowns,
  creditLeft,
  creditLine,
  creditProblem,
  LATE_FEE,
  loanAmounts,
  loanQuote,
  LOAN_TERMS,
  MAX_MISSED,
  payoffAmount,
  RATE_DAYS,
  totalDebt,
} from '../sim/finance.ts';
import { day, type GameState, type Ship } from '../sim/state.ts';
import { explain } from './explain.ts';

/** Reiter "Bank" im Hafen: Kredite der Stadtbank */

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const pct = (r: number) => `${String(Math.round(r * 1000) / 10).replace('.', ',')} %`;

export function renderBank(state: GameState, map: MapDef, ship: Ship): string {
  const town = map.towns.find((t) => t.id === ship.port)!;
  const name = (id: string) => map.towns.find((t) => t.id === id)?.name ?? id;
  return renderLoans(state, map, town.id, name);
}

function renderLoans(state: GameState, map: MapDef, town: string, name: (id: string) => string): string {
  const f = state.finance;
  const d = day(state);
  const loans = f?.loans ?? [];
  const open = loans.length
    ? `<h3>Deine Kredite</h3><div class="yard">${loans
        .map((l) => {
          const pay = payoffAmount(state, l);
          const warn = l.overdue > 0 ? ` · <b>${fmt(l.overdue)} Taler überfällig, Mahnung ${l.missed} von ${MAX_MISSED - 1}</b>` : l.missed ? ` · ${l.missed} Mahnung${l.missed > 1 ? 'en' : ''}` : '';
          const btn = l.overdue > 0
            ? `<button class="btn primary" data-act="cmd" data-cmd="payOverdue" data-id="${l.id}" ${state.money >= l.overdue ? '' : 'disabled'}>Rückstand zahlen: ${fmt(l.overdue)} Taler</button>`
            : `<button class="btn" data-act="cmd" data-cmd="repayLoan" data-id="${l.id}" ${state.money >= pay ? '' : 'disabled'} title="Ein Teil der noch nicht verdienten Zinsen wird erlassen">Tilgen: ${fmt(pay)} Taler</button>`;
          return `<div class="yard-row"><div><b>${fmt(l.principal)} Taler</b> <small>${pct(l.rate)} Zins auf ${l.term} Tage · noch ${fmt(l.remaining)} Taler · Rate ${fmt(l.installment)} an Tag ${l.due}${warn}</small></div>${btn}</div>`;
        })
        .join('')}</div>`
    : '';
  const ban = f && f.banUntil > d ? `<p class="note">Nach der Pfändung leiht dir keine Bank etwas bis Tag ${f.banUntil}.</p>` : '';
  const problem = creditProblem(state, town);
  let offer: string;
  if (problem && problem.includes('keine Bank')) {
    const banks = bankTowns(state, map).map(name);
    offer = `<p>${name(town)} hat keine Bank. Kredite gibt es in Städten ab ${fmt(BANK_POPULATION)} Einwohnern${banks.length ? `: ${banks.join(', ')}` : ''}.</p>`;
  } else if (problem) {
    offer = `<p class="note">${problem}</p>`;
  } else {
    const amounts = loanAmounts(state);
    const rows = LOAN_TERMS.map((t) => {
      const q = loanQuote(amounts[amounts.length - 1], t);
      const btns = amounts
        .map((a) => `<button class="btn" data-act="cmd" data-cmd="takeLoan" data-n="${a}" data-days="${t.days}" title="${loanQuote(a, t).count} Raten zu ${fmt(loanQuote(a, t).installment)} Taler">${fmt(a)}</button>`)
        .join('');
      return `<div class="yard-row"><div><b>${t.name}</b> <small>${t.days} Tage, ${pct(t.rate)} Zins für die ganze Laufzeit, ${q.count} Raten</small></div><div class="row-btns">${btns}</div></div>`;
    }).join('');
    offer = `<h3>Geld leihen</h3><p><small>Kreditrahmen ${fmt(creditLine(state))} Taler (die Hälfte deines Vermögens nach Schulden), nach Abzug offener Kredite frei ${fmt(creditLeft(state))}.</small></p><div class="yard">${rows}</div>`;
  }
  const rules = explain(
    'bank',
    `<p>Die Stadtbank leiht Geld gegen Zinsen. Alle ${RATE_DAYS} Tage zieht sie eine Rate aus deiner Kasse ein, egal wo deine Schiffe gerade liegen.</p>
    <p>Reicht die Kasse am Zahltag nicht, mahnt die Bank und schlägt ${pct(LATE_FEE)} Gebühr auf. Nach ${MAX_MISSED} verpassten Raten kündigt sie und pfändet Kasse, Betriebe und Schiffe. Wer im Hochwasser festsitzt und nichts verkaufen kann, sollte vorsorgen.</p>`,
  );
  const debt = totalDebt(state);
  const sum = debt ? `<p>Schulden insgesamt: <b>${fmt(debt)} Taler</b></p>` : '';
  return `${sum}${open}${ban}${offer}${rules}`;
}
