import type postgres from "postgres";

export interface CustomerNote {
  id: string;
  customerId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}
export interface CustomerNoteRow {
  id: string;
  customer_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: Date;
}
export function customerNote(row: CustomerNoteRow): CustomerNote {
  return { id: String(row.id), customerId: row.customer_id, authorId: row.author_id,
    authorName: row.author_name, text: row.body, createdAt: row.created_at.toISOString() };
}
export async function listCustomerNotes(sql: postgres.Sql, customerId: string): Promise<CustomerNote[]> {
  const rows = await sql<CustomerNoteRow[]>`
    select * from crms.customer_notes where customer_id = ${customerId}
    order by created_at desc, id desc`;
  return rows.map(customerNote);
}
