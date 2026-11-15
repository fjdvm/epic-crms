import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadMyTasks } from "@/features/customer-profiles/my-tasks";
import { MyTasksChrome, MyTasksSkeleton, MyTasksView } from "@/features/customer-profiles/my-tasks-view";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { canWork } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

// The header and skeleton reach the browser before the Portal or database answer.
export default function MyTasksPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <MyTasksChrome />
      <Suspense fallback={<MyTasksSkeleton />}>
        <MyTasksData />
      </Suspense>
    </div>
  );
}

async function MyTasksData() {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  const result = await loadMyTasks();

  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <AlertTitle>My tasks are temporarily unavailable</AlertTitle>
        <AlertDescription>{result.message}</AlertDescription>
      </Alert>
    );
  }

  return <MyTasksView data={result.data} canMarkDone={canWork(staff)} />;
}
