import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentAccessToken } from "../auth/auth-token-store";
import { ApiClient } from "./api-client";

describe("ApiClient", () => {
  beforeEach(() => {
    setCurrentAccessToken(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { ok: true }, meta: {}, requestId: "request-id" })
      })
    );
  });

  it("attaches the latest restored access token to authenticated requests", async () => {
    const client = new ApiClient("http://localhost/api/v1");
    setCurrentAccessToken("first-access-token");

    await client.request("/auth/me");
    setCurrentAccessToken("refreshed-access-token");
    await client.request("/auth/me");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost/api/v1/auth/me",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer first-access-token" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost/api/v1/auth/me",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer refreshed-access-token" }) })
    );
  });

  it("keeps multipart product image uploads as FormData", async () => {
    const client = new ApiClient("http://localhost/api/v1");
    const formData = new FormData();
    formData.append("image", new File(["image"], "product.png", { type: "image/png" }));

    await client.request("/products/product-id/image", {
      method: "POST",
      accessToken: "access-token",
      branchId: "branch-id",
      requestId: "request-id",
      body: formData
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/api/v1/products/product-id/image",
      expect.objectContaining({
        body: formData,
        headers: expect.not.objectContaining({ "Content-Type": expect.any(String) })
      })
    );
  });
});
