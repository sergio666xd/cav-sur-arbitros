"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(user ? homeFor(user) : "/login");
  }, [user, loading, router]);
  return (
    <div className="mx-auto max-w-5xl px-4">
      <Loading />
    </div>
  );
}
