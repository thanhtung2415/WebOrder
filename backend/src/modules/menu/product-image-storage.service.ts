import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { unprocessable } from "../../common/errors/api-exception";
import { EnvironmentVariables } from "../../config/environment.validation";

const allowedMimeTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const maxImageBytes = 3 * 1024 * 1024;
const defaultBucket = "product-images";

@Injectable()
export class ProductImageStorageService {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {
    this.client = createClient(this.configService.get("SUPABASE_URL", { infer: true }), this.configService.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true }), {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    this.bucket = this.configService.get("SUPABASE_STORAGE_PRODUCT_BUCKET", { infer: true }) ?? defaultBucket;
  }

  async uploadProductImage(branchId: string, productId: string, file: Express.Multer.File): Promise<string> {
    const extension = allowedMimeTypes[file.mimetype];
    if (!extension) {
      throw unprocessable("INVALID_IMAGE_TYPE", "Product image must be JPEG, PNG or WEBP");
    }
    if (file.size <= 0 || file.size > maxImageBytes) {
      throw unprocessable("INVALID_IMAGE_SIZE", "Product image must be between 1 byte and 3 MB");
    }

    const objectPath = `${branchId}/products/${productId}/${randomUUID()}.${extension}`;
    const { error } = await this.client.storage.from(this.bucket).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

    if (error) {
      throw unprocessable("IMAGE_UPLOAD_FAILED", "Product image upload failed");
    }

    return objectPath;
  }
}
