import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Check, Coffee, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { ApiClientError } from "../services/api-client";
import { fetchAuthMe, fetchSetupStatus } from "../setup/setup-api";
import { AccountStatePage } from "./account-state-page";
import { clearAuthIntent, saveAuthIntent, type AuthArea, type AuthMode } from "./auth-intent";
import { isAuthorizedAdmin } from "./auth-routing";
import { useAuthSession } from "./use-auth-session";

export function LoginPage(): ReactElement {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { accessToken, isLoading, signInWithGoogle, signOut } = useAuthSession();
  const [mode, setMode] = useState<AuthMode>(() => (searchParams.get("mode") === "register" ? "REGISTER" : "LOGIN"));
  const [area, setArea] = useState<AuthArea>(() => (searchParams.get("area") === "admin" ? "ADMIN" : "STAFF"));
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [oauthError, setOauthError] = useState(false);

  const setupQuery = useQuery({ queryKey: ["setup-status"], queryFn: fetchSetupStatus });
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: Boolean(accessToken),
    retry: false
  });

  const isSetupPending = setupQuery.data?.status === "PENDING";
  const isAdminRegistration = mode === "REGISTER" && area === "ADMIN";
  const benefits = useMemo(
    () => (area === "ADMIN" ? [t("auth.adminBenefitOne"), t("auth.adminBenefitTwo")] : [t("auth.staffBenefitOne"), t("auth.staffBenefitTwo")]),
    [area, t]
  );

  useEffect(() => {
    if (meQuery.data) {
      clearAuthIntent();
    }
  }, [meQuery.data]);

  const startGoogleAuth = async (): Promise<void> => {
    setOauthError(false);
    setIsRedirecting(true);
    saveAuthIntent({ area, mode });
    try {
      await signInWithGoogle("/auth/callback");
    } catch {
      clearAuthIntent();
      setOauthError(true);
      setIsRedirecting(false);
    }
  };

  if (isLoading || setupQuery.isLoading || meQuery.isLoading) {
    return <AuthLoading />;
  }

  if (accessToken && meQuery.data) {
    if (meQuery.data.accountStatus === "PENDING") {
      return <Navigate to="/pending" replace />;
    }
    if (meQuery.data.accountStatus !== "ACTIVE") {
      return <AccountStatePage status={meQuery.data.accountStatus} />;
    }
    return <Navigate to={area === "ADMIN" && isAuthorizedAdmin(meQuery.data) ? "/admin" : "/staff"} replace />;
  }

  const unknownUser = meQuery.error instanceof ApiClientError && meQuery.error.code === "USER_NOT_REGISTERED";

  return (
    <main className="min-h-screen bg-[#f4f7f6] text-[#14201f] lg:grid lg:grid-cols-[minmax(360px,0.92fr)_minmax(520px,1.08fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#183431] lg:block" aria-label={t("auth.brandVisualLabel")}>
        <img className="absolute inset-0 h-full w-full object-cover" src="/images/auth-cafe.png" alt="" />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative flex min-h-screen flex-col justify-between p-10 text-white xl:p-14">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <span className="flex size-10 items-center justify-center rounded-md bg-white text-[#17685f]">
              <Coffee aria-hidden="true" size={21} strokeWidth={2.2} />
            </span>
            <span>WebOrder</span>
          </div>
          <div className="max-w-lg pb-4">
            <p className="mb-4 text-sm font-semibold uppercase text-[#d6f2ec]">{t("auth.visualEyebrow")}</p>
            <h1 className="text-4xl font-semibold leading-tight xl:text-5xl">{t("auth.visualTitle")}</h1>
            <p className="mt-5 max-w-md text-base leading-7 text-white/80">{t("auth.visualDescription")}</p>
            <div className="mt-8 flex items-center gap-3 text-sm text-white/90">
              <ShieldCheck aria-hidden="true" size={20} />
              <span>{t("auth.secureAccess")}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-start justify-center px-5 py-8 sm:px-10 lg:items-center lg:px-14">
        <div className="w-full max-w-[520px]">
          <div className="mb-9 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-3 font-semibold">
              <span className="flex size-10 items-center justify-center rounded-md bg-[#17685f] text-white"><Coffee aria-hidden="true" size={21} /></span>
              <span>WebOrder</span>
            </div>
            <Link className="text-sm font-medium text-[#17685f] hover:underline" to="/customer">{t("auth.customerArea")}</Link>
          </div>

          <p className="text-sm font-semibold text-[#17685f]">{t("auth.portalEyebrow")}</p>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">{mode === "LOGIN" ? t("auth.loginTitle") : t("auth.registerTitle")}</h2>
          <p className="mt-3 leading-6 text-[#62706e]">{mode === "LOGIN" ? t("auth.loginDescription") : t("auth.registerDescription")}</p>

          <div className="mt-8 grid grid-cols-2 rounded-md bg-[#e7edeb] p-1" aria-label={t("auth.modeLabel")}>
            <SegmentButton active={mode === "LOGIN"} onClick={() => setMode("LOGIN")} icon={<LockKeyhole size={17} />} label={t("auth.loginTab")} />
            <SegmentButton active={mode === "REGISTER"} onClick={() => setMode("REGISTER")} icon={<Users size={17} />} label={t("auth.registerTab")} />
          </div>

          <fieldset className="mt-7">
            <legend className="text-sm font-semibold">{t("auth.areaLabel")}</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <AreaButton active={area === "ADMIN"} icon={<ShieldCheck size={21} />} title={t("auth.adminArea")} description={t("auth.adminAreaDescription")} onClick={() => setArea("ADMIN")} />
              <AreaButton active={area === "STAFF"} icon={<Building2 size={21} />} title={t("auth.staffArea")} description={t("auth.staffAreaDescription")} onClick={() => setArea("STAFF")} />
            </div>
          </fieldset>

          <div className="mt-6 min-h-[76px] rounded-md border border-[#d9e2df] bg-white px-4 py-3">
            {benefits.map((benefit) => (
              <div className="flex items-start gap-2 py-1 text-sm text-[#53615f]" key={benefit}>
                <Check className="mt-0.5 shrink-0 text-[#17685f]" aria-hidden="true" size={16} />
                <span>{benefit}</span>
              </div>
            ))}
          </div>

          {isAdminRegistration ? (
            <div className="mt-5 rounded-md border border-[#e7c76f] bg-[#fff9e9] p-4 text-sm leading-6 text-[#654f19]">
              <p className="font-semibold">{t("auth.adminRegistrationTitle")}</p>
              <p className="mt-1">{t("auth.adminRegistrationDescription")}</p>
              {isSetupPending ? (
                <Button className="mt-4 w-full" asChild><Link to="/setup">{t("auth.openFirstSetup")}<ArrowRight className="ml-2" size={17} /></Link></Button>
              ) : null}
            </div>
          ) : isSetupPending ? (
            <div className="mt-5 rounded-md border border-[#e7c76f] bg-[#fff9e9] p-4 text-sm leading-6 text-[#654f19]">
              {t("auth.setupRequired")} <Link className="font-semibold underline" to="/setup">{t("auth.openFirstSetup")}</Link>
            </div>
          ) : (
            <Button className="mt-5 h-12 w-full text-base" type="button" disabled={isRedirecting} onClick={() => void startGoogleAuth()}>
              <span className="mr-3 flex size-6 items-center justify-center rounded-sm bg-white font-bold text-[#17685f]">G</span>
              {isRedirecting ? t("auth.redirecting") : mode === "LOGIN" ? t("auth.continueGoogle") : t("auth.registerGoogle")}
            </Button>
          )}

          {unknownUser || searchParams.get("error") === "not_registered" ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("auth.notRegisteredError")}</p> : null}
          {oauthError ? <p className="mt-4 text-sm text-red-700">{t("auth.oauthError")}</p> : null}
          {setupQuery.isError ? <p className="mt-4 text-sm text-red-700">{t("auth.setupStatusError")}</p> : null}
          {accessToken && meQuery.isError ? <Button className="mt-3" variant="outline" type="button" onClick={() => void signOut()}>{t("auth.signOutRetry")}</Button> : null}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#d9e2df] pt-5 text-xs text-[#73807e]">
            <span>{t("auth.backendAuthority")}</span>
            <Link className="font-medium text-[#17685f] hover:underline" to="/customer">{t("auth.customerArea")}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function SegmentButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return <button className={`flex h-10 items-center justify-center gap-2 rounded-sm text-sm font-semibold transition-colors ${active ? "bg-white text-[#14201f] shadow-sm" : "text-[#62706e] hover:text-[#14201f]"}`} type="button" aria-pressed={active} onClick={onClick}>{icon}{label}</button>;
}

function AreaButton({ active, icon, title, description, onClick }: { active: boolean; icon: ReactElement; title: string; description: string; onClick: () => void }): ReactElement {
  return (
    <button className={`min-h-[92px] rounded-md border p-4 text-left transition-colors ${active ? "border-[#17685f] bg-[#eef8f5] text-[#124e48] ring-1 ring-[#17685f]" : "border-[#d9e2df] bg-white hover:border-[#91aaa5]"}`} type="button" aria-pressed={active} onClick={onClick}>
      <span className="flex items-center gap-2 font-semibold">{icon}{title}</span>
      <span className="mt-2 block text-xs leading-5 text-[#62706e]">{description}</span>
    </button>
  );
}

function AuthLoading(): ReactElement {
  return <main className="flex min-h-screen items-center justify-center bg-[#f4f7f6] text-sm text-[#62706e]"><span className="mr-3 size-5 animate-spin rounded-full border-2 border-[#a8bab6] border-t-[#17685f]" aria-hidden="true" />Đang kiểm tra phiên đăng nhập...</main>;
}
