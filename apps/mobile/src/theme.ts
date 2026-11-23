import { resolveColors, shape } from "@monorise-team/tokens";

/** Kolory AvenMail na telefonie: te same tokeny co w przeglądarce i na komputerze (ADR-0091). */
export const colors = resolveColors("dark", "mono");
export const radius = { card: shape["card-radius"], row: shape["row-radius"], control: shape["control-radius"] };
export const gap = shape["card-gap"];
