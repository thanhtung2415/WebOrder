import { render, screen } from "@testing-library/react";
import { App } from "./App";
import "./locales/i18n";

describe("App", () => {
  it("renders the customer shell by default", async () => {
    render(<App />);

    expect(await screen.findByText("Customer layout")).toBeInTheDocument();
  });
});
