/**
 * What FigureQuiz would cost (docs/credits-plan.md, phase 5): free credits once, monthly plans
 * that come with credits, and top-ups. A proof of concept: nothing here is sold, and checkout
 * never takes a payment or adds credits. A demo account gets credits by hand, through
 * `grant_credits` with the service role.
 *
 * Holds no secrets or user data, so client components may import it.
 */

/** Free credits, once per person: some as a guest, the rest on sign-up (the credits migration). */
export const FREE_CREDITS = 100;
export const GUEST_CREDITS = 25;

/** A typical lecture: about 25 pages that end up with questions. */
export const PAGES_PER_LECTURE = 25;

export type Offer = {
  /** Its checkout address: /pricing/checkout/{id}. */
  id: string;
  name: string;
  kind: "plan" | "top-up";
  credits: number;
  /** Australian dollars: each month for a plan, once for a top-up. */
  price: number;
  blurb: string;
};

export const PLANS: Offer[] = [
  {
    id: "student",
    name: "Student",
    kind: "plan",
    credits: 400,
    price: 5,
    blurb: "A semester of lectures, a week at a time.",
  },
  {
    id: "exam-season",
    name: "Exam season",
    kind: "plan",
    credits: 1200,
    price: 12,
    blurb: "Every unit's slides, and plenty of written answers marked.",
  },
];

export const TOP_UPS: Offer[] = [
  { id: "top-up-100", name: "100 credits", kind: "top-up", credits: 100, price: 2, blurb: "A few more lectures." },
  { id: "top-up-500", name: "500 credits", kind: "top-up", credits: 500, price: 8, blurb: "A unit's worth." },
  { id: "top-up-1500", name: "1,500 credits", kind: "top-up", credits: 1500, price: 20, blurb: "A whole semester." },
];

export function findOffer(id: string): Offer | undefined {
  return [...PLANS, ...TOP_UPS].find((offer) => offer.id === id);
}

/** "A$5": the home market's dollars, marked so a visitor from elsewhere can tell. */
export function aud(price: number): string {
  return `A$${price}`;
}

/** Roughly how many lectures `credits` covers. */
export function lectures(credits: number): number {
  return Math.round(credits / PAGES_PER_LECTURE);
}
