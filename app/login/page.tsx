"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("registered") === "1") {
      setSuccessMessage("Account created. You can now log in.");
    }
  }, [searchParams]);

  const handleLogin = async () => {
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    console.log("login success", data);
    router.push("/dashboard");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <div className="bg-zinc-900 border border-zinc-700/50 p-8 rounded-xl w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Login</h1>

        {successMessage && (
          <p className="text-emerald-400 text-sm">{successMessage}</p>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <input
          type="email"
          className="w-full p-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />

        <input
          type="password"
          className="w-full p-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />

        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-70 disabled:cursor-not-allowed p-2.5 rounded-lg font-medium transition"
        >
          {loading ? "Logging in..." : "Login"}
        </button>

        <p className="text-sm text-zinc-500 text-center">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-blue-400 hover:text-blue-300">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
