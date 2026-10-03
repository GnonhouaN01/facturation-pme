import { expect, test } from "vitest";

import { cn } from "@/lib/utils";

test("cn assemble les classes et ignore les valeurs fausses", () => {
  expect(cn("a", false, "b")).toBe("a b");
});

test("cn garde la derniere classe Tailwind en cas de conflit", () => {
  expect(cn("p-2", "p-4")).toBe("p-4");
});
