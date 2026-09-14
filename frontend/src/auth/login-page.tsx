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
    <main className="relative min-h-screen overflow-x-hidden bg-[#17120d] text-[#f5eee4]">
      <img
        className="fixed inset-0 h-full w-full object-cover brightness-[0.48] saturate-[0.72] sepia-[0.18]"
        src="/images/auth-cafe.png"
        alt=""
      />
      <div className="fixed inset-0 bg-[#100c08]/65" />

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex min-h-20 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-[#d8aa68]/70 text-[#e4bb7f]">
              <Coffee aria-hidden="true" size={20} strokeWidth={1.8} />
            </span>
            <div>
              <p className="auth-display text-lg font-semibold leading-none">WEBORDER</p>
              <p className="mt-1 text-[10px] font-medium uppercase text-white/55">CAFE OPERATIONS</p>
            </div>
          </div>
          <Link className="text-xs font-semibold uppercase text-[#e4bb7f] transition-colors hover:text-[#f6d7a9]" to="/customer">
            {t("auth.customerArea")}
          </Link>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-81px)] w-full max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.72fr)]">
        <section className="hidden flex-col justify-end px-12 pb-16 pt-12 lg:flex xl:px-16 xl:pb-20" aria-label={t("auth.brandVisualLabel")}>
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase text-[#e4bb7f]">{t("auth.visualEyebrow")}</p>
            <h1 className="auth-display mt-5 text-7xl font-semibold leading-[0.9] text-white xl:text-8xl">WebOrder</h1>
            <p className="auth-display mt-3 max-w-xl text-4xl italic leading-tight text-[#ead8c1] xl:text-5xl">{t("auth.visualTitle")}</p>
            <p className="mt-7 max-w-lg text-base leading-7 text-white/70">{t("auth.visualDescription")}</p>
            <div className="mt-9 flex items-center gap-3 border-t border-white/20 pt-5 text-sm text-white/75">
              <ShieldCheck className="text-[#e4bb7f]" aria-hidden="true" size={19} />
              <span>{t("auth.secureAccess")}</span>
            </div>
          </div>
        </section>

        <section className="flex items-start justify-center px-4 py-6 sm:px-8 sm:py-10 lg:items-center lg:px-10 lg:py-12">
          <div className="w-full max-w-[520px] rounded-md border border-white/15 bg-[#17130f]/90 p-5 shadow-2xl backdrop-blur-md sm:p-8 lg:p-9">
            <p className="text-xs font-semibold uppercase text-[#d8aa68]">{t("auth.portalEyebrow")}</p>
            <h2 className="auth-display mt-3 text-3xl font-semibold text-white sm:text-4xl">
              {mode === "LOGIN" ? t("auth.loginTitle") : t("auth.registerTitle")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/60">
              {mode === "LOGIN"
                ? t("auth.loginDescription")
                : area === "ADMIN"
                  ? t("auth.adminRegisterDescriptionShort")
                  : t("auth.registerDescription")}
            </p>

            <div className="mt-7 grid grid-cols-2 rounded-md border border-white/10 bg-black/25 p-1" aria-label={t("auth.modeLabel")}>
              <SegmentButton active={mode === "LOGIN"} onClick={() => setMode("LOGIN")} icon={<LockKeyhole size={17} />} label={t("auth.loginTab")} />
              <SegmentButton active={mode === "REGISTER"} onClick={() => setMode("REGISTER")} icon={<Users size={17} />} label={t("auth.registerTab")} />
            </div>

            <fieldset className="mt-6">
              <legend className="text-xs font-semibold uppercase text-white/70">{t("auth.areaLabel")}</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <AreaButton active={area === "ADMIN"} icon={<ShieldCheck size={21} />} title={t("auth.adminArea")} description={t("auth.adminAreaDescription")} onClick={() => setArea("ADMIN")} />
                <AreaButton active={area === "STAFF"} icon={<Building2 size={21} />} title={t("auth.staffArea")} description={t("auth.staffAreaDescription")} onClick={() => setArea("STAFF")} />
              </div>
            </fieldset>

            <div className="mt-5 min-h-[76px] border-y border-white/10 py-3">
              {benefits.map((benefit) => (
                <div className="flex items-start gap-2 py-1 text-xs leading-5 text-white/60" key={benefit}>
                  <Check className="mt-0.5 shrink-0 text-[#d8aa68]" aria-hidden="true" size={15} />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>

            {isAdminRegistration ? (
              <div className="mt-5 rounded-md border border-[#d8aa68]/35 bg-[#d8aa68]/10 p-4 text-sm leading-6 text-[#f0d5ae]">
                <p className="font-semibold text-[#f4dfc0]">{t("auth.adminRegistrationTitle")}</p>
                <p className="mt-1 text-white/65">{t("auth.adminRegistrationDescription")}</p>
                {isSetupPending ? (
                  <Button className="mt-4 w-full bg-[#d8aa68] text-[#21170d] hover:bg-[#e6ba7b]" asChild>
                    <Link to="/setup">{t("auth.openFirstSetup")}<ArrowRight className="ml-2" size={17} /></Link>
                  </Button>
                ) : null}
              </div>
            ) : isSetupPending ? (
              <div className="mt-5 rounded-md border border-[#d8aa68]/35 bg-[#d8aa68]/10 p-4 text-sm leading-6 text-[#f0d5ae]">
                {t("auth.setupRequired")} <Link className="font-semibold text-[#f5d6a7] underline" to="/setup">{t("auth.openFirstSetup")}</Link>
              </div>
            ) : (
              <Button className="mt-5 h-12 w-full bg-[#d8aa68] text-sm font-bold uppercase text-[#21170d] hover:bg-[#e6ba7b]" type="button" disabled={isRedirecting} onClick={() => void startGoogleAuth()}>
                <span className="mr-3 flex size-6 items-center justify-center rounded-sm bg-[#fff7eb] font-bold text-[#6c461d]">G</span>
                {isRedirecting ? t("auth.redirecting") : mode === "LOGIN" ? t("auth.continueGoogle") : t("auth.registerGoogle")}
                {!isRedirecting ? <ArrowRight className="ml-3" aria-hidden="true" size={17} /> : null}
              </Button>
            )}

            {unknownUser || searchParams.get("error") === "not_registered" ? (
              <p className="mt-4 rounded-md border border-red-300/30 bg-red-950/35 p-3 text-sm text-red-200">{t("auth.notRegisteredError")}</p>
            ) : null}
            {oauthError ? <p className="mt-4 text-sm text-red-300">{t("auth.oauthError")}</p> : null}
            {setupQuery.isError ? <p className="mt-4 text-sm text-red-300">{t("auth.setupStatusError")}</p> : null}
            {accessToken && meQuery.isError ? (
              <Button className="mt-3 border-white/20 bg-transparent text-white hover:bg-white/10" variant="outline" type="button" onClick={() => void signOut()}>
                {t("auth.signOutRetry")}
              </Button>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-[11px] text-white/40">
              <span>{t("auth.backendAuthority")}</span>
              <span>SAIGON · 2026</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SegmentButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return (
    <button
      className={`flex h-10 items-center justify-center gap-2 rounded-sm text-sm font-semibold transition-colors ${active ? "bg-[#f0e4d4] text-[#251a10]" : "text-white/50 hover:text-white"}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}{label}
    </button>
  );
}

function AreaButton({ active, icon, title, description, onClick }: { active: boolean; icon: ReactElement; title: string; description: string; onClick: () => void }): ReactElement {
  return (
    <button
      className={`min-h-[92px] rounded-md border p-4 text-left transition-colors ${active ? "border-[#d8aa68] bg-[#d8aa68]/10 text-[#f2d3a7] ring-1 ring-[#d8aa68]/60" : "border-white/15 bg-white/[0.03] text-white/80 hover:border-white/30"}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="flex items-center gap-2 font-semibold">{icon}{title}</span>
      <span className="mt-2 block text-xs leading-5 text-white/45">{description}</span>
    </button>
  );
}

function AuthLoading(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#17120d] text-sm text-[#ddc9af]">
      <span className="mr-3 size-5 animate-spin rounded-full border-2 border-white/20 border-t-[#d8aa68]" aria-hidden="true" />
      Đang kiểm tra phiên đăng nhập...
    </main>
  );
}
