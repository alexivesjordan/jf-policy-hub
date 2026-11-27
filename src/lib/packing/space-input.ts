export type LoadSpaceInput = {
  code: string;
  name: string;
  kind: "container" | "vehicle";
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  maxWeightKg: number;
};

export function readLoadSpace(input: {
  code: string;
  name: string;
  kind: string;
  lengthCm: string | number;
  widthCm: string | number;
  heightCm: string | number;
  maxWeightKg: string | number;
}): { ok: true; value: LoadSpaceInput } | { ok: false; message: string } {
  const code = input.code.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(code)) return { ok: false, message: "Use a short code of letters, numbers, and hyphens." };
  if (name.length < 1 || name.length > 80) return { ok: false, message: "Name must be 1 to 80 characters." };
  if (input.kind !== "container" && input.kind !== "vehicle") return { ok: false, message: "Choose a container or a vehicle." };
  const lengthCm = whole(input.lengthCm, "Length", 1, 2000);
  const widthCm = whole(input.widthCm, "Width", 1, 500);
  const heightCm = whole(input.heightCm, "Height", 1, 400);
  const maxWeightKg = cargo(input.maxWeightKg);
  const problem = [lengthCm, widthCm, heightCm, maxWeightKg].find((value) => typeof value === "string");
  if (typeof problem === "string") return { ok: false, message: problem };
  return {
    ok: true,
    value: {
      code,
      name,
      kind: input.kind,
      lengthCm: lengthCm as number,
      widthCm: widthCm as number,
      heightCm: heightCm as number,
      maxWeightKg: maxWeightKg as number,
    },
  };
}

function whole(value: string | number, label: string, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed)) return `${label} must be a whole number of centimetres.`;
  if (parsed < min || parsed > max) return `${label} must be from ${min} to ${max} cm.`;
  return parsed;
}

function cargo(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!(parsed > 0) || parsed > 40000 || Math.abs(parsed * 10 - Math.round(parsed * 10)) > 1e-6) {
    return "Max cargo must be greater than 0 and at most 40000 kg, with one decimal.";
  }
  return Math.round(parsed * 10) / 10;
}
