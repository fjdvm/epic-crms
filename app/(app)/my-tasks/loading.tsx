import { MyTasksChrome, MyTasksSkeleton } from "@/features/customer-profiles/my-tasks-view";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <MyTasksChrome />
      <MyTasksSkeleton />
    </div>
  );
}
