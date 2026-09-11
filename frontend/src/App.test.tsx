import { render, screen } from "@testing-library/react";
import { App } from "./App";
import "./locales/i18n";

describe("App", () => {
  it("renders the customer menu route by default", async () => {
    render(<App />);

    expect(await screen.findByText("Menu tại bàn")).toBeInTheDocument();
  });
});
