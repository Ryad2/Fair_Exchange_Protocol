export const PRECONTRACT_VARIANTS = [
    "normal",
    "no_S_deposit",
    "S_equals_B",
    "S_equals_V",
] as const;

export type PreContractVariantName = (typeof PRECONTRACT_VARIANTS)[number];

export const PRECONTRACT_VARIANT_OPTIONS: Array<{
    value: PreContractVariantName;
    label: string;
}> = [
    { value: "normal", label: "normal" },
    { value: "no_S_deposit", label: "simSOX (no S-deposit)" },
    { value: "S_equals_B", label: "S = B" },
    { value: "S_equals_V", label: "S = V" },
];

const PRECONTRACT_VARIANT_LABELS: Record<PreContractVariantName, string> = {
    normal: "normal",
    no_S_deposit: "simSOX",
    S_equals_B: "S = B",
    S_equals_V: "S = V",
};

export function normalizePreContractVariant(
    value: unknown
): PreContractVariantName {
    if (value === "simSOX") return "no_S_deposit";
    if (value === "S=B") return "S_equals_B";
    if (value === "S=V") return "S_equals_V";
    if (
        typeof value === "string" &&
        (PRECONTRACT_VARIANTS as readonly string[]).includes(value)
    ) {
        return value as PreContractVariantName;
    }
    return "normal";
}

export function preContractVariantLabel(value: unknown): string {
    return PRECONTRACT_VARIANT_LABELS[normalizePreContractVariant(value)];
}
