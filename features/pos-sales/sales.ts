import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import { salesIn } from "@/features/dashboard/figures";
import type { Span } from "@/features/dashboard/period";
import { notReplacement } from "@/lib/replacement-order";

export interface ProductSales {
  /** The IMS product of the line's Size, or none when CREOMS cannot tell which Size the line was. */
  imsProductId: number | null;
  productName: string;
  sizeLabel: string;
  unitsSold: number;
  /** Centavos. */
  sales: number;
}

export interface PosSales {
  /** Centavos; the Dashboard's Sales for the same days. */
  sales: number;
  /** Orders counted in Sales. */
  orders: number;
  products: ProductSales[];
  /** Delivery fees and refund adjustments, so products plus this reconcile to Sales. Centavos. */
  otherSales: number;
}

/**
 * The online Sales the POS reads, by the Sales rule: paid or fulfilled Orders placed in the span, less Refunded Returns,
 * never a Replacement Order. Each product and Size is its own row; refunded quantities reduce units and money.
 */
export async function posSalesIn(sql: postgres.Sql, span: Span): Promise<PosSales> {
  const [hasReservations] = await sql<{ found: boolean }[]>`select to_regclass('public.stock_reservations') is not null as found`;
  const imsProduct = hasReservations?.found
    ? sql`(select s.ims_product_id from public.stock_reservations sr
        cross join lateral jsonb_array_elements(sr.lines) as line
        join public.sizes s on s.id = (line->>'sizeId')::int
        where sr.order_id = l.order_id and (line->>'orderLineId')::int = l.id limit 1)`
    : sql`null::integer`;
  const [sales, counted, rows] = await Promise.all([
    salesIn(sql, span),
    sql<{ orders: number }[]>`
      select count(*)::int as orders from public.orders o
      where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")} and o.created_at >= ${span.start} and o.created_at < ${span.end}`,
    sql<{ ims_product_id: number | null; product_name: string; size_label: string; sales: string; units: string }[]>`
      select p.ims_product_id, p.product_name, p.size_label, sum(p.sales)::bigint as sales, sum(p.units)::bigint as units
      from (
        select ${imsProduct} as ims_product_id, l.product_name, l.size_label,
          l.price_in_centavos::bigint * (l.quantity - coalesce(r.quantity, 0)) as sales,
          l.quantity - coalesce(r.quantity, 0) as units
        from public.order_lines l
        join public.orders o on o.id = l.order_id
        left join (
          select i.order_line_id, sum(i.quantity) as quantity
          from public.order_return_items i
          join public.order_returns r on r.id = i.return_id
          where r.status = 'refunded'
          group by i.order_line_id
        ) r on r.order_line_id = l.id
        where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")} and o.created_at >= ${span.start} and o.created_at < ${span.end}
      ) p
      group by p.ims_product_id, p.product_name, p.size_label
      having sum(p.units) > 0
      order by sales desc, p.product_name asc, p.size_label asc`,
  ]);
  const products = rows.map((row) => ({
    imsProductId: row.ims_product_id === null ? null : Number(row.ims_product_id),
    productName: row.product_name, sizeLabel: row.size_label, unitsSold: Number(row.units), sales: Number(row.sales),
  }));

  return { sales, orders: counted[0].orders, products, otherSales: sales - products.reduce((sum, product) => sum + product.sales, 0) };
}
