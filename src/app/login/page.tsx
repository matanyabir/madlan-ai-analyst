import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "התחברות — אנליסט הנדל״ן" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">התחברות</h1>
        <p className="mt-1.5 text-sm text-muted">
          אזור הניהול מיועד למנהלי מערכת. הניתוח עצמו פתוח לכולם ואינו דורש התחברות.
        </p>

        <Suspense fallback={<div className="skeleton mt-6 h-64 rounded-2xl" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-sm">
          <a href="/" className="text-accent hover:underline">
            חזרה לאנליסט
          </a>
        </p>
      </div>
    </main>
  );
}
