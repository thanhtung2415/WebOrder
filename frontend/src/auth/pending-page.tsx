import { useMutation, useQuery } from "@tanstack/react-query";
import { ReactElement, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "./use-auth-session";
import { Button } from "../components/ui/button";
import { fetchAuthMe, registerStaff } from "../setup/setup-api";

export function PendingPage(): ReactElement {
  const { t } = useTranslation();
  const { accessToken, isLoading, signInWithGoogle } = useAuthSession();
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: Boolean(accessToken)
  });
  const registration = useMutation({
    mutationFn: () => registerStaff(accessToken ?? "")
  });

  useEffect(() => {
    if (accessToken && meQuery.isError && !registration.isPending && !registration.isSuccess) {
      registration.mutate();
    }
  }, [accessToken, meQuery.isError, registration]);

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("setup.loading")}</main>;
  }

  if (!accessToken) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
        <section className="space-y-6">
          <h1 className="text-3xl font-semibold">{t("pending.signInTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pending.signInDescription")}</p>
          <Button type="button" onClick={() => void signInWithGoogle()}>
            {t("setup.signInGoogle")}
          </Button>
        </section>
      </main>
    );
  }

  const accountStatus = meQuery.data?.accountStatus ?? "PENDING";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
      <section className="space-y-3">
        <p className="text-sm font-medium text-primary">{accountStatus}</p>
        <h1 className="text-3xl font-semibold">{t("pending.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pending.description")}</p>
        {registration.isPending ? <p className="text-sm text-muted-foreground">{t("pending.registering")}</p> : null}
      </section>
    </main>
  );
}
