"use server";

import { signOut } from "@/auth";

/**
 * Actions shared across signed-in pages. Kept at the app root because the nav
 * renders on every one of them.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
