import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../locales/i18n";
import { SetupPage } from "./setup-page";

const completeSetupMock = vi.fn();
const fetchSetupStatusMock = vi.fn();

vi.mock("../auth/use-auth-session", () => ({
  useAuthSession: () => ({
    session: { access_token: "verified-access-token" },
    accessToken: "verified-access-token",
    isLoading: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn()
  })
}));

vi.mock("./setup-api", () => ({
  fetchSetupStatus: () => fetchSetupStatusMock(),
  completeSetup: (...args: unknown[]) => completeSetupMock(...args)
}));

function renderSetup(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/setup"]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/admin" element={<div>Admin ready</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetupPage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSetupStatusMock.mockResolvedValue({ status: "PENDING" });
    completeSetupMock.mockResolvedValue({
      status: "COMPLETED",
      branch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
      admin: { id: "admin-id", email: "owner@example.com", displayName: "Owner", status: "ACTIVE" }
    });
  });

  it("renders the setup form", async () => {
    renderSetup();

    expect(await screen.findByText("Tạo chi nhánh và admin đầu tiên")).toBeInTheDocument();
  });

  it("submits setup and does not persist the setup token", async () => {
    renderSetup();

    fireEvent.change(await screen.findByLabelText("Setup token"), { target: { value: "secret-token" } });
    fireEvent.change(screen.getByLabelText("Tên chi nhánh"), { target: { value: "Main Branch" } });
    fireEvent.change(screen.getByLabelText("Tên hiển thị admin"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tất setup" }));

    await waitFor(() => expect(completeSetupMock).toHaveBeenCalled());
    expect(localStorage.getItem("setupToken")).toBeNull();
    expect(sessionStorage.getItem("setupToken")).toBeNull();
  });
});
