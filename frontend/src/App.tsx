import type { ReactElement } from "react";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers";
import { createAppRouter } from "./app/router";

export function App(): ReactElement {
  return (
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  );
}
