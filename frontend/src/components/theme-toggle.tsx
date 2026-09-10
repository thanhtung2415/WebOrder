import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { useThemeStore } from "../stores/theme-store";

export function ThemeToggle(): ReactElement {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggleTheme}>
      {theme === "dark" ? t("theme.light") : t("theme.dark")}
    </Button>
  );
}
