import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactElement, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthSession } from "./use-auth-session";
import { AccountStatePage } from "./account-state-page";
import { isAuthorizedAdmin } from "./auth-routing";
import { clearAuthIntent, readAuthIntent } from "./auth-intent";
import { Button } from "../components/ui/button";
import { ApiClientError } from "../services/api-client";
import { fetchAuthMe, registerStaff } from "../setup/setup-api";

export function PendingPage(): ReactElement {
  const { t } = useTranslation();
  const { accessToken, isLoading, signOut } = useAuthSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [switchAccountError, setSwitchAccountError] = useState(false);
  const attemptedRegistrationToken = useRef<string | null>(null);
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: Boolean(accessToken)
  });
  const registration = useMutation({
    mutationFn: () => registerStaff(accessToken ?? ""),
    onSuccess: async () => {
      clearAuthIntent();
      await queryClient.invalidateQueries({ queryKey: ["auth-me", accessToken] });
    }
  });
  const intent = readAuthIntent();
  const shouldRegister =
    meQuery.error instanceof ApiClientError &&
    meQuery.error.code === "USER_NOT_REGISTERED" &&
    intent?.mode === "REGISTER" &&
    intent.area === "STAFF";

  useEffect(() => {
    if (accessToken && shouldRegister && attemptedRegistrationToken.current !== accessToken) {
      attemptedRegistrationToken.current = accessToken;
      registration.mutate();
    }
  }, [accessToken, registration, shouldRegister]);

  const switchGoogleAccount = async (): Promise<void> => {
    setIsSwitchingAccount(true);
    setSwitchAccountError(false);
    try {
      clearAuthIntent();
      await signOut();
      queryClient.clear();
      navigate("/login?area=admin", { replace: true });
    } catch {
      setSwitchAccountError(true);
      setIsSwitchingAccount(false);
    }
  };

  if (isLoading || meQuery.isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("setup.loading")}</main>;
  }

  if (!accessToken) {
    return <Navigate to="/login?mode=register&area=staff" replace />;
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
        {meQuery.data?.profile.email ? (
          <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
            <p className="text-xs font-medium uppercase text-muted-foreground">{t("pending.currentAccount")}</p>
            <p className="mt-1 font-semibold">{meQuery.data.profile.email}</p>
          </div>
        ) : null}
        {registration.isPending ? <p className="text-sm text-muted-foreground">{t("pending.registering")}</p> : null}
        <Button type="button" variant="outline" disabled={isSwitchingAccount} onClick={() => void switchGoogleAccount()}>
          {isSwitchingAccount ? t("pending.switchingAccount") : t("pending.switchAccount")}
        </Button>
        {switchAccountError ? <p className="text-sm text-red-600">{t("pending.switchAccountError")}</p> : null}
      </section>
    </main>
  );
}
