import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactElement, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { useAuthSession } from "./use-auth-session";
import { AccountStatePage } from "./account-state-page";
import { isAuthorizedAdmin } from "./auth-routing";
import { Button } from "../components/ui/button";
import { ApiClientError } from "../services/api-client";
import { fetchAuthMe, registerStaff } from "../setup/setup-api";

export function PendingPage(): ReactElement {
  const { t } = useTranslation();
  const { accessToken, isLoading, signInWithGoogle, signOut } = useAuthSession();
  const queryClient = useQueryClient();
  const attemptedRegistrationToken = useRef<string | null>(null);
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: Boolean(accessToken)
  });
  const registration = useMutation({
    mutationFn: () => registerStaff(accessToken ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-me", accessToken] });
    }
  });
  const shouldRegister = meQuery.error instanceof ApiClientError && meQuery.error.code === "USER_NOT_REGISTERED";

  useEffect(() => {
    if (accessToken && shouldRegister && attemptedRegistrationToken.current !== accessToken) {
      attemptedRegistrationToken.current = accessToken;
      registration.mutate();
    }
  }, [accessToken, registration, shouldRegister]);

  if (isLoading || meQuery.isLoading) {
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

  if (meQuery.data?.accountStatus === "ACTIVE") {
    return <Navigate to={isAuthorizedAdmin(meQuery.data) ? "/admin" : "/staff"} replace />;
  }

  if (meQuery.data && meQuery.data.accountStatus !== "PENDING") {
    return <AccountStatePage status={meQuery.data.accountStatus} />;
  }

  const accountStatus = meQuery.data?.accountStatus ?? "PENDING";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
      <section className="space-y-3">
        <p className="text-sm font-medium text-primary">{accountStatus}</p>
        <h1 className="text-3xl font-semibold">{t("pending.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pending.description")}</p>
        {registration.isPending ? <p className="text-sm text-muted-foreground">{t("pending.registering")}</p> : null}
        <Button type="button" variant="outline" onClick={signOut}>
          Đăng xuất
        </Button>
      </section>
    </main>
  );
}
