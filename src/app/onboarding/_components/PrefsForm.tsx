"use client";

import { useActionState } from "react";

import { savePreferences, type PreferencesState } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Hint, Input, Label, Legend, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/panel";
import {
  SENIORITY_LABELS,
  SENIORITY_LEVELS,
  type JobPreferences,
} from "@/lib/prefs";

/**
 * What the user is looking for.
 *
 * Every field is optional and the form says so, because at this point the user
 * has not seen a single result yet and does not know what to narrow. Leaving it
 * all blank is a valid, encouraged answer — filtering can come after they see
 * what their network actually has open.
 */
export function PrefsForm({
  initial,
  canSubmit,
}: {
  initial: JobPreferences;
  canSubmit: boolean;
}) {
  const [state, formAction, isPending] = useActionState<PreferencesState, FormData>(
    savePreferences,
    { status: "idle" },
  );

  return (
    <form action={formAction} className="space-y-7">
      <div>
        <Label htmlFor="titleKeywords">Role keywords</Label>
        <Hint>
          Words that should appear in the job title. Separate with commas. Leave
          blank to see every open role.
        </Hint>
        <Textarea
          id="titleKeywords"
          name="titleKeywords"
          defaultValue={initial.titleKeywords.join(", ")}
          placeholder="backend, platform, infrastructure"
          className="mt-2.5"
        />
      </div>

      <div>
        <Label htmlFor="locations">Locations</Label>
        <Hint>Cities, regions or countries. Commas again.</Hint>
        <Input
          id="locations"
          name="locations"
          defaultValue={initial.locations.join(", ")}
          placeholder="Bengaluru, Remote, London"
          className="mt-2.5"
        />
      </div>

      <fieldset>
        <Legend>Seniority</Legend>
        <Hint>Pick any that fit. None selected means all of them.</Hint>
        <div className="mt-3 grid grid-cols-2 gap-y-2.5 sm:grid-cols-4">
          {SENIORITY_LEVELS.map((level) => (
            <Checkbox
              key={level}
              name="seniority"
              value={level}
              label={SENIORITY_LABELS[level]}
              defaultChecked={initial.seniority.includes(level)}
            />
          ))}
        </div>
      </fieldset>

      <Checkbox
        name="remoteOnly"
        label="Remote roles only"
        defaultChecked={initial.remoteOnly}
      />

      {state.status === "error" && (
        <Notice tone="caution" role="alert">
          {state.message}
        </Notice>
      )}

      <div className="flex items-center gap-4 border-t border-hairline pt-6">
        <Button type="submit" variant="signal" size="lg" disabled={isPending || !canSubmit}>
          {isPending ? "Saving…" : "Save and find referrals"}
        </Button>
        {!canSubmit && (
          <p className="text-sm text-muted">Add your connections file first.</p>
        )}
      </div>
    </form>
  );
}
