import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

interface ShellPageProps {
  namespace: "customer" | "staff" | "admin";
}

export function ShellPage({ namespace }: ShellPageProps): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-3 px-4 py-10">
      <p className="text-sm font-medium text-muted-foreground">{t(`${namespace}.eyebrow`)}</p>
      <h1 className="text-3xl font-semibold tracking-normal text-foreground">{t(`${namespace}.title`)}</h1>
      <p className="max-w-2xl text-base text-muted-foreground">{t(`${namespace}.description`)}</p>
    </section>
  );
}
