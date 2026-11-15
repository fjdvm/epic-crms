import type postgres from "postgres";

export interface CustomerTask {
  id: string;
  customerId: string;
  description: string;
  dueDate: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  doneAt: string | null;
  doneById: string | null;
  doneByName: string | null;
  overdue: boolean;
}

/** Date-only values stay strings; PostgreSQL's session timezone never defines "today". */
export async function readCustomerTasks(sql: postgres.Sql | postgres.TransactionSql, customerId: string, now = new Date()): Promise<CustomerTask[]> {
  return sql<CustomerTask[]>`
    select id, customer_id as "customerId", description, due_date::text as "dueDate",
      owner_id as "ownerId", owner_name as "ownerName", created_at::text as "createdAt",
      created_by_id as "createdById", created_by_name as "createdByName",
      done_at::text as "doneAt", done_by_id as "doneById", done_by_name as "doneByName",
      (done_at is null and due_date < (${now.toISOString()}::timestamptz at time zone 'Asia/Manila')::date) as overdue
    from crms.customer_tasks where customer_id = ${customerId}
    order by (done_at is not null), due_date, created_at, id`;
}
