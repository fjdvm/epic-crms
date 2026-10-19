import type postgres from "postgres";

export interface CartLine {
  product: string;
  size: string;
  quantity: number;
  /** Centavos, per unit. */
  price: number;
}

export interface Cart {
  lines: CartLine[];
  /** Centavos; the sum of quantity times price over the lines. */
  total: number;
}

/** What is in a Customer's Cart right now. */
export async function getCustomerCart(sql: postgres.Sql, customerId: string): Promise<Cart> {
  const rows = await sql<Record<string, unknown>[]>`
    select p.name, s.label, s.price_in_centavos, cl.quantity
    from public.cart_lines cl
    join public.sizes s on s.id = cl.size_id
    join public.products p on p.slug = s.product_slug
    where cl.customer_id = ${customerId}
    order by cl.id`;

  const lines = rows.map((r) => ({
    product: r.name as string,
    size: r.label as string,
    quantity: r.quantity as number,
    price: r.price_in_centavos as number,
  }));

  return { lines, total: lines.reduce((sum, l) => sum + l.quantity * l.price, 0) };
}
