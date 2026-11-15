"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

export interface MyTask {
  id: string;
  description: string;
  customerId: string;
  customerName: string;
  dueDate: string;
  overdue: boolean;
}
export interface MyTasks {
  tasks: MyTask[];
  counts: { dueToday: number; overdue: number; doneThisWeek: number };
}
export type MyTasksResult = { ok: true; data: MyTasks } | { ok: false; message: string };

/** The viewer comes only from the session. Managers also get their own work, never a team view. */
export async function loadMyTasks(): Promise<MyTasksResult> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  const now = new Date().toISOString();
  try {
    // One statement keeps the list and counts in the same snapshot. Weeks begin Monday in Manila.
    const [row] = await crmsDatabase()<{
      tasks: Omit<MyTask, "customerName">[];
      dueToday: number;
      overdue: number;
      doneThisWeek: number;
    }[]>`
      with boundaries as (
        select (${now}::timestamptz at time zone 'Asia/Manila')::date as today,
          date_trunc('week', ${now}::timestamptz at time zone 'Asia/Manila') as week_start
      )
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id, 'description', t.description, 'customerId', t.customer_id,
          'dueDate', t.due_date::text, 'overdue', t.due_date < b.today
        ) order by t.due_date, t.created_at, t.id) filter (where t.done_at is null), '[]'::jsonb) as tasks,
        (count(*) filter (where t.done_at is null and t.due_date = b.today))::int as "dueToday",
        (count(*) filter (where t.done_at is null and t.due_date < b.today))::int as overdue,
        (count(*) filter (where t.done_at >= (b.week_start at time zone 'Asia/Manila')
          and t.done_at < ((b.week_start + interval '1 week') at time zone 'Asia/Manila')))::int as "doneThisWeek"
      from crms.customer_tasks t cross join boundaries b
      where t.owner_id = ${staff.id}`;
    const ids = [...new Set(row.tasks.map(task => task.customerId))];
    // Customer identity belongs to the storefront read-only connection, not creoms_writer.
    const customers = ids.length ? await database()<{ id: string; name: string }[]>`
      select id, full_name as name from public.customers where id in ${database()(ids)}` : [];
    const names = new Map(customers.map(customer => [customer.id, customer.name]));
    return {
      ok: true,
      data: {
        tasks: row.tasks.map(task => ({ ...task, customerName: names.get(task.customerId) ?? "Customer unavailable" })),
        counts: { dueToday: row.dueToday, overdue: row.overdue, doneThisWeek: row.doneThisWeek },
      },
    };
  } catch (error) {
    console.error("My tasks could not be read", error);
    return { ok: false, message: "Tasks are unavailable right now. Please try again." };
  }
}
