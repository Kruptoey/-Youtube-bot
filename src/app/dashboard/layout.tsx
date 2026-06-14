"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LogOut, LayoutDashboard, Settings, History, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-10 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            EazyCal AI Studio
          </h1>
          <Button variant="ghost" onClick={handleSignOut} size="sm">
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-64 bg-white border-r border-gray-200 dark:bg-gray-800 dark:border-gray-700 hidden md:block">
          <nav className="flex flex-col gap-2 p-4">
            <Link href="/dashboard">
              <Button variant="ghost" className="w-full justify-start">
                <LayoutDashboard className="w-4 h-4 mr-2" />
                New Video
              </Button>
            </Link>
            <Link href="/dashboard/history">
              <Button variant="ghost" className="w-full justify-start">
                <History className="w-4 h-4 mr-2" />
                History
              </Button>
            </Link>
            <Link href="/dashboard/agents">
              <Button variant="ghost" className="w-full justify-start">
                <Users className="w-4 h-4 mr-2" />
                AI Team
              </Button>
            </Link>
            <Link href="/dashboard/settings">
              <Button variant="ghost" className="w-full justify-start">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </Link>
          </nav>
        </aside>

        <main className="flex-1 p-6 md:p-8 pb-20 md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — visible only on narrow screens */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 flex md:hidden bg-white border-t border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <Link href="/dashboard" className="flex flex-1 flex-col items-center py-3 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white gap-1">
          <LayoutDashboard className="w-5 h-5" />
          New
        </Link>
        <Link href="/dashboard/history" className="flex flex-1 flex-col items-center py-3 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white gap-1">
          <History className="w-5 h-5" />
          History
        </Link>
        <Link href="/dashboard/agents" className="flex flex-1 flex-col items-center py-3 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white gap-1">
          <Users className="w-5 h-5" />
          AI Team
        </Link>
        <Link href="/dashboard/settings" className="flex flex-1 flex-col items-center py-3 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white gap-1">
          <Settings className="w-5 h-5" />
          Settings
        </Link>
      </nav>
    </div>
  );
}
