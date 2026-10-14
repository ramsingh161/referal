"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { ConnectionsCsvError } from "@/lib/csv/parse-connections";
import { importConnectionsCsv, type ImportSummary } from "@/lib/csv/import-connections";
import { prisma } from "@/lib/db";
import {
  jobPreferencesSchema,
  serializePreferences,
  splitKeywordInput,
  SENIORITY_LEVELS,
} from "@/lib/prefs";

/**
 * Onboarding actions: take the connections file, then take the preferences.
 *
 * Both return a plain result object instead of throwing, because the caller is
 * a form and every failure here is something the user can act on — a wrong file,
 * an empty export. Unexpected failures are the exception and say so.
 */

/** 8 MB, matching `serverActions.bodySizeLimit` in next.config.ts. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type UploadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; summary: ImportSummary };

export async function uploadConnections(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "error", message: "Your session expired. Sign in again." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose your Connections.csv file first." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      status: "error",
      message: `That file is ${formatBytes(file.size)}, over the ${formatBytes(
        MAX_UPLOAD_BYTES,
      )} limit. A connections export is normally a few megabytes — check you picked the right file.`,
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { status: "error", message: "We couldn't read that file. Try uploading it again." };
  }

  try {
    const summary = await importConnectionsCsv(userId, text);
    revalidatePath("/connections");
    revalidatePath("/dashboard");
    return { status: "success", summary };
  } catch (error) {
    // The parser's messages are written for users, so they pass straight
    // through. Anything else is ours to fix, and saying so is more useful than
    // showing a stack trace.
    if (error instanceof ConnectionsCsvError) {
      return { status: "error", message: error.message };
    }
    console.error("[onboarding] connections import failed", error);
    return {
      status: "error",
      message: "Something went wrong on our side while importing. Try again in a moment.",
    };
  }
}

export type PreferencesState = { status: "idle" } | { status: "error"; message: string };

export async function savePreferences(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { status: "error", message: "Your session expired. Sign in again." };

  const parsed = jobPreferencesSchema.safeParse({
    titleKeywords: splitKeywordInput(String(formData.get("titleKeywords") ?? "")),
    locations: splitKeywordInput(String(formData.get("locations") ?? "")),
    seniority: formData
      .getAll("seniority")
      .map(String)
      .filter((value): value is (typeof SENIORITY_LEVELS)[number] =>
        (SENIORITY_LEVELS as readonly string[]).includes(value),
      ),
    remoteOnly: formData.get("remoteOnly") === "on",
  });

  if (!parsed.success) {
    return { status: "error", message: "Those preferences didn't look right. Check and resave." };
  }

  const connectionCount = await prisma.connection.count({ where: { userId } });
  if (connectionCount === 0) {
    return {
      status: "error",
      message: "Add your connections file first — there's nothing to search without it.",
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      prefsJson: serializePreferences(parsed.data),
      onboardedAt: new Date(),
    },
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
