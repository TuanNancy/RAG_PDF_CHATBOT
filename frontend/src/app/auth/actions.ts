"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/server";
import {
  LOGIN_ERROR,
  SIGNUP_ERROR,
  mapSupabaseAuthMessage,
} from "@/lib/messages";

type AuthActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function getOriginFromHeaders(value: string | null): string {
  if (!value) return "http://localhost:3000";
  const first = value.split(",")[0].trim();
  if (first.startsWith("http://") || first.startsWith("https://")) return first;
  return `https://${first}`;
}

async function resolveRedirectUrl(path: string): Promise<string> {
  const h = await headers();
  const originHeader = h.get("origin");
  const hostHeader = h.get("x-forwarded-host") ?? h.get("host");
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const origin = envSiteUrl || originHeader || hostHeader || "http://localhost:3000";
  const resolvedOrigin = getOriginFromHeaders(origin);
  return `${resolvedOrigin}${path}`;
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  try {
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      return { status: "error", message: "Email và mật khẩu là bắt buộc." };
    }

    const supabase = await createClient();
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return {
        status: "error",
        message: mapSupabaseAuthMessage(error.message, LOGIN_ERROR),
      };
    }

    if (!data.session) {
      return {
        status: "error",
        message: "Đăng nhập chưa hoàn tất. Vui lòng thử lại.",
      };
    }

    return { status: "success", message: "Đăng nhập thành công. Đang chuyển hướng..." };
  } catch {
    return {
      status: "error",
      message: LOGIN_ERROR,
    };
  }
}

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!fullName || !email || !password) {
    return { status: "error", message: "Tên, email và mật khẩu là bắt buộc." };
  }

  if (password.length < 6) {
    return { status: "error", message: "Mật khẩu tối thiểu 6 ký tự." };
  }

  try {
    const supabase = await createClient();
    const emailRedirectTo = await resolveRedirectUrl("/auth/login");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo,
      },
    });

    if (error) {
      return {
        status: "error",
        message: mapSupabaseAuthMessage(error.message, SIGNUP_ERROR),
      };
    }

    await supabase.auth.signOut();

    return {
      status: "success",
      message: "Đăng ký thành công. Đang chuyển sang trang đăng nhập...",
    };
  } catch {
    return {
      status: "error",
      message: SIGNUP_ERROR,
    };
  }
}
