import type postgres from "postgres";

export const FEEDBACK_PAGE_SIZE = 25;

export interface FeedbackQuery {
  page?: number;
  pageSize?: number;
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
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type FeedbackResult = { ok: true; list: FeedbackList } | { ok: false };

/** Feedback, newest first. A product with two lines on the Order is listed once. */
export async function listFeedback(sql: postgres.Sql, query: FeedbackQuery = {}): Promise<FeedbackList> {
  const pageSize = query.pageSize ?? FEEDBACK_PAGE_SIZE;

  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from order_feedback`;

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
