import type postgres from "postgres";

export const FEEDBACK_PAGE_SIZE = 25;

export interface FeedbackQuery {
  page?: number;
  pageSize?: number;
  /** First day of the range, "YYYY-MM-DD" in Philippines time. Open-ended when absent. */
  from?: string;
  /** Last day of the range, "YYYY-MM-DD" in Philippines time, included. Open-ended when absent. */
  to?: string;
  /** Only Feedback with exactly this many stars. */
  stars?: number;
  /** Only Feedback of Orders that contained a product with exactly this name. */
  product?: string;
}

/** What the Average rating and Low ratings cards show, for every Feedback the filters match. */
export interface FeedbackSummary {
  count: number;
  /** Null when there is no Feedback. */
  average: number | null;
  /** Feedback of 1 to 3 stars. */
  low: number;
}

export interface FeedbackRow {
  orderId: number;
  customerId: string;
  customerName: string;
  rating: number;
  comment: string;
  /** The product names on the Order, in the order they were added. */
  products: string[];
  createdAt: Date;
}

export interface FeedbackList {
  rows: FeedbackRow[];
  /** Every product name that has Feedback, alphabetically, for the product filter. */
  products: string[];
  summary: FeedbackSummary;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type FeedbackResult = { ok: true; list: FeedbackList } | { ok: false };

const TIME_ZONE = "Asia/Manila";

/** The conditions the date range, star and product filters add; days start and end at midnight in Philippines time. */
function conditions(sql: postgres.Sql, query: FeedbackQuery) {
  const parts = [sql`true`];

  if (query.from) parts.push(sql`f.created_at >= (${query.from}::date)::timestamp at time zone ${TIME_ZONE}`);
  if (query.to) parts.push(sql`f.created_at < (${query.to}::date + 1)::timestamp at time zone ${TIME_ZONE}`);
  if (query.stars !== undefined) parts.push(sql`f.rating = ${query.stars}`);

  if (query.product !== undefined) {
    parts.push(sql`exists (select 1 from order_lines pl where pl.order_id = f.order_id and pl.product_name = ${query.product})`);
  }

  return parts.reduce((all, part) => sql`${all} and ${part}`);
}

/** Feedback, newest first. A product with two lines on the Order is listed once. */
export async function listFeedback(sql: postgres.Sql, query: FeedbackQuery = {}): Promise<FeedbackList> {
  const pageSize = query.pageSize ?? FEEDBACK_PAGE_SIZE;

  const where = conditions(sql, query);

  // The cards ignore the product filter, so a product's view never shows a rating that mixes in its Orders' other items.
  const [{ count, average, low }] = await sql<{ count: number; average: string | null; low: number }[]>`
    select count(*)::int as count, round(avg(f.rating), 1) as average, (count(*) filter (where f.rating <= 3))::int as low
    from order_feedback f where ${conditions(sql, { ...query, product: undefined })}`;

  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from order_feedback f where ${where}`;

  const products = await sql<{ product_name: string }[]>`
    select distinct l.product_name from order_lines l
    join order_feedback f on f.order_id = l.order_id
    order by l.product_name`;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const rows = await sql<Record<string, unknown>[]>`
    select f.order_id, f.rating, f.comment, f.created_at, c.id as customer_id, c.full_name,
      coalesce(
        (select array_agg(product_name order by first_line)
         from (select product_name, min(id) as first_line from order_lines
               where order_id = f.order_id group by product_name) p),
        '{}') as products
    from order_feedback f
    join orders o on o.id = f.order_id
    join customers c on c.id = o.customer_id
    where ${where}
    order by f.created_at desc, f.order_id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  return {
    rows: rows.map((r) => ({
      orderId: r.order_id as number,
      customerId: r.customer_id as string,
      customerName: r.full_name as string,
      rating: r.rating as number,
      comment: r.comment as string,
      products: r.products as string[],
      createdAt: r.created_at as Date,
    })),
    products: products.map((p) => p.product_name),
    summary: { count, average: average === null ? null : Number(average), low },
    total,
    page,
    pageSize,
    totalPages,
  };
}

/** Like listFeedback, but an unreachable database becomes `{ ok: false }` so the page can say so in place. */
export async function loadFeedback(connect: () => postgres.Sql, query: FeedbackQuery): Promise<FeedbackResult> {
  try {
    return { ok: true, list: await listFeedback(connect(), query) };
  } catch (error) {
    console.error("Feedback could not read the ecommerce database", error);

    return { ok: false };
  }
}
