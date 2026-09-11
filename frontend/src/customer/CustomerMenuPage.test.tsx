import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerMenuPage } from "./CustomerMenuPage";

const fetchCustomerMenuMock = vi.fn();

vi.mock("./customer-menu-api", () => ({
  fetchCustomerMenu: (...args: unknown[]) => fetchCustomerMenuMock(...args)
}));

function renderCustomerMenu(path: string): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customer" element={<CustomerMenuPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CustomerMenuPage", () => {
  beforeEach(() => {
    fetchCustomerMenuMock.mockReset();
  });

  it("requires a QR session token before loading menu data", async () => {
    renderCustomerMenu("/customer");

    expect(await screen.findByText("Cần QR hợp lệ để xem menu.")).toBeInTheDocument();
    expect(fetchCustomerMenuMock).not.toHaveBeenCalled();
  });

  it("renders active menu products from the QR session", async () => {
    fetchCustomerMenuMock.mockResolvedValue([
      {
        id: "product-id",
        code: "BAC_XIU",
        name: "Bạc xỉu",
        description: "Ít cà phê, nhiều sữa",
        imagePath: null,
        basePrice: "35000.00",
        processingArea: "BAR",
        status: "ACTIVE",
        isFeatured: true,
        category: { id: "category-id", code: "COFFEE", name: "Cà phê", sortOrder: 1, isActive: true },
        availability: { isAvailable: true, inventoryAware: false, reason: "AVAILABLE" },
        optionGroups: []
      }
    ]);

    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    expect(await screen.findByText("Bạc xỉu")).toBeInTheDocument();
    expect(screen.getByText("Cà phê")).toBeInTheDocument();
    expect(fetchCustomerMenuMock).toHaveBeenCalledWith("branch-id", "qr-token");
  });
});
