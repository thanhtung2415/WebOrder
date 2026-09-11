import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthSession } from "../auth/use-auth-session";
import { Button } from "../components/ui/button";
import { ApiClientError } from "../services/api-client";
import { completeSetup } from "./setup-api";
import { SetupStatusGuard } from "./setup-status-guard";

export function SetupPage(): ReactElement {
  return (
    <SetupStatusGuard allowWhen="PENDING">
      <SetupForm />
    </SetupStatusGuard>
  );
}

function SetupForm(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { accessToken, isLoading, signInWithGoogle } = useAuthSession();
  const [setupToken, setSetupToken] = useState("");
  const [branchCode, setBranchCode] = useState("MAIN");
  const [branchName, setBranchName] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) {
        throw new Error(t("setup.errors.signInRequired"));
      }

      return completeSetup(
        {
          setupToken,
          branch: {
            code: branchCode,
            name: branchName,
            timezone: "Asia/Ho_Chi_Minh"
          },
          admin: {
            displayName: adminDisplayName
          }
        },
        accessToken,
        crypto.randomUUID()
      );
    },
    onSuccess: async () => {
      setSetupToken("");
      await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      navigate("/admin", { replace: true });
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiClientError ? error.message : t("setup.errors.generic"));
    }
  });

  if (!isLoading && !accessToken) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
        <section className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">{t("setup.eyebrow")}</p>
            <h1 className="text-3xl font-semibold">{t("setup.signInTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("setup.signInDescription")}</p>
          </div>
          <Button type="button" onClick={signInWithGoogle}>
            {t("setup.signInGoogle")}
          </Button>
        </section>
      </main>
    );
  }

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("setup.loading")}</main>;
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setErrorMessage(null);
    mutation.mutate();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-10">
      <form className="space-y-6" onSubmit={submit}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">{t("setup.eyebrow")}</p>
          <h1 className="text-3xl font-semibold">{t("setup.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("setup.description")}</p>
        </div>
        <label className="grid gap-2 text-sm font-medium">
          {t("setup.token")}
          <input
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            type="password"
            value={setupToken}
            autoComplete="one-time-code"
            onChange={(event) => setSetupToken(event.target.value)}
            required
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            {t("setup.branchCode")}
            <input
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              value={branchCode}
              onChange={(event) => setBranchCode(event.target.value)}
              required
              maxLength={32}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            {t("setup.branchName")}
            <input
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              required
              maxLength={160}
            />
          </label>
        </div>
        <label className="grid gap-2 text-sm font-medium">
          {t("setup.adminName")}
          <input
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            value={adminDisplayName}
            onChange={(event) => setAdminDisplayName(event.target.value)}
            required
            maxLength={160}
          />
        </label>
        {errorMessage ? <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p> : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t("setup.submitting") : t("setup.submit")}
        </Button>
      </form>
    </main>
  );
}

export function AdminSetupRedirect(): ReactElement {
  return (
    <SetupStatusGuard allowWhen="COMPLETED">
      <Navigate to="/admin" replace />
    </SetupStatusGuard>
  );
}
