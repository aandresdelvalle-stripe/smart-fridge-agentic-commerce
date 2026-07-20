import { writeFile } from "node:fs/promises";
import { products } from "../src/shared/catalog/greenmart-catalog.js";

const feed = {
  generated_at: new Date().toISOString(),
  merchant: { id: "greenmart", name: "GreenMart" },
  products: products.map((product) => ({
    id: product.id,
    title: product.name,
    price: { amount: product.unitAmount, currency: product.currency },
    availability: product.inStock ? "in_stock" : "out_of_stock",
    attributes: { dietary: product.dietary, substitution_product_ids: product.substitutions },
  })),
};

await writeFile("greenmart-product-feed.json", `${JSON.stringify(feed, null, 2)}\n`);
console.log("Wrote greenmart-product-feed.json");
