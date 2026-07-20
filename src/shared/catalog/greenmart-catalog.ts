export interface Product {
  id: string;
  name: string;
  unitAmount: number;
  currency: "usd";
  inStock: boolean;
  dietary: string[];
  substitutions: string[];
}

export const products: Product[] = [
  { id: "gm_milk_organic_2l", name: "Organic 2% milk", unitAmount: 449, currency: "usd", inStock: true, dietary: ["vegetarian"], substitutions: ["gm_milk_whole_2l"] },
  { id: "gm_milk_whole_2l", name: "Organic whole milk", unitAmount: 429, currency: "usd", inStock: true, dietary: ["vegetarian"], substitutions: [] },
  { id: "gm_eggs_free_range_12", name: "Free-range eggs (12)", unitAmount: 529, currency: "usd", inStock: true, dietary: ["vegetarian"], substitutions: [] },
  { id: "gm_bananas_1kg", name: "Bananas (1 kg)", unitAmount: 299, currency: "usd", inStock: true, dietary: ["vegan"], substitutions: [] },
  { id: "gm_oats_1kg", name: "Rolled oats (1 kg)", unitAmount: 649, currency: "usd", inStock: true, dietary: ["vegan", "gluten-free"], substitutions: [] },
];

export const deliveryWindows = {
  weekly: "2026-07-18T09:00:00+02:00/2026-07-18T11:00:00+02:00",
  urgent: "2026-07-17T18:00:00+02:00/2026-07-17T20:00:00+02:00",
};

export const findProduct = (id: string): Product => {
  const product = products.find((candidate) => candidate.id === id);
  if (!product) throw new Error(`Unknown GreenMart product: ${id}`);
  return product;
};
