"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      data-testid="logout"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/");
        router.refresh();
      }}
      className="text-muted hover:underline"
    >
      התנתקות
    </button>
  );
}
