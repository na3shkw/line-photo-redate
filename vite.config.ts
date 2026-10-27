import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/line-photo-redate/",
  test: {
    include: ["test/**/*.test.ts"],
  },
});
