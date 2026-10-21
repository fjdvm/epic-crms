import type postgres from "postgres";

/** A product needs this many Feedbacks before it can be the Top product. */
export const TOP_PRODUCT_MIN_FEEDBACK = 5;

/** At most this many of a product's latest Feedbacks are given to the model, so the prompt stays bounded. */
const FEEDBACK_PER_CANDIDATE = 50;

/** The longest reason kept; the card shows it on one line. */
const REASON_MAX = 160;

/** A product the model may choose, with the Feedback of every Order that contained it. */
export interface TopProductCandidate {
  product: string;
  /** How many Feedbacks the product has; `feedback` may hold only the latest of them. */
  feedbackCount: number;
  feedback: { rating: number; comment: string }[];
}

/** One model that can choose the Top product. Throws when it cannot, so the next model can be tried. */
export interface TopProductClient {
  model: string;
  pickTopProduct(candidates: TopProductCandidate[]): Promise<{ product: string; reason: string }>;
}

/** The cached Top product, over all Feedback whatever the date range. */
export interface TopProduct {
  product: string;
  feedbackCount: number;
  /** One line on why Customers like it. */
  reason: string;
  model: string;
  computedAt: Date;
}

/** What a run did to the Top product. */
export type TopProductOutcome = "updated" | "kept" | "not-enough";

/** The cached Top product; null before the first one. */
export async function readTopProduct(sql: postgres.Sql): Promise<TopProduct | null> {
  const [row] = await sql<{ product_name: string; feedback_count: number; reason: string; model: string; computed_at: Date }[]>`
    select product_name, feedback_count, reason, model, computed_at from feedback_top_product where id = 1`;

  return row
    ? { product: row.product_name, feedbackCount: row.feedback_count, reason: row.reason, model: row.model, computedAt: row.computed_at }
    : null;
}

/** Products with at least 5 Feedbacks, alphabetically. An Order counts once per product, however many lines it has. */
async function candidates(sql: postgres.Sql | postgres.TransactionSql): Promise<TopProductCandidate[]> {
  const rows = await sql<{ product_name: string; feedback_count: number; rating: number; comment: string }[]>`
    with pairs as (select distinct order_id, product_name from order_lines),
      counted as (
        select p.product_name, f.rating, f.comment,
          count(*) over (partition by p.product_name)::int as feedback_count,
          row_number() over (partition by p.product_name order by f.created_at desc, f.order_id desc) as nth
        from pairs p join order_feedback f on f.order_id = p.order_id)
    select product_name, feedback_count, rating, comment from counted
    where feedback_count >= ${TOP_PRODUCT_MIN_FEEDBACK} and nth <= ${FEEDBACK_PER_CANDIDATE}
    order by product_name, nth`;

  const byProduct = new Map<string, TopProductCandidate>();

  for (const row of rows) {
    const candidate = byProduct.get(row.product_name) ?? { product: row.product_name, feedbackCount: row.feedback_count, feedback: [] };
    candidate.feedback.push({ rating: row.rating, comment: row.comment });
    byProduct.set(row.product_name, candidate);
  }

  return [...byProduct.values()];
}

/**
 * Whether a run should ask for the Top product again: some product qualifies and there is no result
 * yet, or Feedback has arrived since the result was computed. A failed attempt leaves it stale, so the
 * next run tries again.
 */
export async function topProductStale(sql: postgres.Sql | postgres.TransactionSql): Promise<boolean> {
  const [{ stale }] = await sql<{ stale: boolean }[]>`
    select exists (
      select 1 from order_lines l join order_feedback f on f.order_id = l.order_id
      group by l.product_name having count(distinct f.order_id) >= ${TOP_PRODUCT_MIN_FEEDBACK}
    ) and coalesce(
      (select max(f.created_at) > t.computed_at from order_feedback f, feedback_top_product t where t.id = 1 group by t.computed_at),
      true
    ) as stale`;

  return stale;
}

/** The reason's first line, with its spaces tidied and cut to fit the card. */
function oneLine(reason: string): string {
  const line = reason.trim().split(/\r?\n/)[0].replace(/\s+/g, " ").trim();

  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1).trimEnd()}…` : line;
}

/**
 * Asks Groq, then Gemini when Groq fails, for the Top product among the products with at least 5
 * Feedbacks, and saves it. A model that fails, or names a product it was not offered, is passed over;
 * when none succeeds the last result and its date are kept.
 */
export async function recomputeTopProduct(sql: postgres.Sql, models: TopProductClient[], now: Date): Promise<TopProductOutcome> {
  const offered = await candidates(sql);

  if (offered.length === 0) return "not-enough";

  for (const client of models) {
    try {
      const pick = await client.pickTopProduct(offered);
      const chosen = offered.find((c) => c.product === pick.product.trim());
      const reason = oneLine(pick.reason);

      if (!chosen) throw new Error(`${client.model} chose "${pick.product}", which was not offered`);
      if (!reason) throw new Error(`${client.model} gave no reason`);

      await sql`
        insert into feedback_top_product (id, product_name, feedback_count, reason, model, computed_at)
        values (1, ${chosen.product}, ${chosen.feedbackCount}, ${reason}, ${client.model}, ${now})
        on conflict (id) do update set product_name = excluded.product_name, feedback_count = excluded.feedback_count,
          reason = excluded.reason, model = excluded.model, computed_at = excluded.computed_at`;

      return "updated";
    } catch (error) {
      console.error(`${client.model} could not choose the Top product`, error);
    }
  }

  return "kept";
}
